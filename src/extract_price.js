/**
 * Robust Price & Currency Extraction Engine for Amazon Egypt and Egyptian E-commerce.
 * Supports:
 * - Western digits (0-9) and Arabic-Indic / Eastern numerals (٠-٩, ۰-۹)
 * - Currency symbols and abbreviations: EGP, ج.م, ج.م., جنيه, LE, L.E., LE.
 * - Discarding promotional and size interference (e.g. "وفر 10 جنيه", "1 لتر", "6 قطع")
 * - Distinguishing current price from struck / list price (.a-price, .a-offscreen, .a-text-price, s, del)
 * - Safe running inside browser DOM (page.evaluate) and Node.js
 */

/**
 * Normalizes digits (Arabic-Indic to Western), decimal separators, and removes RTL/invisible marks
 */
function normalizePriceText(str) {
  if (!str || typeof str !== 'string') return '';
  const arabicDigits = '٠١٢٣٤٥٦٧٨٩';
  const persianDigits = '۰۱۲۳۴۵۶۷۸۹';

  return str
    // Remove invisible unicode marks (LRM, RLM, zero-width space, etc.)
    .replace(/[\u200E\u200F\u00A0\u200B\u202A-\u202E]/g, ' ')
    // Convert Arabic-Indic digits
    .replace(/[٠-٩]/g, d => arabicDigits.indexOf(d))
    // Convert Persian digits
    .replace(/[۰-۹]/g, d => persianDigits.indexOf(d))
    // Normalize Arabic decimal separator (٫) to dot (.)
    .replace(/[٫]/g, '.')
    // Normalize Arabic comma (،) and Arabic thousands separator (٬) to comma (,)
    .replace(/[،٬]/g, ',')
    // Remove tashkeel
    .replace(/[\u064B-\u065F]/g, '')
    // Collapse spaces
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parses a clean numeric price from arbitrary text
 * Handles "245.00 ج.م", "EGP 1,250.50", "٢٤٥ جنيه", "‏45.00", etc.
 * Avoids catching promotional discounts like "وفر 10 جنيه"
 */
function parseCleanPrice(rawText) {
  if (!rawText) return null;
  let text = normalizePriceText(String(rawText));
  if (!text) return null;

  // 1. Remove promo / saving sentences so we don't accidentally extract "10" from "وفر 10 جنيه"
  // or "خصم 20%"
  text = text.replace(/(?:وفر|توفير|خصم|save|off)\s*[\d,.]+\s*(?:%|ج\.م|جنيه|egp|le)?/gi, ' ');
  text = text.replace(/[\d,.]+\s*%\s*(?:off|خصم|توفير)/gi, ' ');

  // 2. Remove size & pack counts if present (e.g. "1 لتر", "6 عبوات", "500 جم")
  // Do NOT rely on \b because Arabic characters are not \w in standard JS regex
  const sizeUnits = 'لترات?|لترا|لتر|كيلوجرامات?|كيلو|كغم|كجم|جم|مليلتر|مل|قطع|قطعة|علب|علبة|أكياس|اكياس|حفاضات?|حفاضة|packs?|pcs?|kg|g|l|ml';
  const sizeRegex = new RegExp(`(?:^|\\s|[^\u0600-\u06FFa-zA-Z0-9])\\d+(?:\\.\\d+)?\\s*(?:${sizeUnits})(?=$|\\s|[^\u0600-\u06FFa-zA-Z0-9])`, 'gi');
  text = text.replace(sizeRegex, ' ');

  // Currency pattern
  const curr = '(?:EGP|LE|L\\.E\\.|ج\\.م\\.?|جنيه(?:\\s*مصري)?|جم)';

  // Case A: Currency followed by number, e.g. "EGP 245.00" or "ج.م 1,250"
  const mCurBefore = text.match(new RegExp(`${curr}\\s*[:\\-]?\\s*([\\d,.]+)`, 'i'));
  if (mCurBefore) {
    const n = toFloat(mCurBefore[1]);
    if (n !== null && n > 0 && n < 1000000) return n;
  }

  // Case B: Number followed by currency, e.g. "245.00 EGP" or "245.00 ج.م" or "245 جنيه"
  const mCurAfter = text.match(new RegExp(`([\\d,.]+)\\s*${curr}`, 'i'));
  if (mCurAfter) {
    const n = toFloat(mCurAfter[1]);
    if (n !== null && n > 0 && n < 1000000) return n;
  }

  // Case C: Plain number only if explicitly formatted as price (e.g. "245.00") or small isolated token
  const trimmed = text.trim();
  if (/^[0-9]+(?:[.,][0-9]{1,2})?$/.test(trimmed)) {
    const n = toFloat(trimmed);
    if (n !== null && n > 0 && n < 1000000) return n;
  }

  return null;
}

/**
 * Converts a string with potential thousand and decimal separators to a valid Float
 */
function toFloat(numStr) {
  if (!numStr) return null;
  let s = String(numStr).trim();

  // If contains both comma and dot
  if (s.includes(',') && s.includes('.')) {
    if (s.indexOf(',') < s.indexOf('.')) {
      // e.g. 1,250.50
      s = s.replace(/,/g, '');
    } else {
      // e.g. 1.250,50
      s = s.replace(/\./g, '').replace(/,/g, '.');
    }
  } else if (s.includes(',')) {
    // If only comma exists: check if it's thousands (1,250) or decimal (245,50)
    const parts = s.split(',');
    if (parts.length === 2 && parts[1].length === 2) {
      s = s.replace(/,/g, '.');
    } else {
      s = s.replace(/,/g, '');
    }
  }

  const val = parseFloat(s);
  return isNaN(val) ? null : val;
}

/**
 * Extracts current price, old price, and discount from a product card element in browser DOM.
 * Works inside Playwright page.evaluate or in any DOM document.
 * 
 * @param {Element} card - The DOM container of the product card
 * @returns {{ currentPrice: string, currentPriceNum: number|null, oldPrice: string|null, oldPriceNum: number|null, discount: string|null }}
 */
function extractPricesFromCard(card) {
  let currentPrice = '';
  let currentPriceNum = null;
  let oldPrice = null;
  let oldPriceNum = null;
  let discount = null;

  if (!card) {
    return { currentPrice: '', currentPriceNum: null, oldPrice: null, oldPriceNum: null, discount: null };
  }

  // Helper to extract clean price from element
  function getElPrice(el) {
    if (!el) return null;
    const aria = (typeof el.getAttribute === 'function') ? el.getAttribute('aria-label') : null;
    const text = el.innerText || el.textContent || '';
    return parseCleanPrice(aria) || parseCleanPrice(text);
  }

  // --- 1. Current Price Extraction ---

  // Priority 1A: Amazon .a-price container that is NOT struck through
  const activePriceContainer = card.querySelector('.a-price:not([data-a-strike="true"]):not(.a-text-price)');
  if (activePriceContainer) {
    const offscreen = activePriceContainer.querySelector('.a-offscreen');
    const whole = activePriceContainer.querySelector('.a-price-whole');
    const frac = activePriceContainer.querySelector('.a-price-fraction');

    if (offscreen) {
      currentPriceNum = getElPrice(offscreen);
      if (currentPriceNum !== null) currentPrice = offscreen.innerText || offscreen.textContent || '';
    }
    if (currentPriceNum === null && whole) {
      const wholeText = (whole.innerText || whole.textContent || '').replace(/[^\d]/g, '');
      const fracText = frac ? (frac.innerText || frac.textContent || '').replace(/[^\d]/g, '') : '00';
      if (wholeText) {
        currentPriceNum = parseFloat(`${wholeText}.${fracText}`);
        currentPrice = `EGP ${currentPriceNum}`;
      }
    }
  }

  // Priority 1B: Tez / Now / Supermarket price attributes (data-a-color="price", data-testid="price", etc.)
  if (currentPriceNum === null) {
    const tezPriceEls = card.querySelectorAll('[data-a-color="price"], .a-color-price, [data-testid*="price"], [class*="price-item"]');
    for (const el of tezPriceEls) {
      // Skip if struck through (Amazon standard + Tez "decorationtype=strike")
      if (el.closest('[data-a-strike="true"], .a-text-price, s, del, strike, [decorationtype="strike"], [decorationtype="line-through"]')) continue;
      const num = getElPrice(el);
      if (num !== null) {
        currentPriceNum = num;
        currentPrice = el.innerText || el.textContent || `EGP ${num}`;
        break;
      }
    }
  }

  // Priority 1C: Look for aria-label with currency (EGP, ج.م, جنيه, LE)
  if (currentPriceNum === null) {
    const ariaEls = Array.from(card.querySelectorAll('[aria-label]')).filter(el => {
      const label = el.getAttribute('aria-label') || '';
      return /EGP|LE|ج\.م|جنيه/i.test(label) && !el.closest('[data-a-strike="true"], .a-text-price, s, del, strike, [decorationtype="strike"], [decorationtype="line-through"]');
    });

    for (const el of ariaEls) {
      const num = parseCleanPrice(el.getAttribute('aria-label'));
      if (num !== null) {
        currentPriceNum = num;
        currentPrice = el.getAttribute('aria-label');
        break;
      }
    }
  }

  // Priority 1D: Any element whose text includes currency and a valid price
  if (currentPriceNum === null) {
    const textEls = Array.from(card.querySelectorAll('span, p, div')).filter(el => {
      if (el.children.length > 2) return false; // leaf or near-leaf elements only
      if (el.closest('h1, h2, h3, [role="heading"], button, [role="button"]')) return false;
      if (el.closest('[data-a-strike="true"], .a-text-price, s, del, strike, [decorationtype="strike"], [decorationtype="line-through"]')) return false;
      const t = el.innerText || el.textContent || '';
      return /EGP|LE|ج\.م|جنيه/i.test(t);
    });

    for (const el of textEls) {
      const num = parseCleanPrice(el.innerText || el.textContent);
      if (num !== null) {
        currentPriceNum = num;
        currentPrice = el.innerText || el.textContent;
        break;
      }
    }
  }

  // --- 2. Struck / Old Price Extraction ---

  // Priority 2A: Struck price containers
  const strikeEls = card.querySelectorAll('.a-price[data-a-strike="true"], .a-text-price, span[data-a-strike="true"], s, del, strike, [decorationtype="strike"], [decorationtype="line-through"]');
  for (const el of strikeEls) {
    const offscreen = el.querySelector('.a-offscreen');
    const num = getElPrice(offscreen || el);
    if (num !== null && (currentPriceNum === null || num !== currentPriceNum)) {
      oldPriceNum = num;
      oldPrice = (offscreen || el).innerText || (offscreen || el).textContent || `EGP ${num}`;
      break;
    }
  }

  // Priority 2B: aria-labels with "السعر السابق" or "was" or "list price"
  if (oldPriceNum === null) {
    const wasLabels = Array.from(card.querySelectorAll('[aria-label]')).filter(el => {
      const l = el.getAttribute('aria-label') || '';
      return /سابق|القديم|was|list price|previous/i.test(l);
    });
    for (const el of wasLabels) {
      const num = parseCleanPrice(el.getAttribute('aria-label'));
      if (num !== null) {
        oldPriceNum = num;
        oldPrice = el.getAttribute('aria-label');
        break;
      }
    }
  }

  // --- 3. Discount Badge Extraction ---
  const badgeEl = card.querySelector('.a-badge-text, span[data-a-badge-type="deal"], .savingsPercentage, [class*="discount"]');
  if (badgeEl) {
    const badgeText = (badgeEl.innerText || badgeEl.textContent || '').trim();
    const m = badgeText.match(/(\d+%\s*(?:OFF|خصم|توفير)?|خصم\s*\d+%)/i);
    if (m) discount = m[1].trim();
  }

  // Fallback discount badge from card innerText
  if (!discount) {
    const cardText = card.innerText || card.textContent || '';
    const m = cardText.match(/(\d+%\s*OFF|\d+%\s*خصم|خصم\s*\d+%)/i);
    if (m) discount = m[1].trim();
  }

  // Calculate discount if missing but oldPrice > currentPrice
  if (!discount && currentPriceNum && oldPriceNum && oldPriceNum > currentPriceNum) {
    const pct = Math.round(((oldPriceNum - currentPriceNum) / oldPriceNum) * 100);
    if (pct > 0) discount = `${pct}% OFF`;
  }

  // Normalize string outputs
  currentPrice = currentPrice ? normalizePriceText(currentPrice) : (currentPriceNum ? `EGP ${currentPriceNum}` : '');
  oldPrice = oldPrice ? normalizePriceText(oldPrice) : (oldPriceNum ? `EGP ${oldPriceNum}` : null);

  return {
    currentPrice,
    currentPriceNum,
    oldPrice,
    oldPriceNum,
    discount
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    normalizePriceText,
    parseCleanPrice,
    toFloat,
    extractPricesFromCard
  };
}

if (typeof window !== 'undefined') {
  window.normalizePriceText = normalizePriceText;
  window.parseCleanPrice = parseCleanPrice;
  window.toFloat = toFloat;
  window.extractPricesFromCard = extractPricesFromCard;
}
