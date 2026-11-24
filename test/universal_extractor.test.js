const { test, describe } = require('node:test');
const assert = require('node:assert');
const {
  cleanNumber,
  extractAmazonGeneral,
  extractJumia
} = require('../src/scrapers/universal_extractor');

describe('Universal Extractor Tests', () => {
  test('1. cleanNumber parses various Egyptian currency formats', () => {
    assert.strictEqual(cleanNumber('EGP 1,499.50'), 1499.5);
    assert.strictEqual(cleanNumber('1,250 ج.م'), 1250);
    assert.strictEqual(cleanNumber('99.99'), 99.99);
    assert.strictEqual(cleanNumber(''), null);
    assert.strictEqual(cleanNumber(null), null);
  });

  test('2. extractAmazonGeneral correctly extracts products from standard Amazon HTML card', () => {
    // Mock DOM node for an Amazon search result
    const mockCard = {
      getAttribute: (attr) => attr === 'data-asin' ? 'B09XYZ9999' : null,
      classList: { contains: () => false },
      querySelector: (selector) => {
        if (selector.includes('a.a-link-normal') || selector.includes('a[href*="/dp/"]')) {
          return { getAttribute: () => '/dp/B09XYZ9999' };
        }
        if (selector.includes('h2')) {
          return { innerText: 'Samsung Galaxy A15 Dual SIM 128GB' };
        }
        if (selector.includes('img')) {
          return { getAttribute: () => 'https://m.media-amazon.com/images/I/test.jpg' };
        }
        if (selector.includes('.a-price:not([data-a-strike="true"]) .a-offscreen')) {
          return { innerText: 'EGP 6,800.00' };
        }
        if (selector.includes('.a-price[data-a-strike="true"] .a-offscreen')) {
          return { innerText: 'EGP 7,500.00' };
        }
        if (selector.includes('.a-badge-text')) {
          return { innerText: 'Limited time deal' };
        }
        if (selector.includes('a.a-link-normal')) {
          return { getAttribute: () => '/dp/B09XYZ9999' };
        }
        return null;
      }
    };

    const mockDoc = {
      querySelectorAll: (sel) => [mockCard]
    };

    const items = extractAmazonGeneral(mockDoc, { categoryName: 'Mobiles', categoryId: 'mobiles' });
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].asin, 'B09XYZ9999');
    assert.strictEqual(items[0].store, 'amazon');
    assert.strictEqual(items[0].title, 'Samsung Galaxy A15 Dual SIM 128GB');
    assert.strictEqual(items[0].currentPriceNum, 6800);
    assert.strictEqual(items[0].oldPriceNum, 7500);
    assert.strictEqual(items[0].discount, 'Limited time deal');
    assert.strictEqual(items[0].category, 'Mobiles');
    assert.strictEqual(items[0].productUrl, 'https://www.amazon.eg/dp/B09XYZ9999');
  });

  test('3. extractJumia correctly extracts products from Jumia HTML card', () => {
    const mockCard = {
      tagName: 'ARTICLE',
      getAttribute: (attr) => attr === 'data-id' ? 'SAM-A15-01' : null,
      querySelector: (selector) => {
        if (selector.includes('a.core') || selector.includes('a[href*=".html"]')) {
          return { getAttribute: () => '/samsung-galaxy-a15-black-SAM-A15-01.html' };
        }
        if (selector.includes('.name')) {
          return { innerText: 'Samsung Galaxy A15 - 128GB - Black' };
        }
        if (selector.includes('img')) {
          return { getAttribute: () => 'https://eg.jumia.is/images/test.jpg' };
        }
        if (selector.includes('.prc')) {
          return { innerText: '6,499.00 EGP' };
        }
        if (selector.includes('.old')) {
          return { innerText: '7,200.00 EGP' };
        }
        if (selector.includes('.bdg._dsct')) {
          return { innerText: '-10%' };
        }
        return null;
      }
    };

    const mockDoc = {
      querySelectorAll: () => [mockCard]
    };

    const items = extractJumia(mockDoc, { categoryName: 'Mobiles', categoryId: 'jumia-mobiles' });
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].asin, 'jumia:SAM-A15-01');
    assert.strictEqual(items[0].store, 'jumia');
    assert.strictEqual(items[0].store_sku, 'SAM-A15-01');
    assert.strictEqual(items[0].title, 'Samsung Galaxy A15 - 128GB - Black');
    assert.strictEqual(items[0].currentPriceNum, 6499);
    assert.strictEqual(items[0].oldPriceNum, 7200);
    assert.strictEqual(items[0].discount, '-10%');
    assert.strictEqual(items[0].productUrl, 'https://www.jumia.com.eg/samsung-galaxy-a15-black-SAM-A15-01.html');
  });
});
