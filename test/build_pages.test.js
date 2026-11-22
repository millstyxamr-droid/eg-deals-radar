const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ---------------------------------------------------------------------------
// Hermetic setup: build against an isolated SQLite DB + isolated dist folder.
// These tests must NEVER depend on (or write to) the production database.
// ---------------------------------------------------------------------------
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'amz-pages-test-'));
const tmpDbPath = path.join(tmpRoot, 'catalog.db');
const distDir = path.join(tmpRoot, 'dist');

process.env.CATALOG_DB_PATH = tmpDbPath;
process.env.AMAZON_AFFILIATE_TAG = 'testtag-21';

const db = require('../src/db');
const { buildDealsPage } = require('../src/build_deals_page');
const { buildBrandPages } = require('../src/build_brand_pages');
const { getAffiliateTag } = require('../src/affiliate');

function seedFixture() {
  db.prepare(`
    INSERT OR REPLACE INTO categories (id, name, name_ar, is_active)
    VALUES ('dairy-cheese', 'Cheese', 'أجبان', 1)
  `).run();

  const insertProduct = db.prepare(`
    INSERT OR REPLACE INTO products
      (asin, title, title_norm, brand, category_id, image_url, product_url,
       weight_value, weight_unit, pack_count, size_text, is_active, first_seen_at)
    VALUES
      (@asin, @title, @title_norm, @brand, @category_id, @image_url, @product_url,
       @weight_value, @weight_unit, 1, @size_text, 1, datetime('now'))
  `);

  insertProduct.run({
    asin: 'B0TEST00001',
    title: 'TestBrand Cheese 500g',
    title_norm: 'testbrand cheese 500g',
    brand: 'TestBrand',
    category_id: 'dairy-cheese',
    image_url: 'https://m.media-amazon.com/images/I/test-cheese.jpg',
    product_url: 'https://www.amazon.eg/dp/B0TEST00001',
    weight_value: 500,
    weight_unit: 'g',
    size_text: '500g'
  });

  insertProduct.run({
    asin: 'B0TEST00002',
    title: 'TestBrand Butter 250g',
    title_norm: 'testbrand butter 250g',
    brand: 'TestBrand',
    category_id: 'dairy-cheese',
    image_url: 'https://m.media-amazon.com/images/I/test-butter.jpg',
    product_url: 'https://www.amazon.eg/dp/B0TEST00002',
    weight_value: 250,
    weight_unit: 'g',
    size_text: '250g'
  });

  const insertSnap = db.prepare(`
    INSERT INTO price_snapshots (asin, scraped_at, price, list_price, in_stock, source)
    VALUES (?, datetime('now', '-' || ? || ' days'), ?, ?, 1, 'full_store_scraper')
  `);

  // 30 days of stable history at 100 EGP, then a genuine drop to 70 EGP today.
  for (let day = 30; day >= 1; day--) {
    insertSnap.run('B0TEST00001', day, 100, 100);
  }
  insertSnap.run('B0TEST00001', 0, 70, 100);

  // Second product with a shorter, also-valid history (kept at normal price).
  for (let day = 10; day >= 1; day--) {
    insertSnap.run('B0TEST00002', day, 50, 50);
  }
  insertSnap.run('B0TEST00002', 0, 50, 50);
}

describe('Static Site Generator Tests (Deals & Brand Pages)', () => {
  before(() => {
    seedFixture();
  });

  after(() => {
    try { db.close(); } catch (e) {}
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (e) {}
  });

  test('Test Case 1: Build deals page produces valid dist/index.html under 500KB', () => {
    const result = buildDealsPage({ distDir });

    assert.strictEqual(fs.existsSync(result.outputPath), true, 'dist/index.html must exist');
    assert.strictEqual(result.sizeBytes < 500 * 1024, true, `File size (${result.sizeKb} KB) must be less than 500 KB`);
    assert.strictEqual(result.totalDeals > 0, true, 'Should have qualified deals on page');
  });

  test('Test Case 2: Strict Exclusion - No confidence="low" product appears on page', () => {
    const htmlPath = path.join(distDir, 'index.html');
    const html = fs.readFileSync(htmlPath, 'utf-8');

    // Ensure no cards are marked with low confidence or gathering data placeholder
    assert.strictEqual(html.includes('data-confidence="low"'), false, 'No low confidence data attribute');
    assert.strictEqual(html.includes('confidence=low'), false, 'No confidence=low in markup');
    assert.strictEqual(html.includes('لسه بنجمع بيانات'), false, 'Products still gathering data must be excluded');
  });

  test('Test Case 3: Affiliate Links - Every Amazon link has affiliate tag applied', () => {
    const htmlPath = path.join(distDir, 'index.html');
    const html = fs.readFileSync(htmlPath, 'utf-8');
    const tag = getAffiliateTag();

    const linkRegex = /href="([^"]+)"/g;
    let match;
    let amazonLinksCount = 0;

    while ((match = linkRegex.exec(html)) !== null) {
      const url = match[1];
      if (url.includes('amazon.eg') || url.includes('/dp/')) {
        amazonLinksCount++;
        assert.strictEqual(url.includes(`tag=${tag}`), true, `Amazon link ${url} must contain tag=${tag}`);
      }
    }

    assert.strictEqual(amazonLinksCount > 0, true, 'Page must contain at least one Amazon product link');
  });

  test('Test Case 4: SEO, Accessibility, Mobile-First and Performance Attributes', () => {
    const htmlPath = path.join(distDir, 'index.html');
    const html = fs.readFileSync(htmlPath, 'utf-8');

    // RTL & Language
    assert.strictEqual(html.includes('dir="rtl"'), true, 'Must have dir="rtl"');
    assert.strictEqual(html.includes('lang="ar"'), true, 'Must have lang="ar"');

    // Dark Mode
    assert.strictEqual(html.includes('prefers-color-scheme: dark'), true, 'Must support dark mode');

    // JSON-LD ItemList
    assert.strictEqual(html.includes('"@type": "ItemList"'), true, 'Must include Schema.org ItemList');
    assert.strictEqual(html.includes('"@type": "Product"'), true, 'Must include Schema.org Product entries');

    // Image Lazy Loading
    assert.strictEqual(html.includes('loading="lazy"'), true, 'Must use lazy loading on images');

    // Canonical & OG tags
    assert.strictEqual(html.includes('rel="canonical"'), true, 'Must have canonical URL');
    assert.strictEqual(html.includes('og:title'), true, 'Must have og:title');
    assert.strictEqual(html.includes('og:image'), true, 'Must have og:image');

    // All Time Low Badge
    assert.strictEqual(html.includes('أقل سعر تاريخي'), true, 'Must render All Time Low badge');

    // Typical Price (median 90 days)
    assert.strictEqual(html.includes('المعتاد:'), true, 'Must show typical price (median 90 days)');
  });

  test('Test Case 5: Brand pages build and B2B directory generated', () => {
    const result = buildBrandPages({ distDir });

    assert.strictEqual(result.totalBrands > 0, true, 'Should generate pages for brands');
    const brandsDir = path.join(distDir, 'brand');
    const directoryPath = path.join(brandsDir, 'index.html');
    assert.strictEqual(fs.existsSync(directoryPath), true, 'Brand directory must exist');

    const dirHtml = fs.readFileSync(directoryPath, 'utf-8');
    assert.strictEqual(dirHtml.includes('دليل الماركات'), true, 'Directory must have title');
    assert.strictEqual(dirHtml.includes('سعر الوحدة'), true, 'Must mention unit price');
  });

});
