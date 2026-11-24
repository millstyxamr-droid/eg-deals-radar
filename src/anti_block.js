/**
 * Anti-Block & Rate-Limiting Protection Module for Amazon Egypt Scraper.
 * Detects 503s, 429s, CAPTCHAs, automated access warnings, and implements
 * intelligent cooldowns and circuit breakers.
 */

class AmazonBlockError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'AmazonBlockError';
    this.status = details.status || 503;
    this.reason = details.reason || message;
    this.isCaptcha = !!details.isCaptcha;
    this.is503 = !!details.is503;
  }
}

/**
 * Pure function to inspect page metadata for Amazon blocks / rate limits
 */
function checkBlockStatus({ status = 200, url = '', title = '', bodyText = '' } = {}) {
  // Check HTTP status code
  if (status === 503) {
    return {
      isBlocked: true,
      reason: 'HTTP 503 Service Unavailable (Temporary Server Ban)',
      isCaptcha: false,
      is503: true
    };
  }

  if (status === 429) {
    return {
      isBlocked: true,
      reason: 'HTTP 429 Too Many Requests (Rate Limited)',
      isCaptcha: false,
      is503: false
    };
  }

  const normTitle = (title || '').toLowerCase();
  const normBody = (bodyText || '').toLowerCase();
  const normUrl = (url || '').toLowerCase();

  // Check URL patterns
  if (normUrl.includes('/errors/503') || normUrl.includes('validatecaptcha')) {
    return {
      isBlocked: true,
      reason: 'Redirected to error/captcha URL: ' + url,
      isCaptcha: normUrl.includes('validatecaptcha'),
      is503: normUrl.includes('503')
    };
  }

  // Check Title patterns
  if (
    normTitle.includes('503') ||
    normTitle.includes('service unavailable') ||
    normTitle.includes('server busy') ||
    normTitle.includes('robot check') ||
    normTitle.includes('captcha')
  ) {
    return {
      isBlocked: true,
      reason: `Blocked page title: "${title.trim()}"`,
      isCaptcha: normTitle.includes('robot') || normTitle.includes('captcha'),
      is503: normTitle.includes('503') || normTitle.includes('server busy')
    };
  }

  // Check Body Content signatures
  const blockSignatures = [
    { sig: 'api-services-support@amazon.com', reason: 'Amazon automated access detection notice' },
    { sig: 'to discuss automated access to amazon data', reason: 'Automated access throttling page' },
    { sig: 'enter the characters you see below', reason: 'Amazon CAPTCHA challenge', isCaptcha: true },
    { sig: 'أدخل الأحرف التي تراها أدناه', reason: 'Amazon Arabic CAPTCHA challenge', isCaptcha: true },
    { sig: 'type the characters', reason: 'Amazon CAPTCHA challenge', isCaptcha: true },
    { sig: 'sorry, we just need to make sure you\'re not a robot', reason: 'Bot check detection', isCaptcha: true },
    { sig: '503 - service unavailable error', reason: 'Amazon 503 Service Unavailable page', is503: true }
  ];

  for (const item of blockSignatures) {
    if (normBody.includes(item.sig)) {
      return {
        isBlocked: true,
        reason: item.reason,
        isCaptcha: !!item.isCaptcha,
        is503: !!item.is503
      };
    }
  }

  return {
    isBlocked: false,
    reason: null,
    isCaptcha: false,
    is503: false
  };
}

/**
 * Calculates exponential cooldown with jitter
 * Attempt 1: ~30s, Attempt 2: ~60s, Attempt 3+: ~120s
 */
function calculateCooldown(consecutiveCount, baseMs = 30000, maxMs = 180000) {
  const attempt = Math.max(1, consecutiveCount);
  const factor = Math.pow(2, attempt - 1);
  const rawDelay = Math.min(baseMs * factor, maxMs);
  // Add 10-25% random jitter
  const jitter = rawDelay * (0.1 + Math.random() * 0.15);
  return Math.round(rawDelay + jitter);
}

/**
 * Inspects a Playwright page & response
 */
async function detectAmazonBlockFromPage(page, response) {
  const status = response ? response.status() : 200;
  const url = page.url();

  let title = '';
  let bodyText = '';

  try {
    title = await page.title();
  } catch (e) {}

  try {
    bodyText = await page.evaluate(() => {
      const b = document.body;
      return b ? b.innerText.slice(0, 3000) : '';
    });
  } catch (e) {}

  return checkBlockStatus({ status, url, title, bodyText });
}

module.exports = {
  AmazonBlockError,
  checkBlockStatus,
  calculateCooldown,
  detectAmazonBlockFromPage
};
