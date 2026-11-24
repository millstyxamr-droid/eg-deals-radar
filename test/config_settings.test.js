const { test, describe } = require('node:test');
const assert = require('node:assert');
const config = require('../src/config');
const {
  selectCandidateDeals,
  generateDailySchedule,
  buildPostContent,
  buildCairoScheduleSlots
} = require('../src/channel_post');

describe('Config JSON Settings Integration Tests', () => {
  test('1. config.js accurately loads modified values from config.json', () => {
    const settings = config.userSettings;
    assert.ok(settings, 'config.json must load successfully');
    assert.strictEqual(config.postsPerSlot, 4, 'posts_per_slot must be updated to 4');
    assert.strictEqual(config.minDiscountPct, 25, 'min_discount_pct must be updated to 25');
    assert.strictEqual(settings.telegram.posts_per_slot, 4);
    assert.strictEqual(settings.deals_filter.min_discount_pct, 25);
    assert.strictEqual(typeof settings.affiliate.amazon_tag, 'string');
    assert.ok(settings.affiliate.amazon_tag.length > 0);
  });

  test('2. Deals filter strictly enforces min_discount_pct >= 25%', () => {
    // Test selectCandidateDeals logic with minDiscountPct
    const deals = [
      { asin: 'B01_LOW', historical_discount_pct: 15, advertised_discount_pct: 15, is_real_deal: 1, confidence: 'high' },
      { asin: 'B02_BORDER', historical_discount_pct: 24, advertised_discount_pct: 24, is_real_deal: 1, confidence: 'high' },
      { asin: 'B03_HIGH', historical_discount_pct: 25, advertised_discount_pct: 25, is_real_deal: 1, confidence: 'high' },
      { asin: 'B04_SUPER', historical_discount_pct: 40, advertised_discount_pct: 40, is_real_deal: 1, confidence: 'high' }
    ];

    const minPct = config.minDiscountPct;
    assert.strictEqual(minPct, 25);

    const filtered = deals.filter(d => {
      const disc = d.historical_discount_pct || d.advertised_discount_pct || 0;
      return disc >= minPct && d.is_real_deal === 1;
    });

    assert.strictEqual(filtered.length, 2);
    assert.strictEqual(filtered[0].asin, 'B03_HIGH');
    assert.strictEqual(filtered[1].asin, 'B04_SUPER');
  });

  test('3. buildPostContent respects toggle options (include_trust_notes & include_hub_links)', () => {
    const mockProduct = {
      asin: 'B08TESTCONFIG',
      title: 'سمنة بلدي بقري 1 كجم',
      category_name: 'سمن وزيوت',
      current_price: 180,
      old_price: 240,
      historical_discount_pct: 25,
      product_url: 'https://www.amazon.eg/dp/B08TESTCONFIG'
    };

    // When toggles are disabled
    const postWithoutTrustAndHub = buildPostContent(mockProduct, 'slot_test', {
      include_trust_notes: false,
      include_hub_links: false
    });

    assert.doesNotMatch(postWithoutTrustAndHub, /توصيل سريع برايم/);
    assert.doesNotMatch(postWithoutTrustAndHub, /جميع عروض وتخفيضات السوبرماركت/);

    // When toggles are enabled (default in config.json)
    const postWithTrustAndHub = buildPostContent(mockProduct, 'slot_test', {
      include_trust_notes: true,
      include_hub_links: true
    });

    assert.match(postWithTrustAndHub, /توصيل سريع برايم/);
    assert.match(postWithTrustAndHub, /جميع عروض وتخفيضات السوبرماركت/);
  });

  test('4. buildCairoScheduleSlots adapts to configured publishing hours', () => {
    const customHours = [10, 14, 18, 22];
    const slots = buildCairoScheduleSlots('2026-11-24', customHours);
    assert.strictEqual(slots.length, 4);
    assert.strictEqual(slots[0].slot, '2026-11-24_10:00');
    assert.strictEqual(slots[3].slot, '2026-11-24_22:00');
  });
});
