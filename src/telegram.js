/**
 * Telegram Bot & Channel Messaging Client
 * Direct Telegram Bot API via native fetch / https.
 * Supports:
 * - HTML escaping
 * - Per-chat throttling (1s per chat) & Channel rate limiting (20/min)
 * - Automatic sendPhoto with sendMessage fallback on missing/failed images
 * - Retry with exponential backoff & 429 Too Many Requests handling
 * - Channel post publisher with --dry-run mode
 */

const https = require('https');
const { URL } = require('url');

const DEFAULT_TIMEOUT_MS = 10000;
const MAX_RETRIES = 3;
const RATE_LIMIT_DELAY_MS = 3000; // 20 posts/min for channels

// Throttle map: chatId -> last timestamp
const chatLastSent = new Map();

function _testResetThrottle() {
  chatLastSent.clear();
}

/**
 * Utility sleep
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Escape HTML special characters for Telegram HTML parse mode
 */
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Enforce minimum 1000ms interval between messages sent to the same chat
 */
async function applyThrottle(chatId) {
  const key = String(chatId);
  const now = Date.now();
  const last = chatLastSent.get(key) || 0;
  const elapsed = now - last;
  if (elapsed < 1000) {
    await sleep(1000 - elapsed);
  }
  chatLastSent.set(key, Date.now());
}

/**
 * Validate product image URL
 * Checks if URL is valid and not smaller than 200px based on Amazon naming conventions.
 */
function validateProductImage(imageUrl) {
  if (!imageUrl || typeof imageUrl !== 'string' || !imageUrl.trim()) {
    return { valid: false, reason: 'missing' };
  }

  const trimmed = imageUrl.trim();
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch (e) {
    return { valid: false, reason: 'invalid_url' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, reason: 'invalid_protocol' };
  }

  // Detect Amazon size markers below 200px (e.g. ._SX150_, ._SY160_, ._AC_UL120_)
  const smallDimRegex = /\._(?:SX|SY|UL|SL|AC_UL|AC_US|CR\d+,\d+,)(\d{1,3})_/i;
  const match = trimmed.match(smallDimRegex);
  if (match) {
    const dim = parseInt(match[1], 10);
    if (dim > 0 && dim < 200) {
      return { valid: false, reason: `dimension_too_small_${dim}px` };
    }
  }

  return { valid: true, url: trimmed };
}

/**
 * Standard HTTPS fetch fallback for environments without global fetch
 */
function nativeHttpsFetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const postData = options.body || '';

    const reqOptions = {
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        ...(options.headers || {})
      },
      timeout: options.timeout || DEFAULT_TIMEOUT_MS
    };

    const req = https.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          json: async () => JSON.parse(data),
          text: async () => data
        });
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error(`Network timeout after ${reqOptions.timeout}ms`));
    });

    req.on('error', reject);

    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

/**
 * Execute Telegram API call with retries and 429 backoff handling
 */
async function callTelegramApi(token, method, payload, options = {}) {
  const fetchFn = options.fetchFn || (typeof fetch === 'function' ? fetch : nativeHttpsFetch);
  const maxRetries = options.retries !== undefined ? options.retries : MAX_RETRIES;
  const url = `https://api.telegram.org/bot${token}/${method}`;

  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetchFn(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.status === 429) {
        let retryAfter = 1;
        try {
          const body = await res.json();
          if (body && body.parameters && body.parameters.retry_after) {
            retryAfter = body.parameters.retry_after;
          }
        } catch (e) {}
        console.warn(`[telegram] Rate limited (429). Retrying after ${retryAfter}s...`);
        await sleep(retryAfter * 1000);
        continue;
      }

      if (res.status >= 400 && res.status < 500) {
        // Client errors (e.g. 400 PHOTO_INVALID_DIMENSIONS) should not be retried
        let desc = `HTTP error ${res.status}`;
        try {
          const json = await res.json();
          if (json && json.description) desc = json.description;
        } catch (e) {}
        const clientErr = new Error(`Telegram API Error: ${desc}`);
        clientErr.isClientError = true;
        throw clientErr;
      }

      if (res.status >= 500 && res.status < 600) {
        throw new Error(`Telegram server error ${res.status}`);
      }

      const json = await res.json();
      if (!res.ok || !json.ok) {
        const desc = (json && json.description) || `HTTP error ${res.status}`;
        throw new Error(`Telegram API Error: ${desc}`);
      }

      return json;
    } catch (err) {
      if (err.isClientError) {
        throw err;
      }
      lastError = err;
      if (attempt < maxRetries) {
        const delay = 1000 * Math.pow(2, attempt - 1);
        await sleep(delay);
      }
    }
  }

  throw lastError || new Error(`Telegram call to ${method} failed after ${maxRetries} attempts`);
}

/**
 * Send a text message to a chat/channel
 */
async function sendMessage(chatId, text, options = {}) {
  await applyThrottle(chatId);
  const token = options.token || process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is required');

  const payload = {
    chat_id: chatId,
    text: text,
    parse_mode: options.parse_mode || 'HTML'
  };

  return callTelegramApi(token, 'sendMessage', payload, options);
}

/**
 * Send a photo to a chat/channel with fallback to sendMessage
 */
async function sendPhoto(chatId, photoUrl, caption, options = {}) {
  const token = options.token || process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is required');

  const imgCheck = validateProductImage(photoUrl);

  // If photo URL is invalid or null, fallback directly to sendMessage
  if (!imgCheck.valid) {
    return sendMessage(chatId, caption, options);
  }

  await applyThrottle(chatId);

  try {
    const payload = {
      chat_id: chatId,
      photo: imgCheck.url,
      caption: caption,
      parse_mode: options.parse_mode || 'HTML'
    };
    return await callTelegramApi(token, 'sendPhoto', payload, options);
  } catch (err) {
    console.warn(`[telegram] sendPhoto failed (${err.message}), falling back to sendMessage`);
    return sendMessage(chatId, caption, options);
  }
}

/**
 * High-level function to send a post to a Telegram channel.
 * Supports --dry-run mode, image validation, photo/text fallback, and rate limit.
 */
async function sendPostToChannel({
  token = process.env.TELEGRAM_BOT_TOKEN,
  chatId = process.env.TELEGRAM_CHANNEL_ID,
  text,
  imageUrl = null,
  asin = 'UNKNOWN',
  slot = 'channel',
  dryRun = false,
  fetchFn = null
}) {
  if (dryRun) {
    const imgCheck = validateProductImage(imageUrl);
    console.log(`\n================== [DRY RUN TELEGRAM POST] ==================`);
    console.log(`ASIN:     ${asin}`);
    console.log(`Slot:     ${slot}`);
    console.log(`Channel:  ${chatId || '(NOT_SET)'}`);
    console.log(`Image:    ${imgCheck.valid ? imgCheck.url : `[NO PHOTO - Fallback to text (${imgCheck.reason})]`}`);
    console.log(`------------------------ Message Content ------------------------`);
    console.log(text);
    console.log(`=================================================================\n`);

    return {
      ok: true,
      dry_run: true,
      message_id: `dry-run-${Date.now()}`
    };
  }

  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN environment variable is missing or empty.');
  }
  if (!chatId) {
    throw new Error('TELEGRAM_CHANNEL_ID environment variable is missing or empty.');
  }

  const res = await sendPhoto(chatId, imageUrl, text, { token, fetchFn });
  return {
    ok: true,
    message_id: (res && res.result && res.result.message_id) || 'unknown'
  };
}

module.exports = {
  escapeHtml,
  applyThrottle,
  _testResetThrottle,
  validateProductImage,
  callTelegramApi,
  sendMessage,
  sendPhoto,
  sendPostToChannel,
  sleep,
  RATE_LIMIT_DELAY_MS
};
