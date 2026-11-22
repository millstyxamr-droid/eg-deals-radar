const fs = require('fs');
const path = require('path');
const db = require('./src/db');
const repo = require('./src/repo');

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'general';
}

function runMigration() {
  console.log('====================================================');
  console.log('   🚀 بدء ترحيل البيانات من ملفات JSON إلى SQLite   ');
  console.log('====================================================');

  const categoriesPath = path.join(__dirname, 'categories.json');
  const productsPath = path.join(__dirname, 'products.json');
  const historyPath = path.join(__dirname, 'price_history.json');

  let stats = {
    categories: { added: 0, skipped: 0, total: 0 },
    products: { added: 0, skipped: 0, total: 0 },
    snapshots: { added: 0, skipped: 0, total: 0 }
  };

  // 1. Migrate Categories
  const categoryMap = new Map(); // name/id -> id
  if (fs.existsSync(categoriesPath)) {
    const rawCategories = JSON.parse(fs.readFileSync(categoriesPath, 'utf-8'));
    stats.categories.total = rawCategories.length;

    for (const cat of rawCategories) {
      const exists = db.prepare('SELECT 1 FROM categories WHERE id = ?').get(cat.id);
      if (exists) {
        stats.categories.skipped++;
      } else {
        stats.categories.added++;
      }

      repo.upsertCategory({
        id: cat.id,
        name: cat.name,
        name_ar: cat.name_ar || null,
        node_id: cat.nodeId || cat.node_id || null,
        url: cat.url || null,
        depth: cat.depth || 0,
        is_active: 1
      });

      categoryMap.set(cat.id.toLowerCase(), cat.id);
      categoryMap.set(cat.name.toLowerCase(), cat.id);
    }
  }

  // 2. Load History for timestamp matching & snapshots
  let historyData = {};
  if (fs.existsSync(historyPath)) {
    try {
      historyData = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
    } catch (e) {
      console.warn('[-] تحذير: تعذر قراءة price_history.json:', e.message);
    }
  }

  // 3. Migrate Products
  let rawProducts = [];
  if (fs.existsSync(productsPath)) {
    rawProducts = JSON.parse(fs.readFileSync(productsPath, 'utf-8'));
    stats.products.total = rawProducts.length;

    for (const prod of rawProducts) {
      // Resolve category
      let categoryId = null;
      if (prod.category) {
        const catKey = prod.category.trim().toLowerCase();
        if (categoryMap.has(catKey)) {
          categoryId = categoryMap.get(catKey);
        } else {
          // Auto create missing category to satisfy foreign key
          categoryId = slugify(prod.category);
          const catExists = db.prepare('SELECT 1 FROM categories WHERE id = ?').get(categoryId);
          if (!catExists) {
            repo.upsertCategory({
              id: categoryId,
              name: prod.category.trim(),
              depth: 0,
              is_active: 1
            });
            categoryMap.set(catKey, categoryId);
            stats.categories.added++;
          } else {
            categoryMap.set(catKey, categoryId);
          }
        }
      }

      const itemHist = historyData[prod.asin];
      const firstSeen = itemHist && itemHist.firstSeen ? itemHist.firstSeen : new Date().toISOString();
      const lastSeen = itemHist && itemHist.history && itemHist.history.length > 0 
        ? itemHist.history[itemHist.history.length - 1].date 
        : new Date().toISOString();

      const prodExists = db.prepare('SELECT 1 FROM products WHERE asin = ?').get(prod.asin);
      if (prodExists) {
        stats.products.skipped++;
      } else {
        stats.products.added++;
      }

      repo.upsertProduct({
        asin: prod.asin,
        title: prod.title,
        title_norm: prod.title ? prod.title.toLowerCase().trim() : '',
        category_id: categoryId,
        image_url: prod.imgSrc || null,
        product_url: prod.productUrl || null,
        first_seen_at: firstSeen,
        last_seen_at: lastSeen,
        is_active: 1
      });
    }
  }

  // 4. Migrate Price Snapshots from history
  const asins = Object.keys(historyData);
  for (const asin of asins) {
    const item = historyData[asin];
    const historyList = item.history || [];

    for (const snap of historyList) {
      stats.snapshots.total++;
      const snapDate = snap.date || new Date().toISOString();

      const snapExists = db.prepare('SELECT 1 FROM price_snapshots WHERE asin = ? AND scraped_at = ?').get(asin, snapDate);
      if (snapExists) {
        stats.snapshots.skipped++;
      } else {
        const res = repo.insertSnapshot({
          asin: asin,
          run_id: 'migration_initial',
          scraped_at: snapDate,
          price: snap.price,
          list_price: snap.listedOldPrice,
          in_stock: 1,
          discount_badge: null,
          source: 'price_history.json'
        });

        if (res.changes > 0) {
          stats.snapshots.added++;
        } else {
          stats.snapshots.skipped++;
        }
      }
    }
  }

  // If a product from products.json is NOT in history, ensure it has at least one snapshot
  for (const prod of rawProducts) {
    if (!historyData[prod.asin] && prod.currentPriceNum !== null) {
      stats.snapshots.total++;
      const now = new Date().toISOString();
      const snapExists = db.prepare('SELECT 1 FROM price_snapshots WHERE asin = ?').get(prod.asin);
      if (snapExists) {
        stats.snapshots.skipped++;
      } else {
        const res = repo.insertSnapshot({
          asin: prod.asin,
          run_id: 'migration_initial',
          scraped_at: now,
          price: prod.currentPriceNum,
          list_price: prod.oldPriceNum,
          in_stock: 1,
          discount_badge: prod.discount,
          source: 'products.json'
        });
        if (res.changes > 0) {
          stats.snapshots.added++;
        } else {
          stats.snapshots.skipped++;
        }
      }
    }
  }

  // 5. Migration Report
  console.log('\n📊 ---------------- تقرير الترحيل ----------------');
  console.log(`📁 الأقسام (Categories):`);
  console.log(`   - تم إضافتها : ${stats.categories.added}`);
  console.log(`   - تم تخطيها  : ${stats.categories.skipped}`);
  console.log(`📦 المنتجات (Products):`);
  console.log(`   - تم إضافتها : ${stats.products.added}`);
  console.log(`   - تم تخطيها  : ${stats.products.skipped}`);
  console.log(`📈 لقطات الأسعار (Price Snapshots):`);
  console.log(`   - تم إضافتها : ${stats.snapshots.added}`);
  console.log(`   - تم تخطيها  : ${stats.snapshots.skipped}`);
  console.log('--------------------------------------------------');
  console.log('✔ اكتمل الترحيل بنجاح!\n');

  return stats;
}

if (require.main === module) {
  runMigration();
}

module.exports = { runMigration };
