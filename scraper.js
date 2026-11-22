/**
 * Amazon Egypt Tez / Now Scraper (Node.js + Playwright)
 * 
 * Usage:
 *   npm install playwright
 *   npx playwright install chromium
 *   node scraper.js
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const TARGET_URL = 'https://www.amazon.eg/tez/browse?qcbrand=sAuWWBROaG';

async function scrapeAmazonTez(targetUrl = TARGET_URL) {
  console.log(`[+] Starting browser to scrape: ${targetUrl}`);
  
  const browser = await chromium.launch({
    headless: true
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'ar-EG',
    viewport: { width: 1366, height: 768 }
  });

  const page = await context.newPage();

  try {
    console.log('[+] Navigating to page...');
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Handle location modal / bottom sheet if it appears
    try {
      const skipBtn = page.locator('button:has-text("Skip for now"), button:has-text("تخطي"), button[data-testid="bottom-sheet-close-button"]');
      if (await skipBtn.isVisible({ timeout: 5000 })) {
        await skipBtn.click();
        console.log('[+] Dismissed location modal.');
      }
    } catch (e) {
      // Modal didn't show or auto-dismissed
    }

    // Scroll down to load all products via infinite scroll
    console.log('[+] Scrolling to trigger infinite scroll loading...');
    let previousHeight = 0;
    let retries = 0;

    while (retries < 3) {
      await page.evaluate(() => window.scrollBy(0, 1500));
      await page.waitForTimeout(1500);

      const currentHeight = await page.evaluate(() => document.body.scrollHeight);
      if (currentHeight === previousHeight) {
        retries++;
      } else {
        retries = 0;
        previousHeight = currentHeight;
      }

      // Check if footer reached
      const isFooterVisible = await page.evaluate(() => {
        const text = document.body.innerText;
        return text.includes('Everything you need, delivered now') || text.includes('كل ما تحتاجه');
      });
      if (isFooterVisible && retries > 1) break;
    }

    console.log('[+] Extracting product cards from DOM...');
    const products = await page.evaluate(() => {
      const results = [];
      const addButtons = document.querySelectorAll('button[data-csa-c-slot-id="AsinFaceout-AddToCart"]');

      addButtons.forEach((btn, idx) => {
        const contentId = btn.getAttribute('data-csa-c-content-id') || '';
        const asinMatch = contentId.match(/AsinFaceout-AddToCart-([A-Z0-9]{10})/);
        const asin = asinMatch ? asinMatch[1] : '';
        const title = btn.getAttribute('data-csa-c-product-title') || '';
        const category = btn.getAttribute('data-csa-c-widget') || '';

        // Walk up to find card container
        let card = btn.closest('[role="button"]') || btn.parentElement;
        while (card && card.tagName !== 'BODY' && !card.querySelector('img')) {
          card = card.parentElement;
        }

        let imgSrc = '';
        let currentPrice = '';
        let currentPriceNum = null;
        let oldPrice = null;
        let oldPriceNum = null;
        let discount = null;

        if (card) {
          const img = card.querySelector('img');
          if (img) imgSrc = img.getAttribute('src') || '';

          // Find price elements
          const priceEls = card.querySelectorAll('[aria-label*="EGP"], [aria-label*="جنيه"]');
          if (priceEls.length > 0) {
            currentPrice = priceEls[0].getAttribute('aria-label') || priceEls[0].innerText || '';
            const match = currentPrice.match(/[\d,.]+/);
            if (match) currentPriceNum = parseFloat(match[0].replace(/,/g, ''));
          }
          if (priceEls.length > 1) {
            oldPrice = priceEls[1].getAttribute('aria-label') || priceEls[1].innerText || '';
            const match = oldPrice.match(/[\d,.]+/);
            if (match) oldPriceNum = parseFloat(match[0].replace(/,/g, ''));
          }

          // Discount badge
          const badgeEl = Array.from(card.querySelectorAll('p, span')).find(el => el.innerText && el.innerText.includes('% OFF'));
          if (badgeEl) discount = badgeEl.innerText.trim();
        }

        if (asin && title) {
          results.push({
            asin,
            title,
            currentPrice: currentPrice || (currentPriceNum ? `EGP ${currentPriceNum}` : ''),
            currentPriceNum,
            oldPrice: oldPrice || (oldPriceNum ? `EGP ${oldPriceNum}` : null),
            oldPriceNum,
            currency: 'EGP',
            discount,
            category,
            productUrl: `https://www.amazon.eg/dp/${asin}`,
            imgSrc
          });
        }
      });

      return results;
    });

    console.log(`[+] Successfully extracted ${products.length} products.`);

    const outJson = path.join(__dirname, 'products.json');
    fs.writeFileSync(outJson, JSON.stringify(products, null, 2), 'utf-8');
    console.log(`[+] Saved to ${outJson}`);

    return products;
  } catch (err) {
    console.error('[-] Error scraping Amazon Tez:', err);
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  scrapeAmazonTez().then(() => {
    // Run Deal Analysis
    const { analyzeDeals } = require('./deals_tracker.js');
    analyzeDeals();
    // Run export script to update CSV, XLS, and HTML
    require('./export_data.js');
  });
}

module.exports = { scrapeAmazonTez };
