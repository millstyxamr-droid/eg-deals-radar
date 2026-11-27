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

  test('Case 7: Jumia Egypt URL -> builds JForce Adjust attribution URL with casid', () => {
    const rawUrl = 'https://www.jumia.com.eg/sample-product-12345.html';
    const result = withAffiliate(rawUrl, 'slot_12');

    const adj = new URL(result);
    assert.strictEqual(adj.origin, 'https://aal4.adj.st');
    assert.strictEqual(adj.searchParams.get('adjust_t'), '1hao9f64_1heefw7z');
    assert.strictEqual(adj.searchParams.get('adjust_campaign'), 'JF_Affiliate_EG');

    const inner = new URL(adj.searchParams.get('adjust_redirect'));
    assert.strictEqual(inner.origin, 'https://www.jumia.com.eg');
    assert.strictEqual(inner.searchParams.get('utm_source'), 'JFORCE');
    assert.strictEqual(inner.searchParams.get('utm_medium'), 'JF_Affiliate');
    assert.strictEqual(inner.searchParams.get('adj_label'), 'casid*2ed19718-58e1-47a5-a5d2-c9778e6ac732^type*jforce');
  });

  test('Case 8: Noon URL -> uses NOON_AFFILIATE_TEMPLATE when configured', () => {
    const prev = process.env.NOON_AFFILIATE_TEMPLATE;
    process.env.NOON_AFFILIATE_TEMPLATE = 'https://track.example.com/click?url={url}&sub=noon';
    try {
      const rawUrl = 'https://www.noon.com/egypt-en/sample/p/';
      const result = withAffiliate(rawUrl, 'slot_12');
      assert.strictEqual(
        result,
        `https://track.example.com/click?url=${encodeURIComponent(rawUrl)}&sub=noon`
      );
    } finally {
      if (prev === undefined) delete process.env.NOON_AFFILIATE_TEMPLATE;
      else process.env.NOON_AFFILIATE_TEMPLATE = prev;
    }
  });
});
