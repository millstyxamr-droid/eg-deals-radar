const { test, describe } = require('node:test');
const assert = require('node:assert');
const {
  normalizePriceText,
  parseCleanPrice,
  toFloat,
  extractPricesFromCard
} = require('../src/extract_price');

describe('Price Extraction Engine Tests (Amazon Egypt)', () => {
  test('1. normalizePriceText converts Arabic-Indic digits and cleans unicode marks', () => {
    assert.strictEqual(normalizePriceText('‏٢٤٥.٥٠ ج.م.'), '245.50 ج.م.');
    assert.strictEqual(normalizePriceText('١٬٢٥٠٫٧٥'), '1,250.75');
    assert.strictEqual(normalizePriceText('EGP  100  '), 'EGP 100');
    assert.strictEqual(normalizePriceText(''), '');
    assert.strictEqual(normalizePriceText(null), '');
  });

  test('2. toFloat correctly parses both Egyptian comma and dot decimal systems', () => {
    assert.strictEqual(toFloat('1,250.50'), 1250.5);
    assert.strictEqual(toFloat('1.250,50'), 1250.5);
    assert.strictEqual(toFloat('245.00'), 245.0);
    assert.strictEqual(toFloat('245,50'), 245.5);
    assert.strictEqual(toFloat('1,250'), 1250.0);
    assert.strictEqual(toFloat('99'), 99.0);
    assert.strictEqual(toFloat(''), null);
    assert.strictEqual(toFloat(null), null);
  });

  test('3. parseCleanPrice parses standard Egyptian Western formats', () => {
    assert.strictEqual(parseCleanPrice('EGP 245.00'), 245.0);
    assert.strictEqual(parseCleanPrice('245.00 EGP'), 245.0);
    assert.strictEqual(parseCleanPrice('245.00 ج.م'), 245.0);
    assert.strictEqual(parseCleanPrice('245.00 جنيه'), 245.0);
    assert.strictEqual(parseCleanPrice('LE 1,499.50'), 1499.5);
    assert.strictEqual(parseCleanPrice('1250 جنيه مصري'), 1250.0);
  });

  test('4. parseCleanPrice parses Eastern Arabic / Arabic-Indic digits', () => {
    assert.strictEqual(parseCleanPrice('٢٤٥.٥٠ ج.م'), 245.5);
    assert.strictEqual(parseCleanPrice('‏١٢٥٠ ج.م.'), 1250.0);
    assert.strictEqual(parseCleanPrice('٤٥٠ جنيه'), 450.0);
    assert.strictEqual(parseCleanPrice('ج.م. ٩٩.٩٩'), 99.99);
  });

  test('5. parseCleanPrice ignores promotional savings and sizes', () => {
    // "وفر 10 جنيه" should NOT parse 10 as price
    assert.strictEqual(parseCleanPrice('وفر 10 جنيه'), null);
    assert.strictEqual(parseCleanPrice('خصم 20%'), null);
    assert.strictEqual(parseCleanPrice('15% OFF'), null);
    assert.strictEqual(parseCleanPrice('1 لتر'), null);
    assert.strictEqual(parseCleanPrice('6 قطع'), null);

    // Mixed text with promo + size + real price
    assert.strictEqual(
      parseCleanPrice('حليب 1 لتر - 6 عبوات، وفر 10 جنيه، السعر 180 ج.م'),
      180.0
    );
    assert.strictEqual(
      parseCleanPrice('بامبرز مقاس 4 - 64 حفاضة خصم 15% 320.00 ج.م'),
      320.0
    );
  });

  test('6. extractPricesFromCard extracts price from standard Amazon .a-price DOM', () => {
    const mockCard = {
      querySelector: (sel) => {
        if (sel === '.a-price:not([data-a-strike="true"]):not(.a-text-price)') {
          return {
            querySelector: (sub) => {
              if (sub === '.a-offscreen') return { innerText: '245.00 ج.م.' };
              return null;
            }
          };
        }
        if (sel.includes('.a-price[data-a-strike="true"]')) {
          return null;
        }
        if (sel.includes('.a-badge-text')) {
          return { innerText: '20% OFF' };
        }
        return null;
      },
      querySelectorAll: (sel) => {
        if (sel.includes('.a-price[data-a-strike="true"]')) {
          return [{
            querySelector: (sub) => {
              if (sub === '.a-offscreen') return { innerText: '300.00 ج.م.' };
              return null;
            }
          }];
        }
        return [];
      }
    };

    const res = extractPricesFromCard(mockCard);
    assert.strictEqual(res.currentPriceNum, 245.0);
    assert.strictEqual(res.oldPriceNum, 300.0);
    assert.strictEqual(res.discount, '20% OFF');
  });

  test('7. extractPricesFromCard extracts price from Tez / Now aria-label and Arabic numerals', () => {
    const mockTezCard = {
      querySelector: () => null,
      querySelectorAll: (sel) => {
        if (sel === '[aria-label]') {
          return [
            {
              getAttribute: (attr) => attr === 'aria-label' ? '‏١٥٥.٥٠ ج.م.' : null,
              closest: () => false
            }
          ];
        }
        return [];
      }
    };

    const res = extractPricesFromCard(mockTezCard);
    assert.strictEqual(res.currentPriceNum, 155.5);
    assert.strictEqual(res.currentPrice, '155.50 ج.م.');
  });

  test('8. extractPricesFromCard correctly distinguishes current vs struck price', () => {
    const mockCard = {
      querySelector: (sel) => {
        if (sel === '.a-price:not([data-a-strike="true"]):not(.a-text-price)') {
          return {
            querySelector: (sub) => {
              if (sub === '.a-price-whole') return { innerText: '85.' };
              if (sub === '.a-price-fraction') return { innerText: '50' };
              return null;
            }
          };
        }
        return null;
      },
      querySelectorAll: (sel) => {
        if (sel.includes('.a-price[data-a-strike="true"]')) {
          return [{
            querySelector: () => ({ innerText: '110.00 ج.م' })
          }];
        }
        return [];
      }
    };

    const res = extractPricesFromCard(mockCard);
    assert.strictEqual(res.currentPriceNum, 85.5);
    assert.strictEqual(res.oldPriceNum, 110.0);
    assert.strictEqual(res.discount, '22% OFF'); // calculated fallback
  });

  test('9. Real Bug Regression: Pack + Size + Promo words does not corrupt real price', () => {
    // Card for Juhayna Milk with "1 لتر", "6 عبوات", "وفر 10 جنيه"
    const mockCard = {
      querySelector: (sel) => {
        if (sel === '.a-price:not([data-a-strike="true"]):not(.a-text-price)') {
          return {
            querySelector: (sub) => {
              if (sub === '.a-offscreen') return { innerText: '185.00 ج.م.' };
              return null;
            }
          };
        }
        if (sel.includes('.a-badge-text')) {
          return { innerText: 'وفر 10 جنيه' };
        }
        return null;
      },
      querySelectorAll: (sel) => {
        if (sel === '[aria-label]') {
          return [
            { getAttribute: () => 'وفر 10 جنيه' },
            { getAttribute: () => '185.00 ج.م.' }
          ];
        }
        return [];
      }
    };

    const res = extractPricesFromCard(mockCard);
    assert.strictEqual(res.currentPriceNum, 185.0);
    assert.notStrictEqual(res.currentPriceNum, 1);
    assert.notStrictEqual(res.currentPriceNum, 6);
    assert.notStrictEqual(res.currentPriceNum, 10);
  });

  test('10. Real Tez regression: old price uses decorationtype="strike" (not data-a-strike)', () => {
    // Captured from a live amazon.eg/tez/browse/search page:
    //   <p aria-label="‏510.30 ج.م.‏" color="primary">...</p>
    //   <p decorationtype="strike" aria-label="‏624.00 ج.م.‏">...</p>
    const currentEl = {
      getAttribute: (attr) => (attr === 'aria-label' ? '‏510.30 ج.م.‏' : null),
      innerText: '‏510.30 ج.م.‏',
      closest: () => null
    };
    const oldEl = {
      getAttribute: (attr) => (attr === 'aria-label' ? '‏624.00 ج.م.‏' : null),
      innerText: '‏624.00 ج.م.‏',
      querySelector: () => null,
      // The struck element is a descendant of a decorationtype="strike" node.
      closest: (sel) => (sel && sel.includes('decorationtype') ? {} : null)
    };

    const mockCard = {
      querySelector: () => null,
      querySelectorAll: (sel) => {
        if (sel && sel.includes('decorationtype="strike"')) return [oldEl];
        if (sel === '[aria-label]') return [currentEl, oldEl];
        return [];
      }
    };

    const res = extractPricesFromCard(mockCard);
    assert.strictEqual(res.currentPriceNum, 510.3);
    assert.strictEqual(res.oldPriceNum, 624);
    assert.strictEqual(res.discount, '18% OFF');
  });
});
