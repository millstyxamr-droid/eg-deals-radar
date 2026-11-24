/**
 * Environment configuration loader (zero-dependency CommonJS)
 */

const fs = require('fs');
const path = require('path');

function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf-8');
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (process.env[key] === undefined) {
          process.env[key] = val;
        }
      }
    }
  }
}

function loadJsonConfig(applyEnv = false) {
  const jsonPath = path.join(__dirname, '..', 'config.json');
  if (fs.existsSync(jsonPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
      if (applyEnv) {
        if (data.affiliate && data.affiliate.amazon_tag) {
          process.env.AMAZON_AFFILIATE_TAG = data.affiliate.amazon_tag;
        }
        if (data.telegram) {
          if (data.telegram.bot_token && !process.env.TELEGRAM_BOT_TOKEN) {
            process.env.TELEGRAM_BOT_TOKEN = data.telegram.bot_token;
          }
          if (data.telegram.channel_id) {
            if (!process.env.TELEGRAM_CHAT_ID) process.env.TELEGRAM_CHAT_ID = data.telegram.channel_id;
            if (!process.env.TELEGRAM_CHANNEL_ID) process.env.TELEGRAM_CHANNEL_ID = data.telegram.channel_id;
          }
        }
      }
      return data;
    } catch (e) {}
  }
  return null;
}

// Initial load
loadEnv();
const userSettings = loadJsonConfig(true);

module.exports = {
  loadEnv,
  loadJsonConfig,
  get userSettings() {
    return loadJsonConfig();
  },
  get TELEGRAM_BOT_TOKEN() {
    return process.env.TELEGRAM_BOT_TOKEN || '';
  },
  get ALLOWED_CHAT_IDS() {
    return (process.env.ALLOWED_CHAT_IDS || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
  },
  get AMAZON_AFFILIATE_TAG() {
    return process.env.AMAZON_AFFILIATE_TAG || '';
  },
  get postsPerSlot() {
    const s = loadJsonConfig();
    return (s && s.telegram && typeof s.telegram.posts_per_slot === 'number') ? s.telegram.posts_per_slot : 4;
  },
  get minDiscountPct() {
    const s = loadJsonConfig();
    return (s && s.deals_filter && typeof s.deals_filter.min_discount_pct === 'number') ? s.deals_filter.min_discount_pct : 25;
  },
  get maxPostsPerCategory() {
    const s = loadJsonConfig();
    return (s && s.deals_filter && typeof s.deals_filter.max_posts_per_category === 'number') ? s.deals_filter.max_posts_per_category : 2;
  },
  get cairoPublishingHours() {
    const s = loadJsonConfig();
    return (s && s.deals_filter && Array.isArray(s.deals_filter.cairo_publishing_hours)) ? s.deals_filter.cairo_publishing_hours : [9, 11, 12, 13, 14, 15, 17, 18, 19, 20, 21, 22, 23];
  }
};
