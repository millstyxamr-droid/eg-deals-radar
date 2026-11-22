const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const { withAffiliate, resetAffiliateWarning } = require('../src/affiliate');

describe('Affiliate Module (src/affiliate.js)', () => {
  const originalEnv = process.env.AMAZON_AFFILIATE_TAG;

  beforeEach(() => {
    resetAffiliateWarning();
    process.env.AMAZON_AFFILIATE_TAG = 'souqeg-21';
  });

  test('Case 1: URL without query parameters -> adds tag and UTM analytics', () => {
    const rawUrl = 'https://www.amazon.eg/dp/B08XYZ1234';
    const result = withAffiliate(rawUrl, 'slot_morning');

    const parsed = new URL(result);
    assert.strictEqual(parsed.origin, 'https://www.amazon.eg');
    assert.strictEqual(parsed.pathname, '/dp/B08XYZ1234');
    assert.strictEqual(parsed.searchParams.get('tag'), 'souqeg-21');
    assert.strictEqual(parsed.searchParams.get('utm_source'), 'telegram');
    assert.strictEqual(parsed.searchParams.get('utm_medium'), 'channel');
    assert.strictEqual(parsed.searchParams.get('utm_campaign'), 'slot_morning');
  });

  test('Case 2: URL with existing query (e.g. /tez/...) -> preserves query and appends tag & UTM', () => {
    const rawUrl = 'https://www.amazon.eg/tez/product?qcbrand=sAuWWBROaG&ref=sr_1_1';
    const result = withAffiliate(rawUrl, '2026-11-21_13');

    const parsed = new URL(result);
    assert.strictEqual(parsed.searchParams.get('qcbrand'), 'sAuWWBROaG');
    assert.strictEqual(parsed.searchParams.get('ref'), 'sr_1_1');
    assert.strictEqual(parsed.searchParams.get('tag'), 'souqeg-21');
    assert.strictEqual(parsed.searchParams.get('utm_source'), 'telegram');
    assert.strictEqual(parsed.searchParams.get('utm_medium'), 'channel');
    assert.strictEqual(parsed.searchParams.get('utm_campaign'), '2026-11-21_13');
  });

  test('Case 3: URL with an existing/old tag -> replaces old tag with current tag', () => {
    const rawUrl = 'https://www.amazon.eg/dp/B09ABC5678?tag=old-affiliate-20&psc=1';
    const result = withAffiliate(rawUrl, 'slot_evening');

    const parsed = new URL(result);
    assert.strictEqual(parsed.searchParams.get('tag'), 'souqeg-21');
    assert.strictEqual(parsed.searchParams.get('psc'), '1');
    assert.strictEqual(parsed.searchParams.getAll('tag').length, 1, 'Tag must not be duplicated');
    assert.strictEqual(parsed.searchParams.get('utm_source'), 'telegram');
  });

  test('Case 4: Non-Amazon URL -> returns original URL as-is without modification', () => {
    const externalUrl = 'https://google.com/search?q=milk+egypt';
    const result = withAffiliate(externalUrl, 'slot_09');

    assert.strictEqual(result, externalUrl);
  });

  test('Case 5: Empty or missing env -> returns URL as-is and logs warning only once', () => {
    delete process.env.AMAZON_AFFILIATE_TAG;
    resetAffiliateWarning();

    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (msg) => warnings.push(msg);

    try {
      const url1 = 'https://www.amazon.eg/dp/B012345678';
      const res1 = withAffiliate(url1);
      assert.strictEqual(res1, url1, 'Should return original URL when env tag is missing');

      const url2 = 'https://www.amazon.eg/dp/B099999999';
      const res2 = withAffiliate(url2);
      assert.strictEqual(res2, url2, 'Should return original URL second time too');

      assert.strictEqual(warnings.length, 1, 'Warning must be printed exactly once');
      assert.match(warnings[0], /AMAZON_AFFILIATE_TAG/);
    } finally {
      console.warn = originalWarn;
      if (originalEnv) {
        process.env.AMAZON_AFFILIATE_TAG = originalEnv;
      }
    }
  });

  test('Case 6: Default slot when slot is omitted', () => {
    const rawUrl = 'https://www.amazon.eg/dp/B08XYZ1234';
    const result = withAffiliate(rawUrl);

    const parsed = new URL(result);
    assert.strictEqual(parsed.searchParams.get('utm_campaign'), 'channel');
  });
});
