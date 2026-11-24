const { test, describe, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ---------------------------------------------------------------------------
// Hermetic setup: this test must never touch the production catalog.
// ---------------------------------------------------------------------------
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'eg-deals-savebatch-'));
process.env.CATALOG_DB_PATH = path.join(tmpRoot, 'catalog.db');

const db = require('../src/db');
const repo = require('../src/repo');

after(() => {
  try { db.close(); } catch (e) {}
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (e) {}
});

function seedRun(runId) {
  db.prepare(`
    INSERT OR REPLACE INTO runs (id, status, started_at)
    VALUES (?, 'running', ?)
  `).run(runId, new Date().toISOString());
}

describe('saveDepartmentBatch data integrity', () => {
  test('upserts every product but records a snapshot only when a real price exists', () => {
    db.prepare(`
      INSERT OR REPLACE INTO categories (id, name, is_active)
      VALUES ('test-cat', 'Test Category', 1)
    `).run();
    seedRun('run_test_batch');

    const upserted = repo.saveDepartmentBatch({
      items: [
        {
          asin: 'B000000001',
          title: 'Product with a real price',
          currentPriceNum: 149.5,
          oldPriceNum: 200,
          discount: '25% OFF',
          productUrl: 'https://www.amazon.eg/dp/B000000001'
        },
        {
          asin: 'B000000002',
          title: 'Product whose price failed to extract',
          currentPriceNum: null,
          productUrl: 'https://www.amazon.eg/dp/B000000002'
        }
      ],
      runId: 'run_test_batch',
      categoryId: 'test-cat',
      categoryName: 'Test Category',
      pageIdentifier: 'test-cat',
      isSuccess: true
    });

    assert.strictEqual(upserted, 2, 'both products must be upserted');

    const products = db.prepare(`
      SELECT asin FROM products
      WHERE asin IN ('B000000001', 'B000000002')
      ORDER BY asin
    `).all();
    assert.strictEqual(products.length, 2, 'products are tracked even without a price');

    const snapshots = db.prepare(`
      SELECT asin, price FROM price_snapshots
      WHERE asin IN ('B000000001', 'B000000002')
    `).all();
    assert.strictEqual(snapshots.length, 1, 'only the priced product gets a snapshot');
    assert.strictEqual(snapshots[0].asin, 'B000000001');
    assert.strictEqual(snapshots[0].price, 149.5);
  });

  test('a batch with zero valid prices creates products but no empty snapshots', () => {
    seedRun('run_test_batch_empty');

    repo.saveDepartmentBatch({
      items: [
        { asin: 'B000000003', title: 'No price A', currentPriceNum: null },
        { asin: 'B000000004', title: 'No price B', currentPriceNum: 0 }
      ],
      runId: 'run_test_batch_empty',
      categoryId: 'test-cat',
      categoryName: 'Test Category',
      pageIdentifier: 'test-cat',
      isSuccess: true
    });

    const snapCount = db.prepare(`
      SELECT COUNT(*) AS n FROM price_snapshots
      WHERE asin IN ('B000000003', 'B000000004')
    `).get().n;
    assert.strictEqual(snapCount, 0, 'null / zero prices must not be persisted as history');

    const prodCount = db.prepare(`
      SELECT COUNT(*) AS n FROM products
      WHERE asin IN ('B000000003', 'B000000004')
    `).get().n;
    assert.strictEqual(prodCount, 2);
  });

  test('rejects impossible 1 EGP artifacts such as "1 لتر" / "6 × 1 لتر" promos', () => {
    seedRun('run_test_batch_artifact');

    repo.saveDepartmentBatch({
      items: [
        {
          asin: 'B000000005',
          title: 'حليب كرتون كامل الدسم 1 لتر - 6 عبوات، وفر 10 جنيه',
          currentPriceNum: 1
        }
      ],
      runId: 'run_test_batch_artifact',
      categoryId: 'test-cat',
      categoryName: 'Test Category',
      pageIdentifier: 'test-cat',
      isSuccess: true
    });

    const snapCount = db.prepare(`
      SELECT COUNT(*) AS n FROM price_snapshots WHERE asin = 'B000000005'
    `).get().n;
    assert.strictEqual(snapCount, 0, 'a 1 EGP parse artifact must never become price history');
  });
});
