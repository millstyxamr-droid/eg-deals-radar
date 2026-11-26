const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const {
  buildPostContent,
  buildInlineKeyboard,
  categoryToHashtag,
  buildCairoScheduleSlots,
  CAIRO_HOURS
} = require('../src/channel_post');
const { validateProductImage } = require('../src/telegram');
const { withAffiliate } = require('../src/affiliate');

describe('Telegram Channel Post & Queue Tests', () => {
  let memDb;

  beforeEach(() => {
    process.env.AMAZON_AFFILIATE_TAG = 'dealegypt-21';
    memDb = new Database(':memory:');
    memDb.exec(`
      CREATE TABLE products (
        asin TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        category_id TEXT,
        image_url TEXT,
        product_url TEXT,
        unit_price REAL,
        unit_price_unit TEXT,
        is_active INTEGER DEFAULT 1
      );

      CREATE TABLE categories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        name_ar TEXT
      );

      CREATE TABLE price_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        asin TEXT NOT NULL,
        price REAL,
        list_price REAL,
        scraped_at TEXT NOT NULL
      );

      CREATE TABLE deals_scores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        asin TEXT NOT NULL,
        fair_price REAL,
        typical_price REAL,
        historical_discount_pct REAL,
        advertised_discount_pct REAL,
        is_real_deal INTEGER DEFAULT 0,
        confidence TEXT,
        all_time_low INTEGER DEFAULT 0,
        computed_at TEXT NOT NULL
      );

      CREATE TABLE channel_queue (
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
    `);
  });

  test('Queue Constraint: UNIQUE(asin, slot) prevents duplicate scheduling in same slot/day', () => {
    // Seed parent product rows
    memDb.prepare(`INSERT INTO products (asin, title) VALUES ('B08XYZ1234', 'Product 1'), ('B09ABC9999', 'Product 2')`).run();

    const insertStmt = memDb.prepare(`
      INSERT INTO channel_queue (asin, slot, scheduled_at, status)
      VALUES (?, ?, ?, ?)
    `);

    // Insert first time
    insertStmt.run('B08XYZ1234', '2026-11-21_09:00', '2026-11-21T09:00:00+02:00', 'pending');

    // Insert duplicate should throw UNIQUE constraint failed
    assert.throws(() => {
      insertStmt.run('B08XYZ1234', '2026-11-21_09:00', '2026-11-21T09:00:00+02:00', 'pending');
    }, /UNIQUE constraint failed/);

    // Different ASIN in same slot is allowed
    assert.doesNotThrow(() => {
      insertStmt.run('B09ABC9999', '2026-11-21_09:00', '2026-11-21T09:00:00+02:00', 'pending');
    });
  });

  test('Queue Status Transition: pending -> posted with message_id and posted_at', () => {
    // Seed parent product row
    memDb.prepare(`INSERT INTO products (asin, title) VALUES ('B08TEST123', 'Test Prod')`).run();

    const insertStmt = memDb.prepare(`
      INSERT INTO channel_queue (asin, slot, scheduled_at, status)
      VALUES (?, ?, ?, 'pending')
    `);
    const info = insertStmt.run('B08TEST123', '2026-11-21_11:00', '2026-11-21T11:00:00+02:00');
    const id = info.lastInsertRowid;

    // Verify initial status
    const initial = memDb.prepare('SELECT * FROM channel_queue WHERE id = ?').get(id);
    assert.strictEqual(initial.status, 'pending');
    assert.strictEqual(initial.posted_at, null);

    // Update to posted
    const now = new Date().toISOString();
    memDb.prepare(`
      UPDATE channel_queue SET
        status = 'posted',
        posted_at = ?,
        message_id = ?
      WHERE id = ?
    `).run(now, 'msg_98765', id);

    const updated = memDb.prepare('SELECT * FROM channel_queue WHERE id = ?').get(id);
    assert.strictEqual(updated.status, 'posted');
    assert.strictEqual(updated.message_id, 'msg_98765');
    assert.strictEqual(updated.posted_at, now);
  });

  test('Cairo Schedule Slots: 24 hourly slots covering all 24 hours', () => {
    const slots = buildCairoScheduleSlots('2026-11-21');
    assert.strictEqual(slots.length, 24, 'Must produce 24 hourly slots');
    for (let h = 0; h < 24; h++) {
      assert.strictEqual(slots.some(s => s.hour === h), true, `Missing hour ${h}`);
    }
  });

  test('Post Formatter: concise Egyptian Arabic with unit price, typical price, #إعلان and affiliate link', () => {
    const mockProduct = {
      asin: 'B08MILK01',
      title: 'لبن جهينة كامل الدسم 2 لتر',
      category_name: 'ألبان وجبن',
      current_price: 85.0,
      old_price: 100.0,
      typical_price: 100.0,
      historical_discount_pct: 15,
      unit_price: 42.5,
      unit_price_unit: 'ج.م/لتر',
      product_url: 'https://www.amazon.eg/dp/B08MILK01',
      all_time_low: 0
    };

    const postText = buildPostContent(mockProduct, '2026-11-21_09:00');

    assert.match(postText, /^⚡ عرض ⚡$/m);
    assert.match(postText, /^لبن جهينة كامل الدسم 2 لتر$/m);
    assert.match(postText, /السعر: 85 ج\.م \(كان 100 ج\.م\) — أقل من سعره المعتاد 15%/);
    assert.match(postText, /📉 متوسط السعر: 100 ج\.م/);
    assert.match(postText, /💡 سعر اللتر: 42\.5 ج\.م/);
    assert.match(postText, /🛒 <b>رابط الشراء:<\/b> <a href="https:\/\/www\.amazon\.eg\/dp\/B08MILK01\?tag=dealegypt-21&utm_source=telegram&utm_medium=channel&utm_campaign=2026-11-21_09%3A00">اضغط هنا للشراء من أمازون مصر<\/a>/);
    assert.match(postText, /#ألبان_وجبن #عروض_النهاردة #إعلان/);
    assert.doesNotMatch(postText, /أرخص سعر/);

    // Test redundant unit price omission on single-unit items (e.g. 1L at 42.5)
    const singleItem = { ...mockProduct, current_price: 42.5, unit_price: 42.5 };
    const singlePostText = buildPostContent(singleItem, 'slot');
    assert.doesNotMatch(singlePostText, /سعر اللتر|الوحدة/);
  });

  test('Urgency Tiers & Low-Stock Badge: selects 🔥 الحق 🔥 vs ⚡ عرض ⚡ and appends stock_note', () => {
    const atlProduct = {
      asin: 'B01ATL9999',
      title: 'نسكافيه جولد 200 جم',
      category_name: 'شاي وقهوة',
      current_price: 250,
      typical_price: 340,
      historical_discount_pct: 26,
      all_time_low: 1,
      stock_note: 'باقي قطعة واحدة',
      product_url: 'https://www.amazon.eg/dp/B01ATL9999'
    };
    const atlText = buildPostContent(atlProduct, 'slot_atl');
    assert.match(atlText, /^🔥 الحق 🔥$/m);
    assert.match(atlText, /^نسكافيه جولد 200 جم \(⚠️ باقي قطعة واحدة\)$/m);
    assert.match(atlText, /📉 متوسط السعر: 340 ج\.م/);
    assert.match(atlText, /#إعلان/);

    const highDiscProduct = {
      asin: 'B01DISC300',
      title: 'مسحوق غسيل أريال 4 كجم',
      category_name: 'منظفات',
      current_price: 210,
      typical_price: 300,
      historical_discount_pct: 30,
      all_time_low: 0,
      stockNote: 'Only 2 left in stock',
      product_url: 'https://www.amazon.eg/dp/B01DISC300'
    };
    const highDiscText = buildPostContent(highDiscProduct, 'slot_disc');
    assert.match(highDiscText, /^🔥 الحق 🔥$/m);
    assert.match(highDiscText, /^مسحوق غسيل أريال 4 كجم \(⚠️ Only 2 left in stock\)$/m);

    const regularProduct = {
      asin: 'B01REG1234',
      title: 'مكرونة روجينا 400 جم',
      category_name: 'بقالة',
      current_price: 20,
      typical_price: 25,
      historical_discount_pct: 20,
      all_time_low: 0,
      product_url: 'https://www.amazon.eg/dp/B01REG1234'
    };
    const regularText = buildPostContent(regularProduct, 'slot_reg');
    assert.match(regularText, /^⚡ عرض ⚡$/m);
    assert.doesNotMatch(regularText, /\(⚠️/);
  });

  test('Inline Keyboard Builder: 2-row layout with affiliate URL, bot deep-link, and clean fallback', () => {
    const product = {
      asin: 'B08MILK01',
      product_url: 'https://www.amazon.eg/dp/B08MILK01'
    };

    const kbWithBot = buildInlineKeyboard(product, '2026-11-26_12:00', { botUsername: '@EgDealsRadarBot' });
    assert.strictEqual(kbWithBot.inline_keyboard.length, 2);
    assert.strictEqual(kbWithBot.inline_keyboard[0].length, 1);
    assert.strictEqual(kbWithBot.inline_keyboard[0][0].text, '🛒 شوفه على أمازون');
    assert.match(kbWithBot.inline_keyboard[0][0].url, /tag=dealegypt-21/);

    assert.strictEqual(kbWithBot.inline_keyboard[1].length, 2);
    assert.strictEqual(kbWithBot.inline_keyboard[1][0].text, '🎯 تتبع العرض');
    assert.strictEqual(kbWithBot.inline_keyboard[1][0].url, 'https://t.me/EgDealsRadarBot?start=track_B08MILK01');
    assert.strictEqual(kbWithBot.inline_keyboard[1][1].text, 'ℹ️ الأسعار ممكن تتغير');
    assert.strictEqual(kbWithBot.inline_keyboard[1][1].url, 'https://t.me/eg_deals_radar');

    const kbWithoutBot = buildInlineKeyboard(product, '2026-11-26_12:00', { botUsername: '' });
    assert.strictEqual(kbWithoutBot.inline_keyboard.length, 2);
    assert.strictEqual(kbWithoutBot.inline_keyboard[1].length, 1);
    assert.strictEqual(kbWithoutBot.inline_keyboard[1][0].text, 'ℹ️ الأسعار ممكن تتغير');
  });

  test('Truthful Marketing Rule: "أرخص سعر" is ONLY added when all_time_low === 1', () => {
    const regularDeal = {
      asin: 'B01REGULAR',
      title: 'شاي العروسة 250 جم',
      category_name: 'شاي وقهوة',
      current_price: 55,
      old_price: 65,
      historical_discount_pct: 15,
      all_time_low: 0,
      product_url: 'https://www.amazon.eg/dp/B01REGULAR'
    };
    const regularPost = buildPostContent(regularDeal, 'slot_1');
    assert.doesNotMatch(regularPost, /أرخص سعر/);

    const atlDeal = {
      asin: 'B01ATL',
      title: 'زيت عباد الشمس 1.6 لتر',
      category_name: 'زيوت وسمن',
      current_price: 110,
      old_price: 150,
      historical_discount_pct: 27,
      all_time_low: 1,
      product_url: 'https://www.amazon.eg/dp/B01ATL'
    };
    const atlPost = buildPostContent(atlDeal, 'slot_2');
    assert.match(atlPost, /📉 أرخص سعر اتسجل للمنتج ده!/);
  });

  test('Unverified history: never claims "usual price" or "lowest price", only Amazon advertised discount', () => {
    const unverifiedDeal = {
      asin: 'B01UNVERIFIED',
      title: 'منتج جديد لسه بنجمع تاريخه',
      category_name: 'بقالة',
      current_price: 173.24,
      old_price: 251,
      historical_discount_pct: null,
      advertised_discount_pct: 31,
      all_time_low: 1,
      product_url: 'https://www.amazon.eg/dp/B01UNVERIFIED'
    };

    const postText = buildPostContent(unverifiedDeal, 'slot_3');

    assert.doesNotMatch(postText, /أرخص سعر/, 'Must not claim lowest price without verified history');
    assert.doesNotMatch(postText, /المعتاد/, 'Must not claim a usual price without verified history');
    assert.match(postText, /خصم معلن من أمازون: 31%/, 'Advertised discount must be labelled honestly');
  });

  test('Image Validation: detects valid images, small images (<200px), and missing images', () => {
    // Valid image URL
    const valid = validateProductImage('https://m.media-amazon.com/images/I/61abc123._AC_UL450_.jpg');
    assert.strictEqual(valid.valid, true);

    // Image smaller than 200px
    const small1 = validateProductImage('https://m.media-amazon.com/images/I/61abc123._SX150_.jpg');
    assert.strictEqual(small1.valid, false);
    assert.strictEqual(small1.reason, 'dimension_too_small_150px');

    const small2 = validateProductImage('https://m.media-amazon.com/images/I/61abc123._SY120_.jpg');
    assert.strictEqual(small2.valid, false);

    // Missing image
    const missing = validateProductImage(null);
    assert.strictEqual(missing.valid, false);
    assert.strictEqual(missing.reason, 'missing');
  });

  test('Category Hashtag normalization: converts spaces and symbols to clean Arabic tags', () => {
    assert.strictEqual(categoryToHashtag('أغذية ومشروبات'), 'أغذية_ومشروبات');
    assert.strictEqual(categoryToHashtag('بقالة / معلبات'), 'بقالة_معلبات');
    assert.strictEqual(categoryToHashtag('Dairy & Cheese'), 'Dairy_Cheese');
    assert.strictEqual(categoryToHashtag(''), 'عروض');
  });
});
