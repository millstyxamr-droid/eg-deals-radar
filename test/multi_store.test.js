const { test, describe, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ---------------------------------------------------------------------------
// Hermetic setup: these tests must NEVER write to the production database.
// They previously inserted fake products (TEST_AMZ_IPHONE / jumia:TEST_...)
// into data/catalog.db.
// ---------------------------------------------------------------------------
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'eg-deals-multistore-'));
process.env.CATALOG_DB_PATH = path.join(tmpRoot, 'catalog.db');

const db = require('../src/db');
const repo = require('../src/repo');
const { withAffiliate, detectStore } = require('../src/affiliate');

after(() => {
  try { db.close(); } catch (e) {}
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (e) {}
});

describe('Multi-Store Architecture Tests', () => {
  test('1. Detect store correctly from URL', () => {
    assert.strictEqual(detectStore('https://www.amazon.eg/dp/B08XYZ1234'), 'amazon');
    assert.strictEqual(detectStore('https://www.jumia.com.eg/samsung-galaxy-a15-123.html'), 'jumia');
    assert.strictEqual(detectStore('https://www.noon.com/egypt-en/iphone-15/'), 'noon');
    assert.strictEqual(detectStore('https://example.com/item'), 'unknown');
  });

  test('2. Generate affiliate links for Jumia and Noon', () => {
    const jumiaUrl = 'https://www.jumia.com.eg/appliances-cooker-456.html';
    const jumiaAff = withAffiliate(jumiaUrl, 'slot_noon_deal');
    const parsedAdj = new URL(jumiaAff);
    assert.strictEqual(parsedAdj.origin, 'https://aal4.adj.st');
    assert.ok(parsedAdj.searchParams.has('adjust_t'));
    const innerJumia = new URL(parsedAdj.searchParams.get('adjust_redirect'));
    assert.strictEqual(innerJumia.searchParams.get('utm_source'), 'JFORCE');
    assert.strictEqual(innerJumia.searchParams.get('utm_medium'), 'JF_Affiliate');
    assert.strictEqual(innerJumia.searchParams.get('utm_campaign'), 'JF_Affiliate_EG');
    assert.ok(innerJumia.searchParams.get('adj_label').includes('casid*'));

    const noonUrl = 'https://www.noon.com/egypt-en/p-12345/';
    const noonAff = withAffiliate(noonUrl, 'noon_slot');
    const parsedNoon = new URL(noonAff);
    assert.strictEqual(parsedNoon.searchParams.get('utm_source'), 'affiliate');
    assert.strictEqual(parsedNoon.searchParams.get('utm_campaign'), 'noon_slot');
  });

  test('3. Upsert multi-store products into database', () => {
    // The products table has a foreign key on category_id, so the category
    // must exist in the isolated test database first.
    db.prepare(`
      INSERT OR REPLACE INTO categories (id, name, is_active)
      VALUES ('electronics', 'Electronics', 1)
    `).run();

    // 1. Amazon product
    const amzProd = {
      asin: 'TEST_AMZ_IPHONE',
      store: 'amazon',
      store_sku: 'B0TESTIPHONE',
      canonical_id: 'iphone-15-128gb-black',
      title: 'Apple iPhone 15 128GB Black',
      category_id: 'electronics',
      brand: 'Apple',
      product_url: 'https://www.amazon.eg/dp/B0TESTIPHONE'
    };
    repo.upsertProduct(amzProd);
    repo.insertSnapshot({
      asin: 'TEST_AMZ_IPHONE',
      store: 'amazon',
      scraped_at: '2026-11-24T00:00:00.000Z',
      price: 42000,
      list_price: 45000
    });

    // 2. Jumia product with same canonical_id
    const jumiaProd = {
      asin: 'jumia:TEST_JUMIA_IPHONE',
      store: 'jumia',
      store_sku: 'IPHONE15-BLK',
      canonical_id: 'iphone-15-128gb-black',
      title: 'Apple iPhone 15 128GB Black Official',
      category_id: 'electronics',
      brand: 'Apple',
      product_url: 'https://www.jumia.com.eg/apple-iphone-15-128gb-black.html'
    };
    repo.upsertProduct(jumiaProd);
    repo.insertSnapshot({
      asin: 'jumia:TEST_JUMIA_IPHONE',
      store: 'jumia',
      scraped_at: '2026-11-24T00:00:00.000Z',
      price: 39500,
      list_price: 44000
    });

    // Verify cross-store comparisons
    const comparisons = repo.getCrossStoreComparisons();
    const iphoneDeal = comparisons.find(c => c.canonical_key === 'iphone-15-128gb-black');
    assert.ok(iphoneDeal, 'Must find cross-store comparison for iphone');
    assert.strictEqual(iphoneDeal.cheapest_store, 'jumia');
    assert.strictEqual(iphoneDeal.cheapest_price, 39500);
    assert.strictEqual(iphoneDeal.expensive_store, 'amazon');
    assert.strictEqual(iphoneDeal.expensive_price, 42000);
    assert.strictEqual(iphoneDeal.price_difference, 2500);
    assert.ok(iphoneDeal.savings_pct > 0);
  });
});
