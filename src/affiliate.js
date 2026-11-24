/**
 * Amazon Egypt Affiliate Link Generator
 * Appends or replaces affiliate tag and UTM analytics parameters.
 * Evaluated at display/posting time, not at storage time.
 */

const DEFAULT_AFFILIATE_TAG = 'egdealsradar-21';
const DEFAULT_JUMIA_AFFILIATE_TAG = 'egdealsradar-jumia';
const DEFAULT_NOON_AFFILIATE_TAG = 'egdealsradar-noon';
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
function getAffiliateTag(store = 'amazon') {
  if (store === 'jumia') {
    return (process.env.JUMIA_AFFILIATE_TAG && process.env.JUMIA_AFFILIATE_TAG.trim()) || DEFAULT_JUMIA_AFFILIATE_TAG;
  }
  if (store === 'noon') {
    return (process.env.NOON_AFFILIATE_TAG && process.env.NOON_AFFILIATE_TAG.trim()) || DEFAULT_NOON_AFFILIATE_TAG;
  }
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
 * Check if the URL is a Jumia Egypt or Jumia URL
 */
function isJumiaUrl(urlStr) {
  try {
    const parsed = new URL(urlStr);
    const host = parsed.hostname.toLowerCase();
    return (
      host === 'jumia.com.eg' ||
      host.endsWith('.jumia.com.eg') ||
      host === 'jumia.com' ||
      host.endsWith('.jumia.com')
    );
  } catch (e) {
    return false;
  }
}

/**
 * Check if the URL is a Noon Egypt or Noon URL
 */
function isNoonUrl(urlStr) {
  try {
    const parsed = new URL(urlStr);
    const host = parsed.hostname.toLowerCase();
    return (
      host === 'noon.com' ||
      host.endsWith('.noon.com')
    );
  } catch (e) {
    return false;
  }
}

/**
 * Detect store from URL
 */
function detectStore(urlStr) {
  if (isAmazonUrl(urlStr)) return 'amazon';
  if (isJumiaUrl(urlStr)) return 'jumia';
  if (isNoonUrl(urlStr)) return 'noon';
  return 'unknown';
}

/**
 * Append or replace affiliate tag and UTM parameters on supported store URLs (Amazon, Jumia, Noon).
 *
 * @param {string} url - Original product URL
 * @param {string} [slot='channel'] - Publishing slot/campaign identifier
 * @param {string} [tagOverride] - Optional tag override
 * @returns {string} - Modified URL with affiliate and UTM tags, or original URL
 */
function withAffiliate(url, slot = 'channel', tagOverride = null) {
  if (!url || typeof url !== 'string') {
    return url;
  }

  // Validate URL
  let parsed;
  try {
    parsed = new URL(url);
  } catch (e) {
    return url;
  }

  const campaign = (slot && String(slot).trim()) ? String(slot).trim() : 'channel';

  // Handle Amazon URLs
  if (isAmazonUrl(url)) {
    const tag = (tagOverride || process.env.AMAZON_AFFILIATE_TAG || '').trim();
    if (!tag) {
      if (!warnedMissingTag) {
        console.warn('[affiliate] Warning: AMAZON_AFFILIATE_TAG is empty or not configured. Returning URL without affiliate tag.');
        warnedMissingTag = true;
      }
      return url;
    }

    parsed.searchParams.set('tag', tag);
    parsed.searchParams.set('utm_source', 'telegram');
    parsed.searchParams.set('utm_medium', 'channel');
    parsed.searchParams.set('utm_campaign', campaign);
    return parsed.toString();
  }

  // Handle Jumia URLs
  if (isJumiaUrl(url)) {
    const tag = (tagOverride || process.env.JUMIA_AFFILIATE_TAG || DEFAULT_JUMIA_AFFILIATE_TAG).trim();
    parsed.searchParams.set('utm_source', 'kol');
    parsed.searchParams.set('utm_medium', 'affiliate');
    parsed.searchParams.set('utm_campaign', campaign);
    if (tag) {
      parsed.searchParams.set('aff_sub', tag);
    }
    return parsed.toString();
  }

  // Handle Noon URLs
  if (isNoonUrl(url)) {
    parsed.searchParams.set('utm_source', 'affiliate');
    parsed.searchParams.set('utm_medium', 'channel');
    parsed.searchParams.set('utm_campaign', campaign);
    return parsed.toString();
  }

  // Other URLs - return unchanged
  return url;
}

module.exports = {
  withAffiliate,
  isAmazonUrl,
  isJumiaUrl,
  isNoonUrl,
  detectStore,
  resetAffiliateWarning,
  getAffiliateTag,
  DEFAULT_AFFILIATE_TAG,
  DEFAULT_JUMIA_AFFILIATE_TAG,
  DEFAULT_NOON_AFFILIATE_TAG
};
