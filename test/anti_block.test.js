const { test, describe } = require('node:test');
const assert = require('node:assert');
const {
  checkBlockStatus,
  calculateCooldown,
  AmazonBlockError
} = require('../src/anti_block');

describe('Anti-Block & 503 Protection Tests', () => {
  test('1. Detects HTTP 503 and 429 status codes directly', () => {
    const res503 = checkBlockStatus({ status: 503 });
    assert.strictEqual(res503.isBlocked, true);
    assert.strictEqual(res503.is503, true);

    const res429 = checkBlockStatus({ status: 429 });
    assert.strictEqual(res429.isBlocked, true);
    assert.strictEqual(res429.isCaptcha, false);
  });

  test('2. Detects Amazon automated access support notice in body (even if HTTP 200)', () => {
    const body = `
      To discuss automated access to Amazon data please contact api-services-support@amazon.com.
      For information about migrating to our APIs, refer to our Marketplace APIs at https://developer.amazonservices.com.
    `;
    const res = checkBlockStatus({ status: 200, bodyText: body });
    assert.strictEqual(res.isBlocked, true);
    assert.ok(res.reason.includes('automated access'));
  });

  test('3. Detects Amazon English and Arabic CAPTCHA challenges', () => {
    const engCaptcha = checkBlockStatus({
      status: 200,
      title: 'Amazon.eg: CAPTCHA',
      bodyText: 'Enter the characters you see below'
    });
    assert.strictEqual(engCaptcha.isBlocked, true);
    assert.strictEqual(engCaptcha.isCaptcha, true);

    const arCaptcha = checkBlockStatus({
      status: 200,
      title: 'Amazon.eg',
      bodyText: 'أدخل الأحرف التي تراها أدناه لمتابعة التسوق'
    });
    assert.strictEqual(arCaptcha.isBlocked, true);
    assert.strictEqual(arCaptcha.isCaptcha, true);
  });

  test('4. Detects 503 in page title or error URL', () => {
    const titleBlock = checkBlockStatus({
      status: 200,
      title: '503 - Service Unavailable Error'
    });
    assert.strictEqual(titleBlock.isBlocked, true);
    assert.strictEqual(titleBlock.is503, true);

    const urlBlock = checkBlockStatus({
      status: 200,
      url: 'https://www.amazon.eg/errors/503.html'
    });
    assert.strictEqual(urlBlock.isBlocked, true);
  });

  test('5. Passes clean normal e-commerce page without false positives', () => {
    const cleanPage = checkBlockStatus({
      status: 200,
      url: 'https://www.amazon.eg/tez/browse?qcbrand=sAuWWBROaG',
      title: 'Amazon Now: البقالة والسوبرماركت',
      bodyText: 'عروض اليوم، حليب جهينة، بامبرز مقاس 4، اشتري الآن'
    });
    assert.strictEqual(cleanPage.isBlocked, false);
    assert.strictEqual(cleanPage.reason, null);
  });

  test('6. calculateCooldown yields exponential backoff with jitter', () => {
    const c1 = calculateCooldown(1, 30000);
    const c2 = calculateCooldown(2, 30000);
    const c3 = calculateCooldown(3, 30000);

    // c1 should be ~30s - 38s
    assert.ok(c1 >= 30000 && c1 <= 40000, `c1 was ${c1}`);
    // c2 should be ~60s - 75s
    assert.ok(c2 >= 60000 && c2 <= 80000, `c2 was ${c2}`);
    // c3 should be ~120s - 150s
    assert.ok(c3 >= 120000 && c3 <= 160000, `c3 was ${c3}`);
    // Monotonic increase
    assert.ok(c2 > c1);
    assert.ok(c3 > c2);
  });

  test('8. Detects Amazon Arabic 503 error page even when served as HTTP 200', () => {
    const res = checkBlockStatus({
      status: 200,
      title: 'عذرًا!',
      bodyText: 'عذرًا! حدث خطأ عند محاولة معالجة طلبك. نحن نعمل على حل المشكلة ونتوقع حلها قريبًا.'
    });
    assert.strictEqual(res.isBlocked, true);
    assert.strictEqual(res.is503, true);
  });

  test('7. AmazonBlockError carries error attributes properly', () => {
    const err = new AmazonBlockError('Throttled', { status: 503, is503: true, reason: 'Server Busy' });
    assert.strictEqual(err.name, 'AmazonBlockError');
    assert.strictEqual(err.status, 503);
    assert.strictEqual(err.is503, true);
    assert.strictEqual(err.reason, 'Server Busy');
  });
});
