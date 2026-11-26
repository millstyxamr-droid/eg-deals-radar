/**
 * Amazon Egypt Tez / Now - Full Store Catalog Scraper (Node.js + Playwright + SQLite)
 * 
 * Crawls all department node categories to extract products across Amazon Now.
 * Features:
 * - Robust exponential backoff with jitter (withRetry)
 * - Atomic per-page transaction saving (upsert + snapshot)
 * - Checkpoint & resume support (--resume)
 * - Targeted crawl of a single category (--category <id|nodeId>)
 * - Concurrency capped at max 3 parallel tabs
 * - Coverage for 110 categories with depth & parent_id
 * - Inactive category tracking (0 items twice consecutively)
 * - Normalization (title, brand, weight/size) and deduplication
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const repo = require('./src/repo');
const {
  AmazonBlockError,
  checkBlockStatus,
  calculateCooldown,
  detectAmazonBlockFromPage
} = require('./src/anti_block');

const BRAND_ID = 'sAuWWBROaG';
const BASE_URL = 'https://www.amazon.eg';

// Load expanded 110 categories from categories.json with fallback
const categoriesFile = path.join(__dirname, 'categories.json');
let ALL_CATEGORIES = [];
if (fs.existsSync(categoriesFile)) {
  try {
    ALL_CATEGORIES = JSON.parse(fs.readFileSync(categoriesFile, 'utf-8'));
  } catch (e) {
    console.warn('[-] Failed to read categories.json, using fallback:', e.message);
  }
}

// Fallback if categories.json missing or empty
if (!ALL_CATEGORIES || ALL_CATEGORIES.length === 0) {
  ALL_CATEGORIES = [
    { id: 'fruits-vegetables', name: 'Fruits & Vegetables', nodeId: '215052334031', url: `${BASE_URL}/tez/browse/explore/category?qcbrand=${BRAND_ID}&nodeId=215052334031`, depth: 0, parent_id: null },
    { id: 'meat-chicken-fish', name: 'Chicken, Meat & Fish', nodeId: '214841696031', url: `${BASE_URL}/tez/browse/explore/category?qcbrand=${BRAND_ID}&nodeId=214841696031`, depth: 0, parent_id: null },
    { id: 'dairy-eggs', name: 'Dairy, Eggs & Cheese', nodeId: '223985148031', url: `${BASE_URL}/tez/browse/explore/category?qcbrand=${BRAND_ID}&nodeId=223985148031`, depth: 0, parent_id: null },
    { id: 'bakery', name: 'Bakery & Bread', nodeId: '215052333031', url: `${BASE_URL}/tez/browse/explore/category?qcbrand=${BRAND_ID}&nodeId=215052333031`, depth: 0, parent_id: null },
    { id: 'cooking-baking', name: 'Cooking & Baking', nodeId: '212925568031', url: `${BASE_URL}/tez/browse/explore/category?qcbrand=${BRAND_ID}&nodeId=212925568031`, depth: 0, parent_id: null }
  ];
}

/**
 * Determine if an error is transient and retryable
 */
function isRetryableError(err) {
  if (!err) return false;
  if (err instanceof AmazonBlockError) return true;
  const msg = (err.message || '').toLowerCase();
  const status = err.status || (err.response && err.response.status);

  // Non-retryable: 404, 403
  if (status === 404 || status === 403 || msg.includes('404') || msg.includes('403') || msg.includes('not found') || msg.includes('forbidden')) {
    return false;
  }

  // Retryable: timeout, net::ERR_*, 429, 5xx, navigation aborted
  if (
    msg.includes('timeout') ||
    msg.includes('net::err_') ||
    msg.includes('429') ||
    msg.includes('navigation aborted') ||
    msg.includes('connection reset') ||
    msg.includes('econnreset') ||
    msg.includes('socket hang up') ||
    msg.includes('frame was detached') ||
    msg.includes('target closed') ||
    (status && (status === 429 || status >= 500)) ||
    /\b5\d{2}\b/.test(msg)
  ) {
    return true;
  }

  return true;
}

/**
 * Robust retry helper with exponential backoff & jitter.
 * Features dedicated cooldown when Amazon 503 / 429 / CAPTCHA blocks are detected.
 */
async function withRetry(fn, options = {}) {
  const {
    retries = 2,
    baseDelay = 2000,
    factor = 2,
    jitter = true,
    taskName = 'Operation'
  } = options;

  let attempt = 0;
  while (attempt <= retries) {
    try {
      return await fn(attempt);
    } catch (err) {
      attempt++;
      if (attempt > retries || !isRetryableError(err)) {
        console.error(`[-] [${taskName}] Non-retryable error or exceeded ${retries} retries: ${err.message}`);
        throw err;
      }

      let delay;
      if (err instanceof AmazonBlockError || err.is503 || err.status === 503 || err.status === 429) {
        delay = calculateCooldown(attempt, 25000, 120000);
        console.warn(`[⚠️ 503 / RATE LIMIT DETECTED] [${taskName}] Attempt ${attempt}/${retries} blocked by Amazon (${err.message}). Activating cooldown (${Math.round(delay / 1000)}s)...`);
      } else {
        delay = baseDelay * Math.pow(factor, attempt - 1);
        if (jitter) {
          delay = Math.round(delay * (0.5 + Math.random()));
        }
        console.warn(`[!] [${taskName}] Attempt ${attempt}/${retries} failed (${err.message}). Retrying in ${delay}ms...`);
      }

      await new Promise(r => setTimeout(r, delay));
    }
  }
}

/**
 * Scrapes a single department page
 */
async function scrapeDepartment(page, dept) {
  console.log(`\n[==>] Crawling Department: ${dept.name} (${dept.url})`);

  await withRetry(async () => {
    const response = await page.goto(dept.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const blockCheck = await detectAmazonBlockFromPage(page, response);
    if (blockCheck.isBlocked) {
      throw new AmazonBlockError(`Amazon blocked access: ${blockCheck.reason}`, {
        status: (response ? response.status() : 503),
        reason: blockCheck.reason,
        isCaptcha: blockCheck.isCaptcha,
        is503: blockCheck.is503
      });
    }
  }, {
    retries: 2,
    baseDelay: 25000,
    factor: 2,
    jitter: true,
    taskName: `Navigate to ${dept.name}`
  });

  // Handle location sheet if present (Tez/Now only)
  if (dept.url.includes('/tez/')) {
    try {
      const skipBtn = page.locator('button:has-text("Skip for now"), button:has-text("تخطي"), button[data-testid="bottom-sheet-close-button"]');
      if (await skipBtn.first().isVisible({ timeout: 2500 })) {
        await skipBtn.first().click();
      }
    } catch (e) {}
  }

  // Let the grid hydrate before scrolling — reading counts too early makes the
  // lazy-loaded results look complete when they are not.
  await page.waitForTimeout(dept.url.includes('/tez/') ? 2500 : 1500);

  // Scroll until all products load. The grid re-renders and can briefly report 0,
  // so track the maximum count seen and require a stable streak before stopping.
  const isTez = dept.url.includes('/tez/');
  let maxCount = 0;
  let stableRounds = 0;
  const MAX_SCROLLS = isTez ? 40 : 12;
  const MIN_SCROLLS = isTez ? 10 : 3;
  const STABLE_ROUNDS = isTez ? 8 : 3;

  for (let i = 0; i < MAX_SCROLLS; i++) {
    await page.mouse.wheel(0, 3000);
    await page.waitForTimeout(1200);

    const count = await page.locator('button[data-csa-c-slot-id*="AddToCart"], div[data-component-type="s-search-result"], div[data-asin]:not([data-asin=""]), div[data-testid="deal-card"], article.prd, a.core').count();
    if (count > maxCount) {
      maxCount = count;
      stableRounds = 0;
    } else {
      stableRounds++;
    }
    if (i >= MIN_SCROLLS && stableRounds >= STABLE_ROUNDS && maxCount > 0) break;
  }
  const prevCount = maxCount;

  console.log(`[+] Loaded ${prevCount} raw items for ${dept.name}. Extracting details...`);

  // Extract products universally (Amazon General, Amazon Tez, and Jumia)
  const products = await page.evaluate(({ categoryName, categoryId }) => {
    // Embedded price extractor for browser context execution
    function normalizePrice(str) {
      if (!str || typeof str !== 'string') return '';
      const ar = '٠١٢٣٤٥٦٧٨٩';
      const fa = '۰۱۲۳۴۵۶۷۸۹';
      return str
        .replace(/[\u200E\u200F\u00A0\u200B\u202A-\u202E]/g, ' ')
        .replace(/[٠-٩]/g, d => ar.indexOf(d))
        .replace(/[۰-۹]/g, d => fa.indexOf(d))
        .replace(/[٫]/g, '.')
        .replace(/[،٬]/g, ',')
        .replace(/[\u064B-\u065F]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    }

    function toNum(s) {
      if (!s) return null;
      let str = String(s).trim();
      if (str.includes(',') && str.includes('.')) {
        if (str.indexOf(',') < str.indexOf('.')) str = str.replace(/,/g, '');
        else str = str.replace(/\./g, '').replace(/,/g, '.');
      } else if (str.includes(',')) {
        const parts = str.split(',');
        if (parts.length === 2 && parts[1].length === 2) str = str.replace(/,/g, '.');
        else str = str.replace(/,/g, '');
      }
      const val = parseFloat(str);
      return isNaN(val) ? null : val;
    }

    function extractCleanPrice(raw) {
      if (!raw) return null;
      let t = normalizePrice(String(raw));
      if (!t) return null;
      // Strip promo words like "وفر 10 جنيه"
      t = t.replace(/(?:وفر|توفير|خصم|save|off)\s*[\d,.]+\s*(?:%|ج\.م|جنيه|egp|le)?/gi, ' ');
      t = t.replace(/[\d,.]+\s*%\s*(?:off|خصم|توفير)/gi, ' ');
      // Strip size tokens
      const units = 'لترات?|لترا|لتر|كيلوجرامات?|كيلو|كغم|كجم|جم|مليلتر|مل|قطع|قطعة|علب|علبة|أكياس|اكياس|packs?|pcs?|kg|g|l|ml';
      t = t.replace(new RegExp(`(?:^|\\s|[^\u0600-\u06FFa-zA-Z0-9])\\d+(?:\\.\\d+)?\\s*(?:${units})`, 'gi'), ' ');

      const curr = '(?:EGP|LE|L\\.E\\.|ج\\.م\\.?|جنيه(?:\\s*مصري)?|جم)';
      const m1 = t.match(new RegExp(`${curr}\\s*[:\\-]?\\s*([\\d,.]+)`, 'i'));
      if (m1) {
        const n = toNum(m1[1]);
        if (n && n > 0 && n < 1000000) return n;
      }
      const m2 = t.match(new RegExp(`([\\d,.]+)\\s*${curr}`, 'i'));
      if (m2) {
        const n = toNum(m2[1]);
        if (n && n > 0 && n < 1000000) return n;
      }
      const trimmed = t.trim();
      if (/^[0-9]+(?:[.,][0-9]{1,2})?$/.test(trimmed)) {
        const n = toNum(trimmed);
        if (n && n > 0 && n < 1000000) return n;
      }
      return null;
    }

    function extractPrices(card) {
      if (typeof window.extractPricesFromCard === 'function') {
        return window.extractPricesFromCard(card);
      }

      let currentPriceNum = null;
      let currentPrice = '';
      let oldPriceNum = null;
      let oldPrice = null;
      let discount = null;

      // 1. .a-price container
      const activeEl = card.querySelector('.a-price:not([data-a-strike="true"]):not(.a-text-price)');
      if (activeEl) {
        const off = activeEl.querySelector('.a-offscreen');
        const whole = activeEl.querySelector('.a-price-whole');
        const frac = activeEl.querySelector('.a-price-fraction');
        if (off) {
          currentPriceNum = extractCleanPrice(off.innerText || off.textContent);
          if (currentPriceNum) currentPrice = off.innerText || off.textContent;
        }
        if (currentPriceNum === null && whole) {
          const w = (whole.innerText || whole.textContent || '').replace(/[^\d]/g, '');
          const f = frac ? (frac.innerText || frac.textContent || '').replace(/[^\d]/g, '') : '00';
          if (w) {
            currentPriceNum = parseFloat(`${w}.${f}`);
            currentPrice = `EGP ${currentPriceNum}`;
          }
        }
      }

      // 2. aria-label with currency
      if (currentPriceNum === null) {
        const ariaEls = Array.from(card.querySelectorAll('[aria-label]')).filter(el => {
          const l = el.getAttribute('aria-label') || '';
          return /EGP|LE|ج\.م|جنيه/i.test(l) && !el.closest('[data-a-strike="true"], .a-text-price, s, del, strike');
        });
        for (const el of ariaEls) {
          const n = extractCleanPrice(el.getAttribute('aria-label'));
          if (n) {
            currentPriceNum = n;
            currentPrice = el.getAttribute('aria-label');
            break;
          }
        }
      }

      // 3. Tez price attributes
      if (currentPriceNum === null) {
        const prcEls = card.querySelectorAll('[data-a-color="price"], .a-color-price, [data-testid*="price"], .prc, [data-price]');
        for (const el of prcEls) {
          if (el.closest('[data-a-strike="true"], .a-text-price, s, del, strike')) continue;
          const n = extractCleanPrice(el.innerText || el.textContent);
          if (n) {
            currentPriceNum = n;
            currentPrice = el.innerText || el.textContent;
            break;
          }
        }
      }

      // 4. Struck price
      const strikeEl = card.querySelector('.a-price[data-a-strike="true"], .a-text-price, span[data-a-strike="true"], s, del, strike, .old');
      if (strikeEl) {
        const off = strikeEl.querySelector('.a-offscreen') || strikeEl;
        const n = extractCleanPrice(off.innerText || off.textContent);
        if (n && (currentPriceNum === null || n !== currentPriceNum)) {
          oldPriceNum = n;
          oldPrice = off.innerText || off.textContent || `EGP ${n}`;
        }
      }

      // 5. Discount badge
      const badge = card.querySelector('.a-badge-text, span[data-a-badge-type="deal"], .bdg._dsct, .tag._dsct, [class*="discount"]');
      if (badge) {
        const m = (badge.innerText || badge.textContent || '').match(/(\d+%\s*(?:OFF|خصم|توفير)?|خصم\s*\d+%)/i);
        if (m) discount = m[1].trim();
      }
      if (!discount && currentPriceNum && oldPriceNum && oldPriceNum > currentPriceNum) {
        const pct = Math.round(((oldPriceNum - currentPriceNum) / oldPriceNum) * 100);
        if (pct > 0) discount = `${pct}% OFF`;
      }

      return { currentPrice, currentPriceNum, oldPrice, oldPriceNum, discount };
    }

    function extractStockNote(card) {
      if (!card) return null;
      const candidates = card.querySelectorAll('.a-color-price, .a-color-error, [data-cy="delivery-recipe"], #availability span, span.a-size-base');
      const enRegex = /Only\s+\d+\s+left\s+in\s+stock(?:\s*-\s*order\s+soon)?/i;
      const arRegex = /(?:باقي|متبقي|متوفر)\s+(?:\d+|قطعة\s+واحدة|قطعتان|قطعتين)\s*(?:فقط)?(?:\s+في\s+المخزون)?/i;
      const limitedRegex = /كمية\s+محدودة/i;

      for (const el of candidates) {
        const text = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
        if (!text) continue;
        const mEn = text.match(enRegex);
        if (mEn) return mEn[0].trim();
        const mAr = text.match(arRegex);
        if (mAr) return mAr[0].trim();
        const mLim = text.match(limitedRegex);
        if (mLim) return mLim[0].trim();
      }
      return null;
    }

    const host = window.location.hostname.toLowerCase();
    const isJumia = host.includes('jumia');

    // 1. JUMIA EGYPT EXTRACTION
    if (isJumia) {
      const items = [];
      const cards = document.querySelectorAll('article.prd, article[data-id], .c-prd, a.core');
      cards.forEach(card => {
        const link = card.tagName === 'A' ? card : card.querySelector('a.core, a[href*=".html"]');
        if (!link) return;
        const href = link.getAttribute('href') || '';
        if (!href || !href.includes('.html')) return;
        let productUrl = href.startsWith('http') ? href : `https://www.jumia.com.eg${href}`;
        let rawSku = card.getAttribute('data-id') || '';
        if (!rawSku) {
          const match = href.match(/-([a-zA-Z0-9]+)\.html/);
          if (match) rawSku = match[1];
        }
        if (!rawSku) return;
        const asin = `jumia:${rawSku}`;
        const titleEl = card.querySelector('.name, h3.name, .info h3');
        const title = titleEl ? titleEl.innerText.trim() : '';
        if (!title) return;
        const img = card.querySelector('img.img, img[data-src], img');
        const imgSrc = img ? (img.getAttribute('data-src') || img.getAttribute('src') || '') : '';

        const priceInfo = extractPrices(card);

        items.push({
          asin,
          store: 'jumia',
          store_sku: rawSku,
          title,
          currentPrice: priceInfo.currentPrice || (priceInfo.currentPriceNum ? `EGP ${priceInfo.currentPriceNum}` : ''),
          currentPriceNum: priceInfo.currentPriceNum,
          oldPrice: priceInfo.oldPrice || (priceInfo.oldPriceNum ? `EGP ${priceInfo.oldPriceNum}` : null),
          oldPriceNum: priceInfo.oldPriceNum,
          currency: 'EGP',
          discount: priceInfo.discount,
          category: categoryName,
          categoryId: categoryId,
          productUrl,
          imgSrc
        });
      });
      if (items.length > 0) return items;
    }

    // 2. AMAZON TEZ (NOW / GROCERY) EXTRACTION
    const buttons = document.querySelectorAll('button[data-csa-c-slot-id*="AddToCart"]');
    if (buttons.length > 0) {
      const items = [];
      buttons.forEach(btn => {
        const contentId = btn.getAttribute('data-csa-c-content-id') || '';
        const asinMatch = contentId.match(/AsinFaceout-AddToCart-([A-Z0-9]{10})/);
        const asin = asinMatch ? asinMatch[1] : '';
        const titleAttr = btn.getAttribute('data-csa-c-product-title') || '';

        let card = btn.closest('[role="button"]') || btn.parentElement;
        while (card && card.tagName !== 'BODY' && !card.querySelector('img')) {
          card = card.parentElement;
        }

        if (!card || !asin) return;

        const heading = card.querySelector('h2, h3, [role="heading"]');
        const title = heading ? heading.innerText.trim() : titleAttr;
        if (!title) return;

        const img = card.querySelector('img');
        const rawImg = img ? (img.getAttribute('data-src') || img.getAttribute('src') || '') : '';
        const imgSrc = rawImg.includes('21R6HAk0WUL') ? '' : rawImg;

        const priceInfo = extractPrices(card);
        const stockNote = extractStockNote(card);

        items.push({
          asin,
          store: 'amazon',
          store_sku: asin,
          title,
          currentPrice: priceInfo.currentPrice || (priceInfo.currentPriceNum ? `EGP ${priceInfo.currentPriceNum}` : ''),
          currentPriceNum: priceInfo.currentPriceNum,
          oldPrice: priceInfo.oldPrice || (priceInfo.oldPriceNum ? `EGP ${priceInfo.oldPriceNum}` : null),
          oldPriceNum: priceInfo.oldPriceNum,
          currency: 'EGP',
          discount: priceInfo.discount,
          stockNote,
          category: categoryName,
          categoryId: categoryId,
          productUrl: `https://www.amazon.eg/dp/${asin}`,
          imgSrc
        });
      });
      if (items.length > 0) return items;
    }

    // 3. AMAZON GENERAL (SEARCH RESULTS, DEALS, & ALL DEPARTMENTS)
    const items = [];
    const amzCards = document.querySelectorAll('div[data-component-type="s-search-result"], div[data-asin]:not([data-asin=""]), div[data-testid="deal-card"]');
    amzCards.forEach(card => {
      const asin = card.getAttribute('data-asin') || '';
      if (!asin || asin.length !== 10) return;
      if (card.classList.contains('AdHolder') && !card.querySelector('h2')) return;

      const heading = card.querySelector('h2 a span, h2 span, h2 a, [data-cy="title-recipe"] h2, a.a-link-normal span > div, [class*="p13n-sc-css-line-clamp"]');
      const title = heading ? (heading.innerText || heading.textContent || '').trim() : '';
      if (!title) return;

      const img = card.querySelector('img.s-image, img');
      const rawImg = img ? (img.getAttribute('data-src') || img.getAttribute('src') || '') : '';
      const imgSrc = rawImg.includes('21R6HAk0WUL') ? '' : rawImg;

      const priceInfo = extractPrices(card);
      const stockNote = extractStockNote(card);

      const link = card.querySelector('h2 a.a-link-normal, a.a-link-normal[href*="/dp/"]');
      let productUrl = (link && typeof link.getAttribute === 'function') ? link.getAttribute('href') : `/dp/${asin}`;
      if (productUrl && productUrl.startsWith('/')) {
        productUrl = `https://www.amazon.eg${productUrl}`;
      }

      items.push({
        asin,
        store: 'amazon',
        store_sku: asin,
        title,
        currentPrice: priceInfo.currentPrice || (priceInfo.currentPriceNum ? `EGP ${priceInfo.currentPriceNum}` : ''),
        currentPriceNum: priceInfo.currentPriceNum,
        oldPrice: priceInfo.oldPrice || (priceInfo.oldPriceNum ? `EGP ${priceInfo.oldPriceNum}` : null),
        oldPriceNum: priceInfo.oldPriceNum,
        currency: 'EGP',
        discount: priceInfo.discount,
        stockNote,
        category: categoryName,
        categoryId: categoryId,
        productUrl,
        imgSrc
      });
    });

    return items;
  }, { categoryName: dept.name, categoryId: dept.id });

  console.log(`[+] Successfully extracted ${products.length} products from ${dept.name}`);
  return products;
}

/**
 * Worker pool to execute tasks with capped concurrency (max 3 tabs).
 * Includes Circuit Breaker protection and polite jitter delay between requests.
 */
async function runWithConcurrency(items, maxConcurrency, workerFn) {
  const poolSize = Math.max(1, Math.min(maxConcurrency, 3));
  let cursor = 0;
  let isCircuitBroken = false;

  async function worker(workerId) {
    while (cursor < items.length && !isCircuitBroken) {
      const idx = cursor++;
      const item = items[idx];
      const res = await workerFn(item, idx, workerId);
      if (res && res.circuitBreaker) {
        isCircuitBroken = true;
        break;
      }
      // Polite human jitter delay between category requests (2.0s - 4.5s)
      if (cursor < items.length && !isCircuitBroken) {
        const politeDelay = Math.floor(2000 + Math.random() * 2500);
        await new Promise(r => setTimeout(r, politeDelay));
      }
    }
  }

  const workers = Array.from({ length: Math.min(poolSize, items.length) }, (_, id) => worker(id));
  await Promise.all(workers);
  return { circuitBroken: isCircuitBroken };
}

/**
 * Main scraper orchestration
 */
async function scrapeFullStore(options = {}) {
  const args = process.argv.slice(2);
  let cliLimit = null;
  let cliStore = null;
  let cliCategory = null;
  let cliSearch = null;
  let cliSearchCategory = null;
  let cliSearchFile = null;
  let cliConcurrency = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1] && !args[i + 1].startsWith('-')) {
      cliLimit = parseInt(args[i + 1], 10);
    } else if (args[i].startsWith('--limit=')) {
      cliLimit = parseInt(args[i].split('=')[1], 10);
    } else if (args[i] === '--store' && args[i + 1] && !args[i + 1].startsWith('-')) {
      cliStore = args[i + 1];
    } else if (args[i].startsWith('--store=')) {
      cliStore = args[i].split('=')[1];
    } else if (args[i] === '--category' && args[i + 1] && !args[i + 1].startsWith('-')) {
      cliCategory = args[i + 1];
    } else if (args[i].startsWith('--category=')) {
      cliCategory = args[i].split('=')[1];
    } else if (args[i] === '--concurrency' && args[i + 1] && !args[i + 1].startsWith('-')) {
      cliConcurrency = parseInt(args[i + 1], 10);
    } else if (args[i].startsWith('--concurrency=')) {
      cliConcurrency = parseInt(args[i].split('=')[1], 10);
    } else if (args[i] === '--search' && args[i + 1] && !args[i + 1].startsWith('-')) {
      cliSearch = args[i + 1];
    } else if (args[i].startsWith('--search=')) {
      cliSearch = args[i].split('=').slice(1).join('=');
    } else if (args[i] === '--search-category' && args[i + 1] && !args[i + 1].startsWith('-')) {
      cliSearchCategory = args[i + 1];
    } else if (args[i].startsWith('--search-category=')) {
      cliSearchCategory = args[i].split('=')[1];
    } else if (args[i] === '--search-file' && args[i + 1] && !args[i + 1].startsWith('-')) {
      cliSearchFile = args[i + 1];
    } else if (args[i].startsWith('--search-file=')) {
      cliSearchFile = args[i].split('=')[1];
    }
  }
  const limit = options.limit !== undefined ? options.limit : cliLimit;
  const categoryFilter = options.category !== undefined ? options.category : cliCategory;
  const searchQuery = options.search !== undefined ? options.search : cliSearch;
  const searchCategory = options.searchCategory !== undefined ? options.searchCategory : cliSearchCategory;
  const searchFile = options.searchFile !== undefined ? options.searchFile : cliSearchFile;
  const isResume = options.resume !== undefined ? options.resume : (args.includes('--resume') || args.includes('-r'));
  const isGeneralMode = options.general !== undefined ? options.general : args.includes('--general');
  const concurrency = options.concurrency !== undefined ? options.concurrency : (cliConcurrency !== null ? cliConcurrency : 1); // Default safe 1 tab

  const startTime = new Date().toISOString();
  const runId = `run_${Date.now()}`;
  console.log(`[*] Starting Full Store Scraper for Amazon Egypt Now / Tez (Run ID: ${runId})...`);

  // Target categories selection
  let targetCategories = [...ALL_CATEGORIES];
  let searchMode = false;

  // ---------------------------------------------------------------------
  // Search-based crawling (keyword targets)
  //
  // Category nodeIds in categories.json are partly guessed and many are
  // mis-mapped, so keyword search is the reliable path for full coverage.
  // Search results are still written to a real category_id, because
  // saveDepartmentBatch overwrites products.category_id with the passed id.
  // ---------------------------------------------------------------------
  const searchTargets = [];
  if (searchQuery) searchTargets.push({ keyword: searchQuery, categoryId: searchCategory });

  if (searchFile) {
    const searchPath = path.isAbsolute(searchFile) ? searchFile : path.join(__dirname, searchFile);
    if (!fs.existsSync(searchPath)) {
      console.error(`[-] Search file not found: ${searchPath}`);
      return { error: 'search_file_not_found' };
    }
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(searchPath, 'utf-8'));
    } catch (e) {
      console.error(`[-] Failed to parse search file ${searchPath}: ${e.message}`);
      return { error: 'search_file_invalid' };
    }
    const list = Array.isArray(parsed) ? parsed : (parsed.searches || []);
    const defaultStore = (parsed && parsed.store) || (isGeneralMode ? 'general' : 'tez');
    const defaultPages = (parsed && typeof parsed.pages === 'number') ? parsed.pages : 1;
    for (const entry of list) {
      if (typeof entry === 'string') {
        searchTargets.push({ keyword: entry, categoryId: null, store: defaultStore, pages: defaultPages });
      } else if (entry && entry.keyword) {
        searchTargets.push({
          keyword: entry.keyword,
          categoryId: entry.category_id || entry.categoryId || null,
          store: entry.store || defaultStore,
          pages: typeof entry.pages === 'number' ? entry.pages : defaultPages
        });
      }
    }
  }

  if (searchTargets.length > 0) {
    searchMode = true;
    const built = [];
    for (const t of searchTargets) {
      const keyword = String(t.keyword || '').trim();
      if (!keyword) continue;

      if (!t.categoryId) {
        console.error(`[-] Search "${keyword}" has no category. Pass --search-category <id> or add "category_id" in the search file.`);
        return { error: 'search_category_required' };
      }
      const cat = ALL_CATEGORIES.find(c => c.id === t.categoryId);
      if (!cat) {
        console.error(`[-] Unknown category "${t.categoryId}" for search "${keyword}". Check categories.json.`);
        return { error: 'search_category_not_found' };
      }

      const targetStore = t.store || (isGeneralMode ? 'general' : 'tez');
      const numPages = targetStore === 'general' ? Math.max(1, Math.min(t.pages || 2, 5)) : 1;

      for (let pageNum = 1; pageNum <= numPages; pageNum++) {
        const url = targetStore === 'general'
          ? `${BASE_URL}/s?k=${encodeURIComponent(keyword)}${pageNum > 1 ? `&page=${pageNum}` : ''}`
          : `${BASE_URL}/tez/browse/search?qcbrand=${BRAND_ID}&searchKeyword=${encodeURIComponent(keyword)}`;

        built.push({
          id: cat.id,
          pageId: `search:${targetStore}:${cat.id}:${keyword.toLowerCase()}:p${pageNum}`,
          name: `Search (${targetStore}): ${keyword}${numPages > 1 ? ` [p${pageNum}]` : ''}`,
          searchKeyword: keyword,
          isSearch: true,
          nodeId: null,
          parent_id: cat.parent_id || null,
          depth: cat.depth !== undefined ? cat.depth : 0,
          url
        });
      }
    }

    if (built.length === 0) {
      console.error('[-] No usable search targets were provided.');
      return { error: 'no_search_targets' };
    }

    targetCategories = built;
    console.log(`[i] Search mode: crawling ${built.length} keyword target(s).`);
    for (const t of built) console.log(`    • "${t.searchKeyword}" -> category "${t.id}"`);
  }

  // Handle checkpoint resume (skipped in search mode)
  if (!searchMode && isResume) {
    const lastRun = repo.getLastCheckpointRun();
    if (lastRun && lastRun.last_page) {
      console.log(`[⚡] Found previous checkpoint: run ${lastRun.id}, last page was: ${lastRun.last_page}`);
      const lastIndex = targetCategories.findIndex(c => c.id === lastRun.last_page);
      if (lastIndex !== -1 && lastIndex + 1 < targetCategories.length) {
        targetCategories = targetCategories.slice(lastIndex + 1);
        console.log(`[⚡] Resuming from category ${targetCategories[0].id} (${targetCategories.length} remaining).`);
      }
    } else {
      // Also check categories table for recent scrapes
      try {
        const recentCats = repo.db.prepare(`
          SELECT id FROM categories
          WHERE last_scraped_at >= datetime('now', '-6 hours') AND is_active = 1
        `).all().map(r => r.id);
        if (recentCats.length > 0) {
          const before = targetCategories.length;
          targetCategories = targetCategories.filter(c => !recentCats.includes(c.id));
          console.log(`[⚡] Resuming: skipping ${before - targetCategories.length} categories scraped within last 6h (${targetCategories.length} remaining).`);
        } else {
          console.log('[i] No previous incomplete run checkpoint found. Starting full run.');
        }
      } catch (e) {
        console.log('[i] No previous incomplete run checkpoint found. Starting full run.');
      }
    }
  }

  // Targeted crawl of a single store (e.g. amazon or jumia)
  const storeFilter = options.store !== undefined ? options.store : cliStore;
  if (!searchMode && storeFilter) {
    const before = targetCategories.length;
    targetCategories = targetCategories.filter(
      c => (c.store || 'amazon').toLowerCase() === storeFilter.toLowerCase()
    );
    console.log(`[i] --store filter applied: ${before} -> ${targetCategories.length} categories (${storeFilter}).`);
    if (targetCategories.length === 0) {
      console.error(`[-] No categories found for store: ${storeFilter}.`);
      return { error: 'store_categories_not_found' };
    }
  }

  // Targeted crawl of a single category (skipped in search mode)
  if (!searchMode && categoryFilter) {
    const before = targetCategories.length;
    targetCategories = targetCategories.filter(
      c => c.id === categoryFilter || String(c.nodeId) === String(categoryFilter)
    );
    console.log(`[i] --category filter applied: ${before} -> ${targetCategories.length} categories (${categoryFilter}).`);
    if (targetCategories.length === 0) {
      console.error(`[-] Category not found: ${categoryFilter}. Check categories.json.`);
      return { error: 'category_not_found' };
    }
  }

  // Apply dry-run limit if specified
  if (limit && Number.isInteger(limit) && limit > 0) {
    console.log(`[i] --limit flag applied: processing first ${limit} categories only.`);
    targetCategories = targetCategories.slice(0, limit);
  }

  console.log(`[i] Total categories to crawl in this run: ${targetCategories.length}`);

  // Record initial run in SQLite
  try {
    repo.recordRun({
      id: runId,
      started_at: startTime,
      status: 'running',
      pages_total: targetCategories.length,
      pages_ok: 0,
      pages_failed: 0,
      items_upserted: 0
    });
  } catch (e) {
    console.warn('[-] Failed to record run start:', e.message);
  }

  // Upsert categories metadata into database.
  // In search mode we must not overwrite the real category name/URL with the
  // synthetic "Search: ..." target, so we upsert the canonical category instead.
  for (const cat of targetCategories) {
    try {
      if (cat.isSearch) {
        const canonical = ALL_CATEGORIES.find(c => c.id === cat.id);
        if (!canonical) continue;
        repo.upsertCategory({
          id: canonical.id,
          parent_id: canonical.parent_id || null,
          name: canonical.name,
          node_id: canonical.nodeId,
          url: canonical.url,
          depth: canonical.depth !== undefined ? canonical.depth : 0
        });
        continue;
      }
      repo.upsertCategory({
        id: cat.id,
        parent_id: cat.parent_id || null,
        name: cat.name,
        node_id: cat.nodeId,
        url: cat.url,
        depth: cat.depth !== undefined ? cat.depth : 0
      });
    } catch (e) {}
  }

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox'
    ]
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'ar-EG',
    viewport: { width: 1366, height: 768 },
    extraHTTPHeaders: {
      'accept-language': 'ar-EG,ar;q=0.9,en-US;q=0.8,en;q=0.7',
      'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8'
    }
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  // Inject robust price extraction module into all browser tabs
  try {
    const extractScriptPath = path.join(__dirname, 'src', 'extract_price.js');
    if (fs.existsSync(extractScriptPath)) {
      await context.addInitScript({ path: extractScriptPath });
    }
  } catch (e) {
    console.warn('[-] Could not inject extract_price script:', e.message);
  }

  let totalPagesOk = 0;
  let totalPagesFailed = 0;
  let grandTotalItems = 0;
  let consecutiveBlocks = 0;
  let circuitBreakerTripped = false;
  let lastProcessedCategory = null;
  const productsFile = path.join(__dirname, 'products.json');

  try {
    // Process categories using worker pool
    const poolRes = await runWithConcurrency(targetCategories, concurrency, async (dept, idx) => {
      console.log(`\n[Tab Worker] Processing category [${idx + 1}/${targetCategories.length}]: ${dept.name}`);
      lastProcessedCategory = dept.id;
      const page = await context.newPage();
      let items = [];
      let isSuccess = false;

      try {
        items = await scrapeDepartment(page, dept);
        isSuccess = items.length > 0;
        consecutiveBlocks = 0; // Reset on clean scrape
      } catch (err) {
        console.error(`[-] Failed scraping ${dept.name}: ${err.message}`);
        isSuccess = false;

        if (err instanceof AmazonBlockError || err.is503 || (err.message && err.message.toLowerCase().includes('blocked access'))) {
          consecutiveBlocks++;
          console.warn(`[⚠️ Rate Limit Tracker] ${consecutiveBlocks}/3 consecutive blocks recorded.`);
          if (consecutiveBlocks >= 3) {
            console.error('\n' + '='.repeat(68));
            console.error('🛑 [CIRCUIT BREAKER TRIGGERED] 3 CONSECUTIVE CATEGORIES BLOCKED (503 / RATE LIMIT)');
            console.error('🛑 Halting scraper immediately to protect IP from long-term ban.');
            console.error(`🛑 State saved at checkpoint: "${dept.id}". Resume anytime with: node full_store_scraper.js --resume`);
            console.error('='.repeat(68) + '\n');
            circuitBreakerTripped = true;
            return { circuitBreaker: true };
          }
        }
      } finally {
        // ALWAYS close page tab in finally to avoid memory leaks
        await page.close();
      }

      // Save page/department batch in a single database transaction
      try {
        const upserted = repo.saveDepartmentBatch({
          items,
          runId,
          categoryId: dept.id,
          categoryName: dept.name,
          pageIdentifier: dept.pageId || dept.id,
          isSuccess
        });

        if (isSuccess) {
          totalPagesOk++;
          grandTotalItems += upserted;
          console.log(`[💾] Progress saved: ${dept.name} -> ${upserted} items upserted.`);
        } else {
          totalPagesFailed++;
          console.warn(`[!] Category ${dept.name} yielded 0 items or failed.`);
        }
      } catch (err) {
        console.error(`[-] Failed to persist batch for ${dept.id}:`, err.message);
        totalPagesFailed++;
      }
    });

    if (poolRes && poolRes.circuitBroken) {
      circuitBreakerTripped = true;
    }

    // Mark run as completed or paused
    const finishedTime = new Date().toISOString();
    const finalRunStatus = circuitBreakerTripped ? 'rate_limited_paused' : 'completed';
    try {
      repo.updateRun(runId, {
        finished_at: finishedTime,
        status: finalRunStatus,
        pages_ok: totalPagesOk,
        pages_failed: totalPagesFailed,
        items_upserted: grandTotalItems,
        last_page: lastProcessedCategory
      });
    } catch (e) {}

    console.log(`\n[✔] FULL STORE SCRAPE FINISHED! Pages OK: ${totalPagesOk}, Pages Failed: ${totalPagesFailed}, Total Items: ${grandTotalItems}`);

    // Run Deduplication and Quality Audit
    console.log('\n[🔄] Running catalog normalization & deduplication...');
    const dedupResult = repo.deduplicateCatalog();
    console.log(`[✔] Deduplication complete: checked ${dedupResult.totalChecked} items, detected ${dedupResult.duplicatesDetected} duplicates.`);

    const report = repo.getDeduplicationReport();
    console.log('\n================== CATALOG QUALITY REPORT ==================');
    console.log(`- Total Products in DB:           ${report.totalProducts}`);
    console.log(`- Active Canonical Products:      ${report.activeCanonicalProducts}`);
    console.log(`- Inactive Duplicates (Recorded): ${report.duplicateProducts}`);
    console.log(`- Products with Brand Extracted:  ${report.withBrandCount} (${report.withBrandPct}%)`);
    console.log(`- Products with Weight/Size:      ${report.withWeightCount} (${report.withWeightPct}%)`);
    if (report.inactiveCategories && report.inactiveCategories.length > 0) {
      console.log(`- Deactivated Categories (2x consecutive zero products): ${report.inactiveCategories.length}`);
      report.inactiveCategories.forEach(c => console.log(`  * [${c.id}] ${c.name} (Zero count: ${c.consecutive_zero_count})`));
    } else {
      console.log(`- Deactivated Categories:         0`);
    }
    console.log('============================================================\n');

    // Update products.json as JSON export
    try {
      const exportedProducts = repo.getProductsForExport();
      fs.writeFileSync(productsFile, JSON.stringify(exportedProducts, null, 2), 'utf-8');
      console.log(`[📄] Exported ${exportedProducts.length} active canonical products to products.json`);
    } catch (e) {
      console.warn('[-] Failed to export products.json:', e.message);
    }

    // Run Deal & Price Drop Analysis
    try {
      const { analyzeDeals } = require('./deals_tracker.js');
      analyzeDeals();
    } catch (e) {
      console.warn('[-] Deals tracker note:', e.message);
    }

    // Regenerate CSV, Excel, and HTML
    try {
      require('./export_data.js');
    } catch (e) {
      console.warn('[-] Export data note:', e.message);
    }

    return {
      runId,
      pagesOk: totalPagesOk,
      pagesFailed: totalPagesFailed,
      itemsUpserted: grandTotalItems,
      report
    };

  } catch (err) {
    console.error('[-] Fatal error during full store scrape:', err);
    try {
      repo.updateRun(runId, {
        finished_at: new Date().toISOString(),
        status: 'failed',
        error: err.message
      });
    } catch (e) {}
    throw err;
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  scrapeFullStore().catch(err => {
    console.error('Scraper execution failed:', err);
    process.exit(1);
  });
}

module.exports = {
  scrapeFullStore,
  withRetry,
  isRetryableError,
  ALL_CATEGORIES,
  DEPARTMENTS: ALL_CATEGORIES
};
