const { test, describe } = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const {
  parseSize,
  calculateUnitPrice,
  formatUnitPrice,
  calculatePercentile,
  getPriceStats,
  classifyDeal,
  calculatePriceIndices
} = require('../src/pricing');

describe('Pricing Engine & Historical Deals Tests', () => {

  test('Test Case 1: Product with price constant 100 for 30 days then drops to 70 -> is_real_deal=true and historical_discount_pct=30', () => {
    // Setup in-memory sqlite db
    const memDb = new Database(':memory:');
    memDb.exec(`
      CREATE TABLE price_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        asin TEXT NOT NULL,
        scraped_at TEXT NOT NULL,
        price REAL,
        list_price REAL,
        source TEXT
      );
    `);

    const insertStmt = memDb.prepare(`
      INSERT INTO price_snapshots (asin, scraped_at, price, list_price)
      VALUES (?, datetime('now', '-' || ? || ' days'), ?, ?)
    `);

    // Insert 30 snapshots with price 100 across 30 days
    for (let day = 30; day >= 1; day--) {
      insertStmt.run('PROD_STABLE_DROP', day, 100.0, 100.0);
    }

    // Insert today's snapshot with price 70
    memDb.prepare(`
      INSERT INTO price_snapshots (asin, scraped_at, price, list_price)
      VALUES (?, datetime('now'), ?, ?)
    `).run('PROD_STABLE_DROP', 70.0, 100.0);

    const stats90 = getPriceStats('PROD_STABLE_DROP', 90, memDb);
    const statsAllTime = getPriceStats('PROD_STABLE_DROP', null, memDb);

    assert.strictEqual(stats90.count, 31, 'Should have 31 snapshots');
    assert.strictEqual(stats90.days_observed >= 30, true, 'Should have observed at least 30 days');
    assert.strictEqual(stats90.median, 100.0, 'Typical price (median) should be 100');
    assert.strictEqual(stats90.p30, 100.0, 'Fair price (p30) should be 100');

    const deal = classifyDeal({
      price: 70.0,
      oldPriceNum: 100.0,
      stats90,
      statsAllTime
    });

    assert.strictEqual(deal.is_real_deal, true, 'is_real_deal must be true');
    assert.strictEqual(deal.historical_discount_pct, 30, 'historical_discount_pct must be exactly 30%');
    assert.strictEqual(deal.confidence, 'high', 'confidence must be high (>=30 days and >=20 count)');
    assert.strictEqual(deal.all_time_low, true, 'all_time_low must be true (70 <= 70)');
  });

  test('Test Case 2: Product with price 70 from day 1 (no history) -> is_real_deal=false and confidence=low', () => {
    const memDb = new Database(':memory:');
    memDb.exec(`
      CREATE TABLE price_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        asin TEXT NOT NULL,
        scraped_at TEXT NOT NULL,
        price REAL,
        list_price REAL,
        source TEXT
      );
    `);

    // Only 1 snapshot today
    memDb.prepare(`
      INSERT INTO price_snapshots (asin, scraped_at, price, list_price)
      VALUES (?, datetime('now'), ?, ?)
    `).run('PROD_NEW', 70.0, 120.0);

    const stats90 = getPriceStats('PROD_NEW', 90, memDb);
    const statsAllTime = getPriceStats('PROD_NEW', null, memDb);

    assert.strictEqual(stats90.count, 1, 'Should have 1 snapshot');
    assert.strictEqual(stats90.days_observed, 1, 'Should have 1 day observed');

    const deal = classifyDeal({
      price: 70.0,
      oldPriceNum: 120.0,
      stats90,
      statsAllTime
    });

    assert.strictEqual(deal.is_real_deal, false, 'is_real_deal must be false for new products');
    assert.strictEqual(deal.confidence, 'low', 'confidence must be low');
    assert.strictEqual(deal.historical_discount_pct, null, 'historical_discount_pct should be null');
    assert.strictEqual(deal.display_discount, 'لسه بنجمع بيانات', 'Should display data gathering placeholder');
    // oldPriceNum is context only:
    assert.strictEqual(deal.advertised_discount_pct, 42, 'Advertised discount is recorded as context only');
  });

  describe('Test Case 3: 10 Unit Price Cases', () => {

    test('1. 1 كجم (Solids: 1 kg at 50 EGP)', () => {
      const size = parseSize('أرز مصري فاخر 1 كجم');
      assert.ok(size);
      assert.strictEqual(size.weight_value, 1);
      assert.strictEqual(size.weight_unit, 'كجم');
      const calc = calculateUnitPrice(50, size);
      assert.ok(calc);
      assert.strictEqual(calc.unit_price, 50.0);
      assert.strictEqual(calc.unit_price_unit, 'ج.م/كجم');
    });

    test('2. 500 جم (Solids: 500g at 25 EGP)', () => {
      const size = parseSize('مكرونة إيطاليانو 500 جم');
      assert.ok(size);
      assert.strictEqual(size.weight_value, 500);
      assert.strictEqual(size.weight_unit, 'جم');
      const calc = calculateUnitPrice(25, size);
      assert.ok(calc);
      assert.strictEqual(calc.unit_price, 50.0);
      assert.strictEqual(calc.unit_price_unit, 'ج.م/كجم');
    });

    test('3. 6 × 100 جم (Multi-pack Solids: 6x100g at 60 EGP)', () => {
      const size = parseSize('تونة صن شاين 6 × 100 جم');
      assert.ok(size);
      assert.strictEqual(size.pack_count, 6);
      assert.strictEqual(size.weight_value, 100);
      assert.strictEqual(size.weight_unit, 'جم');
      const calc = calculateUnitPrice(60, size);
      assert.ok(calc);
      // Total weight = 6 * 0.1kg = 0.6kg. Price = 60 / 0.6 = 100 EGP/kg
      assert.strictEqual(calc.unit_price, 100.0);
      assert.strictEqual(calc.unit_price_unit, 'ج.م/كجم');
    });

    test('4. 1.5 لتر (Liquids: 1.5 L at 30 EGP)', () => {
      const size = parseSize('مياه معدنية طبيعية 1.5 لتر');
      assert.ok(size);
      assert.strictEqual(size.weight_value, 1.5);
      assert.strictEqual(size.weight_unit, 'لتر');
      const calc = calculateUnitPrice(30, size);
      assert.ok(calc);
      // 30 / 1.5 = 20 EGP/L
      assert.strictEqual(calc.unit_price, 20.0);
      assert.strictEqual(calc.unit_price_unit, 'ج.م/لتر');
    });

    test('5. 750 مل (Liquids: 750 ml at 15 EGP)', () => {
      const size = parseSize('صابون سائل فيري 750 مل');
      assert.ok(size);
      assert.strictEqual(size.weight_value, 750);
      assert.strictEqual(size.weight_unit, 'مل');
      const calc = calculateUnitPrice(15, size);
      assert.ok(calc);
      // 15 / 0.75 = 20 EGP/L
      assert.strictEqual(calc.unit_price, 20.0);
      assert.strictEqual(calc.unit_price_unit, 'ج.م/لتر');
    });

    test('6. 12 قطعة (Countables: 12 pieces at 120 EGP)', () => {
      const size = parseSize('شوكولاتة جالاكسي ميني 12 قطعة');
      assert.ok(size);
      assert.strictEqual(size.weight_value, 12);
      assert.strictEqual(size.weight_unit, 'قطعة');
      const calc = calculateUnitPrice(120, size);
      assert.ok(calc);
      // 120 / 12 = 10 EGP/piece
      assert.strictEqual(calc.unit_price, 10.0);
      assert.strictEqual(calc.unit_price_unit, 'ج.م/قطعة');
    });

    test('7. 2 لتر (Liquids: 2 L at 40 EGP)', () => {
      const size = parseSize('زيت دوار الشمس عافية 2 لتر');
      assert.ok(size);
      assert.strictEqual(size.weight_value, 2);
      assert.strictEqual(size.weight_unit, 'لتر');
      const calc = calculateUnitPrice(40, size);
      assert.ok(calc);
      assert.strictEqual(calc.unit_price, 20.0);
      assert.strictEqual(calc.unit_price_unit, 'ج.م/لتر');
    });

    test('8. 250 جم (Solids: 250g at 20 EGP)', () => {
      const size = parseSize('جبنة بيضاء دومتي 250 جم');
      assert.ok(size);
      assert.strictEqual(size.weight_value, 250);
      assert.strictEqual(size.weight_unit, 'جم');
      const calc = calculateUnitPrice(20, size);
      assert.ok(calc);
      // 20 / 0.25 = 80 EGP/kg
      assert.strictEqual(calc.unit_price, 80.0);
      assert.strictEqual(calc.unit_price_unit, 'ج.م/كجم');
    });

    test('9. 4 × 250 مل (Multi-pack Liquids: 4x250ml at 50 EGP)', () => {
      const size = parseSize('عصير جهينة برتقال 4 × 250 مل');
      assert.ok(size);
      assert.strictEqual(size.pack_count, 4);
      assert.strictEqual(size.weight_value, 250);
      assert.strictEqual(size.weight_unit, 'مل');
      const calc = calculateUnitPrice(50, size);
      assert.ok(calc);
      // Total volume = 4 * 0.25L = 1L. Price = 50 / 1 = 50 EGP/L
      assert.strictEqual(calc.unit_price, 50.0);
      assert.strictEqual(calc.unit_price_unit, 'ج.م/لتر');
    });

    test('10. 20 كيس (Countables: 20 sachets at 40 EGP)', () => {
      const size = parseSize('نسكافيه 3 في 1 عبوة 20 كيس');
      assert.ok(size);
      assert.strictEqual(size.weight_value, 20);
      assert.strictEqual(size.weight_unit, 'قطعة');
      const calc = calculateUnitPrice(40, size);
      assert.ok(calc);
      // 40 / 20 = 2 EGP/piece
      assert.strictEqual(calc.unit_price, 2.0);
      assert.strictEqual(calc.unit_price_unit, 'ج.م/قطعة');
    });
  });

  test('Arabic formatting: formatUnitPrice returns "٤٥.٥ ج.م/كجم" and "—" on null', () => {
    assert.strictEqual(formatUnitPrice(45.5, 'ج.م/كجم'), '٤٥.٥ ج.م/كجم');
    assert.strictEqual(formatUnitPrice(null, 'ج.م/كجم'), '—');
    assert.strictEqual(formatUnitPrice(undefined), '—');
    assert.strictEqual(formatUnitPrice(0, 'ج.م/كجم'), '—');
    assert.strictEqual(formatUnitPrice(100, null), '—');
  });

  test('Deterministic Percentiles', () => {
    const list = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    const p10 = calculatePercentile(list, 10);
    const p30 = calculatePercentile(list, 30);
    const p50 = calculatePercentile(list, 50);
    const p90 = calculatePercentile(list, 90);

    assert.strictEqual(p10, 19);
    assert.strictEqual(p30, 37);
    assert.strictEqual(p50, 55);
    assert.strictEqual(p90, 91);
  });

  test('Internal Price Index Comparison (price_index)', () => {
    const prods = [
      { id: '1', category_id: 'cat1', unit_price: 50.0, unit_price_unit: 'ج.م/كجم' },
      { id: '2', category_id: 'cat1', unit_price: 100.0, unit_price_unit: 'ج.م/كجم' },
      { id: '3', category_id: 'cat1', unit_price: 150.0, unit_price_unit: 'ج.م/كجم' },
    ];
    // Median for cat1_ج.م/كجم is 100.0
    const indexed = calculatePriceIndices(prods);
    assert.strictEqual(indexed[0].price_index, 0.5); // 50 / 100
    assert.strictEqual(indexed[1].price_index, 1.0); // 100 / 100
    assert.strictEqual(indexed[2].price_index, 1.5); // 150 / 100
  });

  test('Strict Rule: oldPriceNum is NOT used for is_real_deal or ranking', () => {
    // Product has an inflated oldPriceNum (e.g. 500 vs 100), but history shows typical price is 100.
    // Price drops to 98 (only 2% discount from typical price 100).
    const stats90 = {
      count: 20,
      days_observed: 20,
      min: 95,
      max: 105,
      p30: 98,
      median: 100
    };
    const statsAllTime = stats90;

    const deal = classifyDeal({
      price: 98,
      oldPriceNum: 500, // Amazon claims 80% OFF!
      stats90,
      statsAllTime
    });

    // Despite 80% advertised discount, it is NOT a real deal because 98 is not < typical * 0.95 (95)
    assert.strictEqual(deal.advertised_discount_pct, 80, 'Advertised discount stored for context');
    assert.strictEqual(deal.is_real_deal, false, 'is_real_deal must reject fake Amazon discounts');
  });

  test('Data integrity: synthetic seed_history snapshots are excluded from stats and deals', () => {
    const memDb = new Database(':memory:');
    memDb.exec(`
      CREATE TABLE price_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        asin TEXT NOT NULL,
        scraped_at TEXT NOT NULL,
        price REAL,
        list_price REAL,
        source TEXT
      );
    `);

    const insert = memDb.prepare(`
      INSERT INTO price_snapshots (asin, scraped_at, price, list_price, source)
      VALUES (?, datetime('now', '-' || ? || ' days'), ?, ?, ?)
    `);

    // 30 days of synthetic history claiming a much higher typical price.
    for (let day = 30; day >= 1; day--) {
      insert.run('PROD_SEEDED', day, 200, 200, 'seed_history');
    }
    // Today's single real live observation.
    insert.run('PROD_SEEDED', 0, 100, 200, 'full_store_scraper');

    const stats90 = getPriceStats('PROD_SEEDED', 90, memDb);
    const statsAllTime = getPriceStats('PROD_SEEDED', null, memDb);

    assert.strictEqual(stats90.count, 1, 'seed_history rows must be ignored');
    assert.strictEqual(stats90.days_observed, 1, 'Only the real snapshot counts as an observed day');
    assert.strictEqual(stats90.median, 100, 'Typical price must come from trusted data only');

    const deal = classifyDeal({ price: 100, oldPriceNum: 200, stats90, statsAllTime });
    assert.strictEqual(deal.is_real_deal, false, 'Synthetic history must never produce a real deal');
    assert.strictEqual(deal.confidence, 'low', 'Synthetic history must not raise confidence');
  });

});
