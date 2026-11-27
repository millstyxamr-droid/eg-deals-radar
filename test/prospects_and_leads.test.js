const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'amz-prospects-'));
process.env.CATALOG_DB_PATH = path.join(tmpRoot, 'catalog.db');

const db = require('../src/db');
const {
  getProspectList,
  getBrandReportData,
  getOpportunitiesAndRecommendations
} = require('../src/report_queries');
const { readTrackerCsv, writeTrackerCsv } = require('../scripts/weekly_digest');

describe('Prospect List & Lead Reports (Prompt 9 Tests)', () => {
  before(() => {
    db.prepare(`
      INSERT OR REPLACE INTO categories (id, name, name_ar, url, is_active)
      VALUES ('dairy-cheese', 'Dairy & Cheese', 'ألبان وأجبان', 'https://www.amazon.eg/dairy', 1)
    `).run();

    const products = [
      { asin: 'PR_DOMTY_1', brand: 'Domty', title: 'جبنة دومتي فيتا 500 جم', price: 45 },
      { asin: 'PR_DOMTY_2', brand: 'Domty', title: 'جبنة دومتي اسطنبولي 500 جم', price: 48 },
      { asin: 'PR_COMP_1', brand: 'Obour Land', title: 'جبنة عبور لاند 500 جم', price: 42 }
    ];

    for (const p of products) {
      db.prepare(`
        INSERT OR REPLACE INTO products
          (asin, title, title_norm, brand, category_id, image_url, product_url,
           weight_value, weight_unit, pack_count, size_text, unit_price, unit_price_unit, is_active, first_seen_at)
        VALUES
          (@asin, @title, @title_norm, @brand, 'dairy-cheese', 'https://m.media-amazon.com/images/I/test.jpg',
           'https://www.amazon.eg/dp/' || @asin, 500, 'جم', 1, '500 جم', @unit_price, 'كجم', 1, datetime('now'))
      `).run({
        asin: p.asin,
        title: p.title,
        title_norm: p.title.toLowerCase(),
        brand: p.brand,
        unit_price: p.price * 2
      });

      db.prepare(`
        INSERT INTO price_snapshots (asin, price, list_price, scraped_at)
        VALUES (@asin, @price, @list_price, datetime('now', '-1 day'))
      `).run({ asin: p.asin, price: p.price, list_price: p.price + 10 });

      db.prepare(`
        INSERT INTO deals_scores
          (asin, fair_price, typical_price, historical_discount_pct, advertised_discount_pct,
           is_real_deal, confidence, all_time_low, price_index, computed_at)
        VALUES (@asin, @price, @list_price, 18, 18, 1, 'medium', 1, 1.0, datetime('now'))
      `).run({ asin: p.asin, price: p.price, list_price: p.price + 10 });
    }
  });

  after(() => {
    try { db.close(); } catch (e) {}
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  test('Prospect List: extracts ranked top brands with positive scores and valid tiers', () => {
    const prospects = getProspectList(20);
    assert.ok(Array.isArray(prospects));
    assert.ok(prospects.length > 0, 'Prospect list should not be empty');
    assert.ok(prospects.length <= 20, 'Should respect limit 20');

    // Ensure sorted descending by score
    for (let i = 0; i < prospects.length - 1; i++) {
      assert.ok(
        prospects[i].priority_score >= prospects[i + 1].priority_score,
        `Item ${i} score (${prospects[i].priority_score}) should be >= Item ${i + 1} score (${prospects[i + 1].priority_score})`
      );
    }

    // Verify properties on first item
    const top = prospects[0];
    assert.ok(top.brand, 'Must have brand name');
    assert.ok(top.product_count > 0, 'Must have product count');
    assert.ok(top.priority_score > 0, 'Must have positive priority score');
    assert.ok(['أولوية قصوى', 'أولوية مرتفعة', 'أولوية متوسطة'].includes(top.priority_tier), 'Valid priority tier');
    assert.ok(top.categories, 'Categories string must exist');
  });

  test('Opportunities & Recommendations: returns exactly 3 actionable recommendations', () => {
    const reportData = getBrandReportData('Domty', { days: 30 });
    const recs = getOpportunitiesAndRecommendations(reportData);

    assert.ok(Array.isArray(recs), 'Recommendations should be an array');
    assert.strictEqual(recs.length, 3, 'Must return exactly 3 actionable recommendations');

    recs.forEach((rec, idx) => {
      assert.strictEqual(rec.num, idx + 1, 'Sequential numbering');
      assert.ok(rec.title && rec.title.length > 5, 'Recommendation must have a descriptive title');
      assert.ok(rec.metric && rec.metric.length > 3, 'Recommendation must cite a data metric');
      assert.ok(rec.action && rec.action.length > 15, 'Recommendation must provide a concrete action');
      assert.ok(rec.category, 'Recommendation must have a category tag');
    });
  });

  test('Outreach Template: word count strictly under 120 words and contains required elements', () => {
    const outreachPath = path.join(__dirname, '..', 'reports', 'outreach.md');
    assert.ok(fs.existsSync(outreachPath), 'reports/outreach.md must exist');

    const content = fs.readFileSync(outreachPath, 'utf-8');
    
    // Extract Section 1 code block (the actual template message)
    const match = content.match(/```text([\s\S]*?)```/);
    assert.ok(match, 'Template message code block must exist');

    const messageText = match[1].trim();
    const words = messageText.split(/\s+/).filter(Boolean);
    
    assert.ok(
      words.length < 120,
      `Message must be strictly under 120 words. Current count: ${words.length} words.`
    );

    // Verify required elements in text
    assert.ok(messageText.includes('Domty') || messageText.includes('{{BRAND}}'), 'Must mention brand');
    assert.ok(messageText.includes('Amazon Now'), 'Must mention Amazon Now');
    assert.ok(messageText.includes('وسيط'), 'Must mention median pricing comparison');
    assert.ok(messageText.includes('مجاني أسبوعياً لمدة شهر'), 'Must contain 1-month free weekly report offer');
    assert.ok(messageText.includes('تمام'), 'Must have single short CTA');
  });

  test('Outreach Tracker CSV: read and write preserve UTF-8 and Arabic columns', () => {
    const testCsvPath = path.join(__dirname, '..', 'reports', '.test_tracker.csv');
    const sampleRecords = [
      {
        'العلامة التجارية': 'Domty',
        'الأسبوع': '2026_w48',
        'اسم المسؤول': 'أحمد علي',
        'قناة التواصل': 'WhatsApp',
        'ملف التقرير': 'reports/lead_domty_2026_w48.pdf',
        'الحالة': 'اتبعث',
        'تاريخ التجهيز': '2026-11-21',
        'تاريخ الإرسال': '2026-11-21',
        'تاريخ المتابعة': '2026-11-24',
        'ملاحظات': 'تم الإرسال بنجاح'
      }
    ];

    writeTrackerCsv(testCsvPath, sampleRecords);
    assert.ok(fs.existsSync(testCsvPath));

    const readBack = readTrackerCsv(testCsvPath);
    assert.strictEqual(readBack.length, 1);
    assert.strictEqual(readBack[0]['العلامة التجارية'], 'Domty');
    assert.strictEqual(readBack[0]['الحالة'], 'اتبعث');
    assert.strictEqual(readBack[0]['اسم المسؤول'], 'أحمد علي');

    // Clean up test file
    fs.unlinkSync(testCsvPath);
  });

});
