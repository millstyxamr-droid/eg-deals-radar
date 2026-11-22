const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const telegram = require('../src/telegram');
const bot = require('../bot');
const alerts = require('../src/alerts');
const repo = require('../src/repo');
const config = require('../src/config');

describe('Telegram Module & Bot Tests', () => {

  beforeEach(() => {
    telegram._testResetThrottle();
  });

  test('escapeHtml properly escapes HTML special characters (<, >, &, ")', () => {
    const raw = '<div class="test">Fish & Chips > Salad < 10</div>';
    const escaped = telegram.escapeHtml(raw);
    assert.strictEqual(
      escaped,
      '&lt;div class=&quot;test&quot;&gt;Fish &amp; Chips &gt; Salad &lt; 10&lt;/div&gt;'
    );
    assert.strictEqual(telegram.escapeHtml(null), '');
    assert.strictEqual(telegram.escapeHtml(undefined), '');
  });

  test('sendMessage successful call with mock fetch', async () => {
    let capturedUrl = '';
    let capturedBody = null;

    const mockFetch = async (url, options) => {
      capturedUrl = url;
      capturedBody = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: { message_id: 42 } })
      };
    };

    const res = await telegram.sendMessage(12345, '<b>Hello Test</b>', {
      token: 'TEST_TOKEN',
      fetchFn: mockFetch
    });

    assert.ok(res.ok);
    assert.strictEqual(res.result.message_id, 42);
    assert.strictEqual(capturedUrl, 'https://api.telegram.org/botTEST_TOKEN/sendMessage');
    assert.strictEqual(capturedBody.chat_id, 12345);
    assert.strictEqual(capturedBody.text, '<b>Hello Test</b>');
    assert.strictEqual(capturedBody.parse_mode, 'HTML');
  });

  test('sendMessage handles 429 Too Many Requests with retry_after', async () => {
    let callCount = 0;

    const mockFetch = async () => {
      callCount++;
      if (callCount === 1) {
        // Return 429 with retry_after of 0.05 seconds
        return {
          ok: false,
          status: 429,
          json: async () => ({
            ok: false,
            description: 'Too Many Requests',
            parameters: { retry_after: 0.05 }
          })
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: { message_id: 99 } })
      };
    };

    const res = await telegram.sendMessage(12345, 'Test 429', {
      token: 'TEST_TOKEN',
      fetchFn: mockFetch,
      retries: 2
    });

    assert.ok(res.ok);
    assert.strictEqual(callCount, 2, 'Should have retried after 429');
    assert.strictEqual(res.result.message_id, 99);
  });

  test('sendMessage handles 500 Server Error with exponential backoff retry', async () => {
    let callCount = 0;

    const mockFetch = async () => {
      callCount++;
      if (callCount === 1) {
        return {
          ok: false,
          status: 502,
          text: async () => 'Bad Gateway'
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: { message_id: 101 } })
      };
    };

    const res = await telegram.sendMessage(12345, 'Test 500', {
      token: 'TEST_TOKEN',
      fetchFn: mockFetch,
      retries: 2
    });

    assert.ok(res.ok);
    assert.strictEqual(callCount, 2, 'Should have retried after 5xx');
  });

  test('sendPhoto falls back to sendMessage when photo fails', async () => {
    const sentMethods = [];

    const mockFetch = async (url) => {
      if (url.includes('/sendPhoto')) {
        sentMethods.push('sendPhoto');
        return {
          ok: false,
          status: 400,
          json: async () => ({ ok: false, description: 'PHOTO_INVALID_DIMENSIONS' })
        };
      }
      if (url.includes('/sendMessage')) {
        sentMethods.push('sendMessage');
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, result: { message_id: 202 } })
        };
      }
      throw new Error('Unknown URL');
    };

    const res = await telegram.sendPhoto(12345, 'https://example.com/bad_image.jpg', '<b>Caption</b>', {
      token: 'TEST_TOKEN',
      fetchFn: mockFetch
    });

    assert.ok(res.ok);
    assert.deepStrictEqual(sentMethods, ['sendPhoto', 'sendMessage']);
  });

  test('sendPhoto falls back to text immediately if photo URL is invalid or null', async () => {
    const sentMethods = [];

    const mockFetch = async (url) => {
      sentMethods.push(url.split('/').pop());
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: { message_id: 303 } })
      };
    };

    await telegram.sendPhoto(12345, null, '<b>No Photo Text</b>', {
      token: 'TEST_TOKEN',
      fetchFn: mockFetch
    });

    assert.deepStrictEqual(sentMethods, ['sendMessage']);
  });

  test('Throttling enforces at least 1 second between messages to the same chat', async () => {
    const start = Date.now();
    await telegram.applyThrottle('chat_speed_test');
    await telegram.applyThrottle('chat_speed_test');
    const elapsed = Date.now() - start;
    assert.ok(elapsed >= 950, `Expected elapsed time >= 950ms, got ${elapsed}ms`);
  });

  test('extractAsinAndTarget extracts ASIN and target price from text or URLs', () => {
    const res1 = bot.extractAsinAndTarget('/watch B0D4B1S9G3 450');
    assert.strictEqual(res1.asin, 'B0D4B1S9G3');
    assert.strictEqual(res1.targetPrice, 450);

    const res2 = bot.extractAsinAndTarget('/watch https://www.amazon.eg/dp/B0CT8S41V8?ref=deal 170');
    assert.strictEqual(res2.asin, 'B0CT8S41V8');
    assert.strictEqual(res2.targetPrice, 170);

    const res3 = bot.extractAsinAndTarget('/watch B0B22QGSFR');
    assert.strictEqual(res3.asin, 'B0B22QGSFR');
    assert.strictEqual(res3.targetPrice, null);

    const res4 = bot.extractAsinAndTarget('/watch');
    assert.strictEqual(res4.asin, null);
  });

  test('Whitelist security blocks unauthorized chats when configured', () => {
    process.env.ALLOWED_CHAT_IDS = '111,222';
    assert.strictEqual(bot.isChatAllowed('111'), true);
    assert.strictEqual(bot.isChatAllowed('222'), true);
    assert.strictEqual(bot.isChatAllowed('999'), false);
    delete process.env.ALLOWED_CHAT_IDS;
  });

  test('Affiliate URL builder appends tag correctly', () => {
    process.env.AMAZON_AFFILIATE_TAG = 'mydeals-21';
    const url1 = alerts.buildAffiliateUrl('https://www.amazon.eg/dp/B0D4B1S9G3', 'B0D4B1S9G3');
    assert.strictEqual(url1, 'https://www.amazon.eg/dp/B0D4B1S9G3?tag=mydeals-21');

    const url2 = alerts.buildAffiliateUrl('https://www.amazon.eg/dp/B0D4B1S9G3?qcbrand=sAuWWBROaG', 'B0D4B1S9G3');
    assert.strictEqual(url2, 'https://www.amazon.eg/dp/B0D4B1S9G3?qcbrand=sAuWWBROaG&tag=mydeals-21');
    delete process.env.AMAZON_AFFILIATE_TAG;
  });

});
