const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Allow tests / staging to point at an isolated database file.
const dbPath = process.env.CATALOG_DB_PATH
  ? path.resolve(process.env.CATALOG_DB_PATH)
  : path.join(dataDir, 'catalog.db');

const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(dbPath);

// Database Pragmas
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      store TEXT DEFAULT 'amazon',
      parent_id TEXT,
      name TEXT NOT NULL,
      name_ar TEXT,
      node_id TEXT UNIQUE,
      url TEXT,
      depth INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      last_scraped_at TEXT,
      consecutive_zero_count INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS products (
      asin TEXT PRIMARY KEY,
      store TEXT DEFAULT 'amazon',
      store_sku TEXT,
      canonical_id TEXT,
      title TEXT NOT NULL,
      title_norm TEXT,
      brand TEXT,
      category_id TEXT,
      image_url TEXT,
      product_url TEXT,
      weight_value REAL,
      weight_unit TEXT,
      pack_count INTEGER DEFAULT 1,
      size_text TEXT,
      unit_price REAL,
      unit_price_unit TEXT,
      first_seen_at TEXT,
      last_seen_at TEXT,
      is_active INTEGER DEFAULT 1,
      FOREIGN KEY(category_id) REFERENCES categories(id)
    );

    CREATE TABLE IF NOT EXISTS price_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asin TEXT NOT NULL,
      store TEXT DEFAULT 'amazon',
      run_id TEXT,
      scraped_at TEXT NOT NULL,
      price REAL,
      list_price REAL,
      in_stock INTEGER DEFAULT 1,
      discount_badge TEXT,
      source TEXT,
      FOREIGN KEY(asin) REFERENCES products(asin)
    );

    CREATE INDEX IF NOT EXISTS idx_snap_asin_time ON price_snapshots(asin, scraped_at);
    CREATE INDEX IF NOT EXISTS idx_snap_time ON price_snapshots(scraped_at);

    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asin TEXT NOT NULL,
      rule TEXT NOT NULL,
      threshold REAL,
      price REAL,
      triggered_at TEXT NOT NULL,
      sent_at TEXT,
      channel TEXT,
      payload TEXT,
      UNIQUE(asin, rule, triggered_at)
    );

    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      started_at TEXT,
      finished_at TEXT,
      status TEXT,
      pages_total INTEGER,
      pages_ok INTEGER,
      pages_failed INTEGER,
      items_upserted INTEGER,
      error TEXT,
      last_page TEXT
    );

    CREATE TABLE IF NOT EXISTS product_duplicates (
      canonical_asin TEXT NOT NULL,
      duplicate_asin TEXT NOT NULL PRIMARY KEY,
      reason TEXT,
      detected_at TEXT,
      FOREIGN KEY(canonical_asin) REFERENCES products(asin),
      FOREIGN KEY(duplicate_asin) REFERENCES products(asin)
    );

    CREATE INDEX IF NOT EXISTS idx_dup_canonical ON product_duplicates(canonical_asin);
    CREATE INDEX IF NOT EXISTS idx_dup_duplicate ON product_duplicates(duplicate_asin);

    CREATE TABLE IF NOT EXISTS deals_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asin TEXT NOT NULL,
      run_id TEXT,
      fair_price REAL,
      typical_price REAL,
      historical_discount_pct REAL,
      advertised_discount_pct REAL,
      is_real_deal INTEGER DEFAULT 0,
      confidence TEXT,
      all_time_low INTEGER DEFAULT 0,
      price_index REAL,
      computed_at TEXT NOT NULL,
      FOREIGN KEY(asin) REFERENCES products(asin)
    );

    CREATE INDEX IF NOT EXISTS idx_deals_scores_asin ON deals_scores(asin);
    CREATE INDEX IF NOT EXISTS idx_deals_scores_time ON deals_scores(computed_at);

    CREATE TABLE IF NOT EXISTS watchlist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      asin TEXT NOT NULL,
      target_price REAL,
      target_discount_pct REAL,
      is_active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL,
      UNIQUE(chat_id, asin),
      FOREIGN KEY(asin) REFERENCES products(asin)
    );

    CREATE INDEX IF NOT EXISTS idx_watchlist_chat ON watchlist(chat_id);
    CREATE INDEX IF NOT EXISTS idx_watchlist_asin ON watchlist(asin);
    CREATE INDEX IF NOT EXISTS idx_alerts_asin_rule ON alerts(asin, rule, sent_at);

    CREATE TABLE IF NOT EXISTS channel_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asin TEXT NOT NULL,
      slot TEXT NOT NULL,
      scheduled_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      posted_at TEXT,
      message_id TEXT,
      error TEXT,
      UNIQUE(asin, slot),
      FOREIGN KEY(asin) REFERENCES products(asin)
    );

    CREATE INDEX IF NOT EXISTS idx_channel_queue_status_sched ON channel_queue(status, scheduled_at);
    CREATE INDEX IF NOT EXISTS idx_channel_queue_asin ON channel_queue(asin);
    CREATE INDEX IF NOT EXISTS idx_channel_queue_slot ON channel_queue(slot);
  `);
}

function migrateSchema() {
  // Multi-store schema migration
  const prodCols = db.pragma('table_info(products)').map(c => c.name);
  if (!prodCols.includes('store')) {
    db.exec(`ALTER TABLE products ADD COLUMN store TEXT DEFAULT 'amazon';`);
  }
  if (!prodCols.includes('store_sku')) {
    db.exec(`ALTER TABLE products ADD COLUMN store_sku TEXT;`);
  }
  if (!prodCols.includes('canonical_id')) {
    db.exec(`ALTER TABLE products ADD COLUMN canonical_id TEXT;`);
  }

  const catCols = db.pragma('table_info(categories)').map(c => c.name);
  if (!catCols.includes('store')) {
    db.exec(`ALTER TABLE categories ADD COLUMN store TEXT DEFAULT 'amazon';`);
  }
  if (!catCols.includes('consecutive_zero_count')) {
    db.exec(`ALTER TABLE categories ADD COLUMN consecutive_zero_count INTEGER DEFAULT 0;`);
  }

  const snapCols = db.pragma('table_info(price_snapshots)').map(c => c.name);
  if (!snapCols.includes('store')) {
    db.exec(`ALTER TABLE price_snapshots ADD COLUMN store TEXT DEFAULT 'amazon';`);
  }

  // Ensure indexes on migrated columns exist
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_products_store ON products(store);
    CREATE INDEX IF NOT EXISTS idx_products_canonical ON products(canonical_id);
    CREATE INDEX IF NOT EXISTS idx_snapshots_store ON price_snapshots(store);
  `);

  // Check runs table
  const runCols = db.pragma('table_info(runs)').map(c => c.name);
  if (!runCols.includes('last_page')) {
    db.exec(`ALTER TABLE runs ADD COLUMN last_page TEXT;`);
  }

  // Update legacy/unmapped category 'domty' to canonical 'dairy-cheese'
  db.exec(`UPDATE products SET category_id = 'dairy-cheese' WHERE category_id = 'domty';`);

  // Ensure products have normalized brand from title if missing
  const nullBrandProducts = db.prepare(`SELECT asin, title FROM products WHERE brand IS NULL`).all();
  if (nullBrandProducts.length > 0) {
    try {
      const { extractBrand } = require('./normalize');
      const updateBrandStmt = db.prepare(`UPDATE products SET brand = ? WHERE asin = ?`);
      const brandTx = db.transaction((rows) => {
        for (const row of rows) {
          const eb = extractBrand(row.title);
          if (eb) updateBrandStmt.run(eb, row.asin);
        }
      });
      brandTx(nullBrandProducts);
    } catch (e) {}
  }

  // Ensure products have unit_price & weight if missing
  const nullUnitPrices = db.prepare(`
    SELECT asin, title, 
      (SELECT price FROM price_snapshots WHERE asin = products.asin AND price > 0 ORDER BY scraped_at DESC LIMIT 1) as price
    FROM products 
    WHERE unit_price IS NULL
  `).all();
  if (nullUnitPrices.length > 0) {
    try {
      const { parseSize, calculateUnitPrice } = require('./pricing');
      const updateUnitStmt = db.prepare(`
        UPDATE products 
        SET weight_value = coalesce(weight_value, ?),
            weight_unit = coalesce(weight_unit, ?),
            pack_count = coalesce(pack_count, ?),
            size_text = coalesce(size_text, ?),
            unit_price = coalesce(unit_price, ?),
            unit_price_unit = coalesce(unit_price_unit, ?)
        WHERE asin = ?
      `);
      const unitTx = db.transaction((rows) => {
        for (const row of rows) {
          const sz = parseSize(row.title);
          if (sz) {
            let up = null, upu = null;
            if (row.price) {
              const calc = calculateUnitPrice(row.price, sz);
              if (calc) {
                up = calc.unit_price;
                upu = calc.unit_price_unit;
              }
            }
            updateUnitStmt.run(
              sz.weight_value !== undefined ? sz.weight_value : null,
              sz.weight_unit || null,
              sz.pack_count || 1,
              sz.size_text || null,
              up,
              upu,
              row.asin
            );
          }
        }
      });
      unitTx(nullUnitPrices);
    } catch (e) {}
  }

  // Ensure channel_queue table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS channel_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asin TEXT NOT NULL,
      slot TEXT NOT NULL,
      scheduled_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      posted_at TEXT,
      message_id TEXT,
      error TEXT,
      UNIQUE(asin, slot),
      FOREIGN KEY(asin) REFERENCES products(asin)
    );
    CREATE INDEX IF NOT EXISTS idx_channel_queue_status_sched ON channel_queue(status, scheduled_at);
    CREATE INDEX IF NOT EXISTS idx_channel_queue_asin ON channel_queue(asin);
    CREATE INDEX IF NOT EXISTS idx_channel_queue_slot ON channel_queue(slot);
  `);

  // Ensure price_snapshots with null or zero price reflect stockout status (in_stock = 0)
  try {
    db.exec(`UPDATE price_snapshots SET in_stock = 0 WHERE (price IS NULL OR price <= 0) AND in_stock = 1;`);
  } catch (e) {}

  // Seed watchlist table from watchlist.json if empty
  const watchlistCount = db.prepare('SELECT count(*) as count FROM watchlist').get().count;
  const watchlistJsonPath = path.join(__dirname, '..', 'watchlist.json');
  if (watchlistCount === 0 && fs.existsSync(watchlistJsonPath)) {
    try {
      const items = JSON.parse(fs.readFileSync(watchlistJsonPath, 'utf-8'));
      if (Array.isArray(items)) {
        const insertStmt = db.prepare(`
          INSERT OR IGNORE INTO watchlist (chat_id, asin, target_price, target_discount_pct, is_active, created_at)
          VALUES ('default', ?, ?, ?, 1, datetime('now'))
        `);
        const tx = db.transaction((rows) => {
          for (const item of rows) {
            if (item.asin) {
              insertStmt.run(item.asin, item.targetPrice || null, item.targetDiscountPct || null);
            }
          }
        });
        tx(items);
      }
    } catch (e) {}
  }
}

initSchema();

module.exports = db;

// Run migration after exporting db to prevent circular dependency warnings
migrateSchema();
