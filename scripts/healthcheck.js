/**
 * Amazon Egypt Tez Scraper - Workflow Healthcheck Script
 * 
 * Verifies catalog and run health:
 * 1. Prints total active products (and total in DB)
 * 2. Prints snapshots recorded in the last 24 hours
 * 3. Prints percentage of categories that returned 0 products
 * 4. Prints any category that failed 3+ consecutive times
 * 5. Exits with code 1 if pages_ok == 0 in the latest run (causes GitHub Actions workflow to fail red)
 */

const fs = require('fs');
const path = require('path');
const db = require('../src/db');
const repo = require('../src/repo');

function runHealthcheck() {
  console.log('====================================================');
  console.log('    🩺 Amazon EG Scraper - Run Healthcheck Report   ');
  console.log('====================================================');

  // 1. Verify database exists and tables are readable
  const dbPath = path.join(__dirname, '..', 'data', 'catalog.db');
  if (!fs.existsSync(dbPath)) {
    console.error(`❌ CRITICAL: Database file does not exist at ${dbPath}`);
    process.exit(1);
  }

  let totalActiveProducts = 0;
  let totalProductsInDb = 0;
  let snapshots24h = 0;

  try {
    totalActiveProducts = db.prepare('SELECT count(*) as count FROM products WHERE is_active = 1').get().count;
    totalProductsInDb = db.prepare('SELECT count(*) as count FROM products').get().count;
  } catch (err) {
    console.error(`❌ CRITICAL: Failed to query products: ${err.message}`);
    process.exit(1);
  }

  try {
    snapshots24h = db.prepare(`
      SELECT count(*) as count FROM price_snapshots
      WHERE scraped_at >= datetime('now', '-24 hours')
    `).get().count;
  } catch (err) {
    console.warn(`[-] Warning: Could not query 24h snapshots: ${err.message}`);
  }

  console.log(`📦 عدد المنتجات النشطة (Active Products)    : ${totalActiveProducts} (إجمالي المسجلة: ${totalProductsInDb})`);
  console.log(`📈 لقطات الأسعار آخر 24 ساعة (Snapshots 24h) : ${snapshots24h}`);

  // 2. Query latest scraper run
  let latestRun = null;
  try {
    latestRun = repo.getLastRun();
  } catch (err) {
    console.warn(`[-] Warning: Could not query latest run: ${err.message}`);
  }

  if (latestRun) {
    console.log('----------------------------------------------------');
    console.log(`🏃 تفاصيل آخر جولة كشط [ID: ${latestRun.id}]:`);
    console.log(`   - الحالة (status)            : ${latestRun.status}`);
    console.log(`   - بدأت في (started_at)       : ${latestRun.started_at}`);
    console.log(`   - انتهت في (finished_at)     : ${latestRun.finished_at || 'قيد التشغيل'}`);
    console.log(`   - أقسام ناجحة (pages_ok)     : ${latestRun.pages_ok}`);
    console.log(`   - أقسام فاشلة (pages_failed) : ${latestRun.pages_failed}`);
    console.log(`   - إجمالي الأقسام (total)     : ${latestRun.pages_total}`);
    console.log(`   - عناصر محدثة (upserted)     : ${latestRun.items_upserted}`);
    if (latestRun.last_page) {
      console.log(`   - آخر صفحة (last_page)       : ${latestRun.last_page}`);
    }
  } else {
    console.warn('⚠️ لم يتم العثور على أي جولات سابقة في جدول runs.');
  }

  // 3. Percentage of categories returning 0 products
  let totalCategories = 0;
  let zeroCategories = [];
  try {
    totalCategories = db.prepare('SELECT count(*) as count FROM categories WHERE is_active = 1').get().count;
    zeroCategories = db.prepare(`
      SELECT c.id, c.name, coalesce(c.consecutive_zero_count, 0) as consecutive_zero_count,
             (SELECT count(*) FROM products p WHERE p.category_id = c.id AND p.is_active = 1) as active_count
      FROM categories c
      WHERE c.is_active = 1 AND (
        coalesce(c.consecutive_zero_count, 0) > 0 OR
        (SELECT count(*) FROM products p WHERE p.category_id = c.id AND p.is_active = 1) = 0
      )
    `).all();
  } catch (err) {
    console.warn(`[-] Warning querying categories: ${err.message}`);
  }

  const zeroPct = totalCategories > 0
    ? ((zeroCategories.length / totalCategories) * 100).toFixed(1)
    : '0.0';
  console.log('----------------------------------------------------');
  console.log(`📁 نسبة الأقسام التي رجعت 0 أو فارغة : ${zeroPct}% (${zeroCategories.length} من إجمالي ${totalCategories})`);

  // 4. Categories failing 3+ times consecutively
  let failed3Times = [];
  try {
    failed3Times = db.prepare(`
      SELECT id, name, consecutive_zero_count, last_scraped_at
      FROM categories
      WHERE consecutive_zero_count >= 3
    `).all();
  } catch (err) {
    console.warn(`[-] Warning querying failed categories: ${err.message}`);
  }

  if (failed3Times.length > 0) {
    console.log(`⚠️ أقسام فشلت 3 مرات متتالية أو أكثر (${failed3Times.length} أقسام):`);
    failed3Times.forEach(cat => {
      console.log(`   ❌ [${cat.id}] ${cat.name} | محاولات فاشلة: ${cat.consecutive_zero_count} | آخر محاولة: ${cat.last_scraped_at}`);
    });
  } else {
    console.log('✔ لا توجد أقسام فشلت 3 مرات متتالية.');
  }

  console.log('====================================================');

  // 5. Validation and Exit Code determination
  // Rule: لو pages_ok == 0 → exit 1 عشان الـ workflow يبان أحمر
  if (latestRun && latestRun.pages_ok === 0) {
    console.error(`\n❌ [FAILED] Scraper run recorded 0 successful pages (pages_ok = 0)! Failing workflow.`);
    process.exit(1);
  }

  if (totalActiveProducts === 0) {
    console.error(`\n❌ [FAILED] Catalog is empty (0 active products)! Failing workflow.`);
    process.exit(1);
  }

  console.log('✅ [PASSED] Healthcheck passed successfully. Workflow is green.');
  process.exit(0);
}

if (require.main === module) {
  runHealthcheck();
}

module.exports = { runHealthcheck };
