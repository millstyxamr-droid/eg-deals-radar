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
 * Robust retry helper with exponential backoff & jitter
 */
async function withRetry(fn, options = {}) {
  const {
    retries = 3,
    baseDelay = 1500,
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

      let delay = baseDelay * Math.pow(factor, attempt - 1);
      if (jitter) {
        delay = Math.round(delay * (0.5 + Math.random()));
      }

      console.warn(`[!] [${taskName}] Attempt ${attempt}/${retries} failed (${err.message}). Retrying in ${delay}ms...`);
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
    await page.goto(dept.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  }, {
    retries: 3,
    baseDelay: 1500,
    factor: 2,
    jitter: true,
    taskName: `Navigate to ${dept.name}`
  });

  // Handle location sheet if present
  try {
    const skipBtn = page.locator('button:has-text("Skip for now"), button:has-text("تخطي"), button[data-testid="bottom-sheet-close-button"]');
    if (await skipBtn.first().isVisible({ timeout: 2500 })) {
      await skipBtn.first().click();
    }
  } catch (e) {}

  // Let the grid hydrate before scrolling — reading counts too early makes the
  // lazy-loaded results look complete when they are not.
  await page.waitForTimeout(2500);

  // Scroll until all products load. The grid re-renders and can briefly report 0,
  // so track the maximum count seen and require a stable streak before stopping.
  let maxCount = 0;
  let stableRounds = 0;
  const MAX_SCROLLS = 40;
  const MIN_SCROLLS = 10;
  const STABLE_ROUNDS = 8;

  for (let i = 0; i < MAX_SCROLLS; i++) {
    await page.mouse.wheel(0, 3000);
    await page.waitForTimeout(1200);

    const count = await page.locator('button[data-csa-c-slot-id*="AddToCart"]').count();
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

  // Extract products
  const products = await page.evaluate(({ categoryName, categoryId }) => {
    const items = [];
    const buttons = document.querySelectorAll('button[data-csa-c-slot-id*="AddToCart"]');

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

      const img = card.querySelector('img');
      const imgSrc = img ? (img.getAttribute('src') || '') : '';

      // Price extraction - clean into REAL numbers at ingest time
      let currentPrice = '';
      let currentPriceNum = null;
      let oldPrice = null;
      let oldPriceNum = null;

      const priceLabels = Array.from(card.querySelectorAll('[aria-label*="EGP"], [aria-label*="جنيه"]'))
        .map(el => el.getAttribute('aria-label') || el.innerText || '')
        .filter(s => s.includes('EGP') || s.includes('جنيه'));

      if (priceLabels.length > 0) {
        currentPrice = priceLabels[0].replace(/\s+/g, ' ').trim();
        const m = currentPrice.match(/[\d,.]+/);
        if (m) currentPriceNum = parseFloat(m[0].replace(/,/g, ''));
      }
      if (priceLabels.length > 1) {
        oldPrice = priceLabels[1].replace(/\s+/g, ' ').trim();
        const m = oldPrice.match(/[\d,.]+/);
        if (m) oldPriceNum = parseFloat(m[0].replace(/,/g, ''));
      }

      // Discount badge
      let discount = null;
      const text = card.innerText;
      const discMatch = text.match(/(\d+%\s*OFF)/i);
      if (discMatch) discount = discMatch[1].trim();

      if (title && asin) {
        items.push({
          asin,
          title,
          currentPrice: currentPrice || (currentPriceNum ? `EGP ${currentPriceNum}` : ''),
          currentPriceNum,
          oldPrice: oldPrice || (oldPriceNum ? `EGP ${oldPriceNum}` : null),
          oldPriceNum,
          currency: 'EGP',
          discount,
          category: categoryName,
          categoryId: categoryId,
          productUrl: `https://www.amazon.eg/dp/${asin}`,
          imgSrc
        });
      }
    });

    return items;
  }, { categoryName: dept.name, categoryId: dept.id });

  console.log(`[+] Successfully extracted ${products.length} products from ${dept.name}`);
  return products;
}

/**
 * Worker pool to execute tasks with capped concurrency (max 3 tabs)
 */
async function runWithConcurrency(items, maxConcurrency, workerFn) {
  const poolSize = Math.max(1, Math.min(maxConcurrency, 3));
  let cursor = 0;

  async function worker(workerId) {
    while (cursor < items.length) {
      const idx = cursor++;
      const item = items[idx];
      await workerFn(item, idx, workerId);
    }
  }

  const workers = Array.from({ length: Math.min(poolSize, items.length) }, (_, id) => worker(id));
  await Promise.all(workers);
}

/**
 * Main scraper orchestration
 */
async function scrapeFullStore(options = {}) {
  const args = process.argv.slice(2);
  let cliLimit = null;
  let cliCategory = null;
  let cliSearch = null;
  let cliSearchCategory = null;
  let cliSearchFile = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1] && !args[i + 1].startsWith('-')) {
      cliLimit = parseInt(args[i + 1], 10);
    } else if (args[i].startsWith('--limit=')) {
      cliLimit = parseInt(args[i].split('=')[1], 10);
    } else if (args[i] === '--category' && args[i + 1] && !args[i + 1].startsWith('-')) {
      cliCategory = args[i + 1];
    } else if (args[i].startsWith('--category=')) {
      cliCategory = args[i].split('=')[1];
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
  const concurrency = options.concurrency || 2; // Default 2, max 3 parallel tabs

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
    for (const entry of list) {
      if (typeof entry === 'string') {
        searchTargets.push({ keyword: entry, categoryId: null });
      } else if (entry && entry.keyword) {
        searchTargets.push({
          keyword: entry.keyword,
          categoryId: entry.category_id || entry.categoryId || null
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

      built.push({
        id: cat.id,
        pageId: `search:${cat.id}:${keyword.toLowerCase()}`,
        name: `Search: ${keyword}`,
        searchKeyword: keyword,
        isSearch: true,
        nodeId: null,
        parent_id: cat.parent_id || null,
        depth: cat.depth !== undefined ? cat.depth : 0,
        url: `${BASE_URL}/tez/browse/search?qcbrand=${BRAND_ID}&searchKeyword=${encodeURIComponent(keyword)}`
      });
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

  let totalPagesOk = 0;
  let totalPagesFailed = 0;
  let grandTotalItems = 0;
  const productsFile = path.join(__dirname, 'products.json');

  try {
    // Process categories using worker pool (max 3 concurrent tabs)
    await runWithConcurrency(targetCategories, concurrency, async (dept, idx) => {
      console.log(`\n[Tab Worker] Processing category [${idx + 1}/${targetCategories.length}]: ${dept.name}`);
      const page = await context.newPage();
      let items = [];
      let isSuccess = false;

      try {
        items = await scrapeDepartment(page, dept);
        isSuccess = items.length > 0;
      } catch (err) {
        console.error(`[-] Failed scraping ${dept.name}: ${err.message}`);
        isSuccess = false;
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

    // Mark run as completed
    const finishedTime = new Date().toISOString();
    try {
      repo.updateRun(runId, {
        finished_at: finishedTime,
        status: 'completed',
        pages_ok: totalPagesOk,
        pages_failed: totalPagesFailed,
        items_upserted: grandTotalItems
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
