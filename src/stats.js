const fs = require('fs');
const path = require('path');
const db = require('./db');

function printDbStats() {
  const dbPath = path.join(__dirname, '..', 'data', 'catalog.db');
  let fileSize = '0 KB';
  if (fs.existsSync(dbPath)) {
    const stats = fs.statSync(dbPath);
    fileSize = `${(stats.size / 1024).toFixed(2)} KB (${stats.size} bytes)`;
  }

  const catCount = db.prepare('SELECT COUNT(*) AS c FROM categories').get().c;
  const prodCount = db.prepare('SELECT COUNT(*) AS c FROM products').get().c;
  const snapCount = db.prepare('SELECT COUNT(*) AS c FROM price_snapshots').get().c;
  const alertCount = db.prepare('SELECT COUNT(*) AS c FROM alerts').get().c;
  const runCount = db.prepare('SELECT COUNT(*) AS c FROM runs').get().c;

  const latestSnap = db.prepare('SELECT MAX(scraped_at) AS last_scraped FROM price_snapshots').get().last_scraped;
  const priceRange = db.prepare('SELECT MIN(price) AS min_p, MAX(price) AS max_p, AVG(price) AS avg_p FROM price_snapshots WHERE price IS NOT NULL').get();

  console.log('====================================================');
  console.log('       📊 إحصائيات قاعدة بيانات SQLite (catalog.db)   ');
  console.log('====================================================');
  console.log(`💾 مسار القاعدة : ${dbPath}`);
  console.log(`📏 حجم الملف   : ${fileSize}`);
  console.log('----------------------------------------------------');
  console.log(`📁 الأقسام (categories)        : ${catCount}`);
  console.log(`📦 المنتجات (products)          : ${prodCount}`);
  console.log(`📈 لقطات الأسعار (snapshots)   : ${snapCount}`);
  console.log(`🔔 التنبيهات (alerts)          : ${alertCount}`);
  console.log(`🏃 جولات الكشط (runs)          : ${runCount}`);
  console.log('----------------------------------------------------');
  console.log(`🕒 آخر لقطة سعر               : ${latestSnap || 'لا يوجد'}`);
  if (priceRange && priceRange.min_p !== null) {
    console.log(`💰 أقل سعر                     : EGP ${priceRange.min_p}`);
    console.log(`💰 أعلى سعر                    : EGP ${priceRange.max_p}`);
    console.log(`💰 متوسط الأسعار               : EGP ${Number(priceRange.avg_p).toFixed(2)}`);
  }
  console.log('====================================================');

  return {
    categories: catCount,
    products: prodCount,
    price_snapshots: snapCount,
    alerts: alertCount,
    runs: runCount
  };
}

if (require.main === module) {
  printDbStats();
}

module.exports = { printDbStats };
