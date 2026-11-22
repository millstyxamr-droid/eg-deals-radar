/**
 * Amazon Egypt Affiliate Link Generator
 * Appends or replaces affiliate tag and UTM analytics parameters.
 * Evaluated at display/posting time, not at storage time.
 */

const DEFAULT_AFFILIATE_TAG = 'egdealsradar-21';
let warnedMissingTag = false;

/**
 * Reset warning flag (primarily for test isolation)
 */
function resetAffiliateWarning() {
  warnedMissingTag = false;
}

/**
 * Returns configured affiliate tag or fallback
 */
function getAffiliateTag() {
  return (process.env.AMAZON_AFFILIATE_TAG && process.env.AMAZON_AFFILIATE_TAG.trim()) || DEFAULT_AFFILIATE_TAG;
}

/**
 * Check if the URL is an Amazon Egypt or Amazon URL
 */
function isAmazonUrl(urlStr) {
  try {
    const parsed = new URL(urlStr);
    const host = parsed.hostname.toLowerCase();
    return (
      host === 'amazon.eg' ||
      host.endsWith('.amazon.eg') ||
      host === 'amazon.com' ||
      host.endsWith('.amazon.com')
    );
  } catch (e) {
    return false;
  }
}

/**
 * Append or replace affiliate tag and UTM parameters on an Amazon Egypt URL.
 *
 * @param {string} url - Original product URL (e.g. /dp/ASIN or /tez/...)
 * @param {string} [slot='channel'] - Publishing slot/campaign identifier
 * @param {string} [tagOverride] - Optional tag override
 * @returns {string} - Modified URL with affiliate and UTM tags, or original URL
 */
function withAffiliate(url, slot = 'channel', tagOverride = null) {
  if (!url || typeof url !== 'string') {
    return url;
  }

  // Validate URL and ensure it belongs to Amazon
  let parsed;
  try {
    parsed = new URL(url);
  } catch (e) {
    return url;
  }

  if (!isAmazonUrl(url)) {
    return url;
  }

  const tag = (tagOverride || process.env.AMAZON_AFFILIATE_TAG || '').trim();
  if (!tag) {
    if (!warnedMissingTag) {
      console.warn('[affiliate] Warning: AMAZON_AFFILIATE_TAG is empty or not configured. Returning URL without affiliate tag.');
      warnedMissingTag = true;
    }
    return url;
  }

  // Set or replace affiliate tag (handles /dp/ASIN and /tez/... queries seamlessly)
  parsed.searchParams.set('tag', tag);

  // Add UTM tracking parameters
  parsed.searchParams.set('utm_source', 'telegram');
  parsed.searchParams.set('utm_medium', 'channel');
  const campaign = (slot && String(slot).trim()) ? String(slot).trim() : 'channel';
  parsed.searchParams.set('utm_campaign', campaign);

  return parsed.toString();
}

module.exports = {
  withAffiliate,
  isAmazonUrl,
  resetAffiliateWarning,
  getAffiliateTag,
  DEFAULT_AFFILIATE_TAG
};
