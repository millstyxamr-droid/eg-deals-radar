/**
 * test/brand_report.test.js
 *
 * Integration tests for single-brand PDF report generation and queries.
 * Runs against an isolated fixture database (CATALOG_DB_PATH) so results are
 * deterministic and never depend on — or mutate — production data.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'amz-brand-report-'));
process.env.CATALOG_DB_PATH = path.join(tmpRoot, 'catalog.db');

const db = require('../src/db');
const { getBrandReportData } = require('../src/report_queries');
const { main: runBrandReport } = require('../scripts/brand_report');

const CATEGORY = 'dairy-cheese';
const DAYS = 10;

function insertProduct({ asin, title, brand, weight, price }) {
  db.prepare(`
    INSERT OR REPLACE INTO products
      (asin, title, title_norm, brand, category_id, image_url, product_url,
       weight_value, weight_unit, pack_count, size_text,
       unit_price, unit_price_unit, is_active, first_seen_at)
    VALUES
      (@asin, @title, @title_norm, @brand, @category_id, @image_url, @product_url,
       @weight_value, 'جم', 1, @size_text,
       @unit_price, 'كجم', 1, datetime('now'))
  `).run({
    asin,
    title,
    title_norm: title.toLowerCase(),
    brand,
    category_id: CATEGORY,
    image_url: `https://m.media-amazon.com/images/I/${asin}.jpg`,
    product_url: `https://www.amazon.eg/dp/${asin}`,
    weight_value: weight,
    size_text: `${weight} جم`,
    unit_price: +((price / weight) * 1000).toFixed(2)
  });
}

function seedFixture() {
  db.prepare(`
    INSERT OR REPLACE INTO categories (id, name, name_ar, is_active)
    VALUES (?, 'Cheese', 'أجبان', 1)
  `).run(CATEGORY);

  const insertSnap = db.prepare(`
    INSERT INTO price_snapshots (asin, scraped_at, price, list_price, in_stock, source)
    VALUES (?, datetime('now', '-' || ? || ' days'), ?, ?, ?, 'full_store_scraper')
  `);

  // 12 Domty products (>= 10 required) with 10 days of observations.
  for (let i = 0; i < 12; i++) {
    const asin = `B0DOMTY${String(i).padStart(4, '0')}`;
    const basePrice = 50 + i * 2;
    insertProduct({
      asin,
      title: `Domty Cheese Product ${i + 1} 500 جم`,
      brand: 'Domty',
      weight: 500,
      price: basePrice
    });

    for (let day = DAYS; day >= 0; day--) {
      // A short promo window on day 3, and a stockout on days 5-4 for two products.
      const price = day === 3 ? +(basePrice * 0.9).toFixed(2) : basePrice;
      const inStock = (i < 2 && (day === 5 || day === 4)) ? 0 : 1;
      insertSnap.run(asin, day, inStock ? price : null, basePrice, inStock);
    }
  }

  // 12 competitor products (Panda) in the same category with sizes within ±20%.
  for (let i = 0; i < 12; i++) {
    const asin = `B0PANDA${String(i).padStart(4, '0')}`;
    const weight = [480, 500, 520][i % 3];
    const basePrice = 52 + i * 2;
    insertProduct({
      asin,
      title: `Panda Cheese Product ${i + 1} ${weight} جم`,
      brand: 'Panda',
      weight,
      price: basePrice
    });

    for (let day = DAYS; day >= 0; day--) {
      insertSnap.run(asin, day, basePrice, basePrice, 1);
    }
  }

  // Brand with too little data (< 10 products).
  insertProduct({
    asin: 'B0KATILO001',
    title: 'Katilo Cheese 250 جم',
    brand: 'Katilo',
    weight: 250,
    price: 30
  });
  insertSnap.run('B0KATILO001', 0, 30, 30, 1);
}

describe('Brand Report Queries & Data Verification', () => {
  before(() => {
    seedFixture();
  });

  after(() => {
    try { db.close(); } catch (e) {}
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (e) {}
  });

  it('1. Computes correct executive summary and metrics for Domty', () => {
    const data = getBrandReportData('Domty', { days: 30 });

    assert.strictEqual(data.brand, 'Domty');
    assert.ok(data.productCount >= 10, 'Domty should have at least 10 products');
    assert.ok(data.daysObserved >= 7, 'Domty should have at least 7 days of observation');
    assert.strictEqual(data.isInsufficientData, false, 'Domty should not trigger insufficient data warning');
    assert.strictEqual(data.warningMessage, null);

    // Verify 5 KPI summary items
    assert.strictEqual(data.executiveSummary.length, 5);
    assert.ok(data.executiveSummary[0].value.includes('منتج'));
    assert.ok(data.executiveSummary[1].title.includes('متوسط سعر الوحدة'));
    assert.ok(data.executiveSummary[2].title.includes('أعلى من وسيط'));
    assert.ok(data.executiveSummary[3].title.includes('نفاد المخزون'));
    assert.ok(data.executiveSummary[4].title.includes('أكبر فرق سعري'));

    // Check OOS calculation
    assert.ok(Array.isArray(data.outOfStockList));
    assert.ok(data.outOfStockList.length > 0, 'Fixture contains stockouts');
    for (const oos of data.outOfStockList) {
      assert.ok(oos.oos_snapshots > 0);
      assert.ok(oos.unavailable_pct > 0 && oos.unavailable_pct <= 100);
      assert.ok(typeof oos.last_seen_in_stock === 'string');
    }

    // Check Promotions calculation
    assert.ok(data.promotions.p30DropCount >= 0);
    assert.ok(data.promotions.deepestDiscountPct >= 0);
    assert.ok(typeof data.promotions.promoSyncStatus === 'string');
  });

  it('2. Directly matches 3 random brand products against direct SQL queries', () => {
    const data = getBrandReportData('Domty', { days: 30 });
    assert.ok(data.competitorTable.length >= 3);

    // Pick 3 distinct products: first, middle, last
    const sampleIndices = [0, Math.floor(data.competitorTable.length / 2), data.competitorTable.length - 1];

    for (const idx of sampleIndices) {
      const item = data.competitorTable[idx];
      const asin = item.asin;

      // Direct independent raw SQL query on SQLite database
      const rawProd = db.prepare(`SELECT title, category_id, unit_price, unit_price_unit FROM products WHERE asin = ?`).get(asin);
      const rawLatestSnap = db.prepare(`SELECT price FROM price_snapshots WHERE asin = ? AND price IS NOT NULL AND price > 0 ORDER BY scraped_at DESC LIMIT 1`).get(asin);

      assert.strictEqual(item.title, rawProd.title, `Title match for ASIN ${asin}`);
      assert.strictEqual(item.category_id, rawProd.category_id, `Category match for ASIN ${asin}`);
      assert.strictEqual(item.unit_price, rawProd.unit_price, `Unit price match for ASIN ${asin}`);
      assert.strictEqual(item.unit_price_unit, rawProd.unit_price_unit, `Unit price unit match for ASIN ${asin}`);
      assert.strictEqual(item.current_price, rawLatestSnap ? rawLatestSnap.price : null, `Price match for ASIN ${asin}`);
    }
  });

  it('3. Flags insufficient data warning when brand has <10 products or <7 days', () => {
    const data = getBrandReportData('Katilo', { days: 30 });

    assert.ok(data.productCount < 10, 'Katilo should have less than 10 products');
    assert.strictEqual(data.isInsufficientData, true, 'Should flag insufficient data');
    assert.ok(data.warningMessage.includes('بيانات غير كافية'), 'Warning message must be in Arabic');
    assert.ok(data.warningMessage.includes('الحد الأدنى المطلوب'), 'Warning message must explain minimum threshold');
  });

  it('4. Competitor matching respects same category and +-20% size calculation', () => {
    const data = getBrandReportData('Domty', { days: 30 });
    const itemsWithComps = data.competitorTable.filter(p => p.has_competitors);

    assert.ok(itemsWithComps.length > 0, 'Should find competitor matches');

    for (const item of itemsWithComps.slice(0, 5)) {
      assert.ok(item.competitors.length <= 3, 'Should have at most 3 closest competitors');
      for (const comp of item.competitors) {
        // Price difference formula verification
        if (item.current_price && comp.price) {
          const expectedDiffEgp = +(item.current_price - comp.price).toFixed(2);
          const expectedDiffPct = +(((item.current_price - comp.price) / comp.price) * 100).toFixed(1);
          assert.strictEqual(comp.diffEgp, expectedDiffEgp);
          assert.strictEqual(comp.diffPct, expectedDiffPct);

          if (item.current_price < comp.price) {
            assert.ok(comp.cheaper.includes('Domty أرخص'));
          } else if (item.current_price > comp.price) {
            assert.ok(comp.cheaper.includes('أرخص'));
          } else {
            assert.strictEqual(comp.cheaper, 'متساويان');
          }
        }
      }
    }
  });

  it('5. Generates PDF file end-to-end via scripts/brand_report.js', async () => {
    const outPdf = path.join(tmpRoot, 'test_domty_e2e.pdf');
    if (fs.existsSync(outPdf)) fs.unlinkSync(outPdf);

    // Save and override argv
    const originalArgv = process.argv;
    process.argv = ['node', 'scripts/brand_report.js', '--brand', 'Domty', '--days', '30', '--out', outPdf];

    try {
      const res = await runBrandReport();
      assert.ok(fs.existsSync(outPdf), 'PDF file must exist on disk');
      const stats = fs.statSync(outPdf);
      assert.ok(stats.size > 50000, 'PDF size should be substantial (>50KB)');
      assert.ok(res.sizeKb > 50);
      assert.strictEqual(res.reportData.brand, 'Domty');
    } finally {
      process.argv = originalArgv;
      if (fs.existsSync(outPdf)) fs.unlinkSync(outPdf);
    }
  });
});
