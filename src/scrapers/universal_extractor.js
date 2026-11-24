/**
 * Universal E-commerce DOM Extractor
 * Extracts products from:
 * 1. Amazon Egypt Standard Search & Department Pages
 * 2. Amazon Egypt Tez / Grocery Pages
 * 3. Jumia Egypt Pages
 */

const {
  normalizePriceText,
  parseCleanPrice,
  toFloat,
  extractPricesFromCard
} = require('../extract_price');

function cleanNumber(str) {
  if (!str) return null;
  const parsed = parseCleanPrice(str);
  if (parsed !== null) return parsed;
  // Fallback for raw numbers without currency
  const normalized = normalizePriceText(str).replace(/[^\d.,]/g, '').trim();
  if (!normalized) return null;
  return toFloat(normalized);
}

/**
 * Extracts products from Amazon Egypt Tez (Now / Supermarket)
 */
function extractAmazonTez(doc, options = {}) {
  const { categoryName = 'Tez', categoryId = 'tez' } = options;
  const items = [];
  const buttons = doc.querySelectorAll('button[data-csa-c-slot-id*="AddToCart"]');

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
    const imgSrc = img ? (img.getAttribute('src') || '') : '';

    const priceInfo = extractPricesFromCard(card);

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
      category: categoryName,
      categoryId: categoryId,
      productUrl: `https://www.amazon.eg/dp/${asin}`,
      imgSrc
    });
  });

  return items;
}

/**
 * Extracts products from Amazon Egypt Standard Search, Department & Deals Pages
 */
function extractAmazonGeneral(doc, options = {}) {
  const { categoryName = 'General', categoryId = 'amazon-general' } = options;
  const items = [];
  
  // Find all search result cards or deal cards
  const cards = doc.querySelectorAll('div[data-component-type="s-search-result"], div[data-asin]:not([data-asin=""]), div[data-testid="deal-card"]');

  cards.forEach(card => {
    const asin = card.getAttribute('data-asin') || '';
    if (!asin || asin.length !== 10) return;

    // Check if card is a sponsored brand banner or empty
    if (card.classList.contains('AdHolder') && !card.querySelector('h2')) return;

    // Extract title
    const heading = card.querySelector('h2 a span, h2 span, h2 a, [data-cy="title-recipe"] h2');
    const title = heading ? heading.innerText.trim() : '';
    if (!title) return;

    // Extract Image
    const img = card.querySelector('img.s-image, img');
    const imgSrc = img ? (img.getAttribute('src') || '') : '';

    // Extract Current Price
    let currentPriceNum = null;
    let currentPrice = '';
    const offscreenPrice = card.querySelector('.a-price:not([data-a-strike="true"]) .a-offscreen');
    if (offscreenPrice) {
      currentPrice = offscreenPrice.innerText.trim();
      currentPriceNum = cleanNumber(currentPrice);
    } else {
      const whole = card.querySelector('.a-price-whole');
      const frac = card.querySelector('.a-price-fraction');
      if (whole) {
        currentPriceNum = cleanNumber(whole.innerText + (frac ? '.' + frac.innerText : ''));
        currentPrice = `EGP ${currentPriceNum}`;
      }
    }

    // Extract Old / List Price
    let oldPriceNum = null;
    let oldPrice = null;
    const strikePrice = card.querySelector('.a-price[data-a-strike="true"] .a-offscreen, span.a-text-price .a-offscreen');
    if (strikePrice) {
      oldPrice = strikePrice.innerText.trim();
      oldPriceNum = cleanNumber(oldPrice);
    }

    // Extract Discount Badge
    let discount = null;
    const badge = card.querySelector('.a-badge-text, span[data-a-badge-type="deal"]');
    if (badge) {
      discount = badge.innerText.trim();
    } else if (currentPriceNum && oldPriceNum && oldPriceNum > currentPriceNum) {
      const pct = Math.round(((oldPriceNum - currentPriceNum) / oldPriceNum) * 100);
      if (pct > 0) discount = `${pct}% OFF`;
    }

    // Product URL
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
      currentPrice: currentPrice || (currentPriceNum ? `EGP ${currentPriceNum}` : ''),
      currentPriceNum,
      oldPrice: oldPrice || (oldPriceNum ? `EGP ${oldPriceNum}` : null),
      oldPriceNum,
      currency: 'EGP',
      discount,
      category: categoryName,
      categoryId: categoryId,
      productUrl,
      imgSrc
    });
  });

  return items;
}

/**
 * Extracts products from Jumia Egypt Pages
 */
function extractJumia(doc, options = {}) {
  const { categoryName = 'Jumia', categoryId = 'jumia-general' } = options;
  const items = [];

  // Jumia product cards
  const cards = doc.querySelectorAll('article.prd, article[data-id], .c-prd, a.core');

  cards.forEach(card => {
    // Get link element
    const link = card.tagName === 'A' ? card : card.querySelector('a.core, a[href*=".html"]');
    if (!link) return;

    const href = link.getAttribute('href') || '';
    if (!href || !href.includes('.html')) return;

    let productUrl = href.startsWith('http') ? href : `https://www.jumia.com.eg${href}`;

    // Extract SKU from data-id or URL (e.g. /product-title-sku123.html -> sku123)
    let rawSku = card.getAttribute('data-id') || '';
    if (!rawSku) {
      const match = href.match(/-([a-zA-Z0-9]+)\.html/);
      if (match) rawSku = match[1];
    }
    if (!rawSku) return;

    const asin = `jumia:${rawSku}`;

    // Extract title
    const titleEl = card.querySelector('.name, h3.name, .info h3');
    const title = titleEl ? titleEl.innerText.trim() : '';
    if (!title) return;

    // Extract Image
    const img = card.querySelector('img.img, img[data-src], img');
    const imgSrc = img ? (img.getAttribute('data-src') || img.getAttribute('src') || '') : '';

    // Extract Price
    let currentPriceNum = null;
    let currentPrice = '';
    const prcEl = card.querySelector('.prc, [data-price]');
    if (prcEl) {
      currentPrice = prcEl.innerText.trim();
      currentPriceNum = cleanNumber(currentPrice);
    }

    // Extract Old Price
    let oldPriceNum = null;
    let oldPrice = null;
    const oldPrcEl = card.querySelector('.old');
    if (oldPrcEl) {
      oldPrice = oldPrcEl.innerText.trim();
      oldPriceNum = cleanNumber(oldPrice);
    }

    // Extract Discount Badge
    let discount = null;
    const bdgEl = card.querySelector('.bdg._dsct, .tag._dsct');
    if (bdgEl) {
      discount = bdgEl.innerText.trim();
    } else if (currentPriceNum && oldPriceNum && oldPriceNum > currentPriceNum) {
      const pct = Math.round(((oldPriceNum - currentPriceNum) / oldPriceNum) * 100);
      if (pct > 0) discount = `${pct}% OFF`;
    }

    items.push({
      asin,
      store: 'jumia',
      store_sku: rawSku,
      title,
      currentPrice: currentPrice || (currentPriceNum ? `EGP ${currentPriceNum}` : ''),
      currentPriceNum,
      oldPrice: oldPrice || (oldPriceNum ? `EGP ${oldPriceNum}` : null),
      oldPriceNum,
      currency: 'EGP',
      discount,
      category: categoryName,
      categoryId: categoryId,
      productUrl,
      imgSrc
    });
  });

  return items;
}

/**
 * Universal auto-detection and extraction
 */
function extractUniversal(doc, options = {}) {
  // Check if Jumia page
  if (doc.querySelector('article.prd, a.core[href*="jumia.com"], .c-prd')) {
    return extractJumia(doc, options);
  }

  // Check if Amazon Tez page
  if (doc.querySelectorAll('button[data-csa-c-slot-id*="AddToCart"]').length > 0) {
    const tezItems = extractAmazonTez(doc, options);
    if (tezItems.length > 0) return tezItems;
  }

  // Fallback to Amazon General search/department
  return extractAmazonGeneral(doc, options);
}

module.exports = {
  cleanNumber,
  extractAmazonTez,
  extractAmazonGeneral,
  extractJumia,
  extractUniversal
};
