/**
 * Telegram Channel Post Generator
 * Selects candidate deals from deals_scores (is_real_deal=1, confidence high/medium),
 * enforces category diversity (max 2 per department), checks 7-day cooldown,
 * formats concise Egyptian Arabic posts, and schedules slots across Cairo peak/regular hours.
 */

const path = require('path');
const db = require('./db');
const repo = require('./repo');
const { withAffiliate } = require('./affiliate');
const { validateProductImage } = require('./telegram');

// Cairo publishing hours: 9,11,13,15,17,19,21,23 + peak hours (12, 14, 18, 20, 22) -> 13 slots
const CAIRO_HOURS = [9, 11, 12, 13, 14, 15, 17, 18, 19, 20, 21, 22, 23];

/**
 * Get current date string formatted as YYYY-MM-DD in Cairo timezone
 */
function getCairoDateString(date = new Date()) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Cairo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(date);
  } catch (e) {
    // Fallback if ICU timezone is not available
    const offset = 2 * 60; // Cairo is UTC+2
    const cairoDate = new Date(date.getTime() + offset * 60 * 1000);
    return cairoDate.toISOString().slice(0, 10);
  }
}

/**
 * Build Cairo schedule time slots for a specific date
 * Returns array of { slot: string, scheduled_at: string, hour: number }
 */
function buildCairoScheduleSlots(dateStr = getCairoDateString()) {
  return CAIRO_HOURS.map(hour => {
    const hourStr = String(hour).padStart(2, '0');
    const slot = `${dateStr}_${hourStr}:00`;
    // Scheduled time with Cairo UTC+02:00 offset
    const scheduled_at = `${dateStr}T${hourStr}:00:00+02:00`;
    return {
      slot,
      scheduled_at,
      hour
    };
  });
}

/**
 * Clean and normalize category name to a valid Telegram hashtag
 */
function categoryToHashtag(catName) {
  if (!catName || typeof catName !== 'string') return 'عروض';
  const cleaned = catName
    .trim()
    .replace(/[^\u0621-\u064Aa-zA-Z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || 'عروض';
}

/**
 * Format post message content in concise Egyptian Arabic
 *
 * Template:
 * 🔥 <اسم المنتج>
 * السعر: X ج.م (كان Y) — أقل من سعره المعتاد Z%
 * الوحدة: 45.5 ج.م/كجم
 * 🛒 <لينك أفلييت>
 * #<القسم> #عروض_النهاردة
 *
 * Rules:
 * - No fake exaggeration.
 * - "أرخص سعر" is strictly forbidden UNLESS all_time_low === 1 AND a verified
 *   historical discount exists (i.e. at least 7 days / 5 snapshots of real data).
 * - Amazon's advertised discount is labelled as such and never described as the
 *   product's "usual price".
 */
function buildPostContent(product, slot = 'channel') {
  const lines = [];

  // 1. Title line with icon
  const title = (product.title || '').trim().replace(/\s+/g, ' ');
  lines.push(`🔥 ${title}`);

  // Optional truthful badge: only when we have verified history AND it is the lowest recorded price.
  // With a single snapshot, all_time_low is trivially true, so it must not be trusted on its own.
  const hasVerifiedHistory =
    product.historical_discount_pct !== null && product.historical_discount_pct !== undefined;

  if (product.all_time_low === 1 && hasVerifiedHistory) {
    lines.push(`📉 أرخص سعر اتسجل للمنتج ده!`);
  }

  // 2. Price line: current price, list price (if higher), and discount vs typical price
  const currentPrice = Number(product.current_price !== undefined ? product.current_price : product.price);
  const currentPriceStr = isNaN(currentPrice) ? '' : (currentPrice % 1 === 0 ? currentPrice.toFixed(0) : currentPrice.toFixed(2));

  let priceLine = `السعر: ${currentPriceStr} ج.م`;

  const oldPrice = Number(product.old_price !== undefined ? product.old_price : product.list_price);
  const hasOldPrice = !isNaN(oldPrice) && oldPrice > currentPrice;
  if (hasOldPrice) {
    const oldPriceStr = oldPrice % 1 === 0 ? oldPrice.toFixed(0) : oldPrice.toFixed(2);
    priceLine += ` (كان ${oldPriceStr} ج.م)`;
  }

  // Only a historical discount may be described as "below its usual price".
  const historicalDiscount = Number(product.historical_discount_pct);
  if (hasVerifiedHistory && historicalDiscount > 0) {
    priceLine += ` — أقل من سعره المعتاد ${Math.round(historicalDiscount)}%`;
  }
  lines.push(priceLine);

  // Unverified discounts are Amazon's own claim: label them explicitly, never as "usual price".
  const advertisedDiscount = Number(product.advertised_discount_pct);
  if (!hasVerifiedHistory && advertisedDiscount > 0) {
    lines.push(`🏷️ خصم معلن من أمازون: ${Math.round(advertisedDiscount)}% (مقارنة بالسعر المعلن)`);
  }

  // 3. Unit price line (only if available)
  if (product.unit_price && product.unit_price_unit) {
    const unitPriceNum = Number(product.unit_price);
    const unitPriceStr = unitPriceNum % 1 === 0 ? unitPriceNum.toFixed(0) : unitPriceNum.toFixed(1);
    lines.push(`الوحدة: ${unitPriceStr} ${product.unit_price_unit}`);
  }

  // 4. Affiliate link
  const productUrl = product.product_url || product.productUrl || '';
  const affiliateUrl = withAffiliate(productUrl, slot);
  lines.push(`🛒 ${affiliateUrl}`);

  // 5. Hashtags line
  const catTag = categoryToHashtag(product.category_name || product.category);
  lines.push(`#${catTag} #عروض_النهاردة`);

  return lines.join('\n');
}

/**
 * Select candidate deals according to the required business logic:
 * - is_real_deal = 1 and confidence IN ('high', 'medium')
 * - Max 2 from the same department
 * - Not posted in the last 7 days
 * - Not already queued for this date
 * - Ranked by unit price value and historical discount %
 */
function selectCandidateDeals(options = {}) {
  const {
    limit = 13,
    maxPerCategory = 2,
    dateStr = getCairoDateString(),
    allowFallback = false
  } = options;

  // 1. Identify excluded ASINs (posted in last 7 days + already in queue for this date)
  const recentPosted = repo.getRecentPostedAsins(7);
  const scheduledToday = repo.getScheduledAsinsForDate(dateStr);
  const excludedAsins = new Set([...recentPosted, ...scheduledToday]);

  // 2. Fetch candidate pool joined with latest snapshots and deal scores
  const query = `
    SELECT
      d.id AS deal_score_id,
      d.asin,
      d.fair_price,
      d.typical_price,
      d.historical_discount_pct,
      d.advertised_discount_pct,
      d.is_real_deal,
      d.confidence,
      d.all_time_low,
      d.price_index,
      d.computed_at,
      p.title,
      p.brand,
      p.category_id,
      coalesce(c.name_ar, c.name, p.category_id, 'عروض') AS category_name,
      p.image_url,
      p.product_url,
      p.unit_price,
      p.unit_price_unit,
      s.price AS current_price,
      s.list_price AS old_price,
      s.discount_badge
    FROM deals_scores d
    JOIN products p ON d.asin = p.asin
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN price_snapshots s ON s.id = (
      SELECT ps.id FROM price_snapshots ps
      WHERE ps.asin = p.asin
      ORDER BY ps.scraped_at DESC, ps.id DESC
      LIMIT 1
    )
    WHERE p.is_active = 1
      AND s.price IS NOT NULL AND s.price > 0
      AND d.id = (
        SELECT ds.id FROM deals_scores ds
        WHERE ds.asin = d.asin
        ORDER BY ds.computed_at DESC, ds.id DESC
        LIMIT 1
      )
  `;

  const allDeals = db.prepare(query).all();

  // 3. Filter for real deals with high or medium confidence
  let eligible = allDeals.filter(d => {
    if (excludedAsins.has(d.asin)) return false;
    return d.is_real_deal === 1 && (d.confidence === 'high' || d.confidence === 'medium');
  });

  // Fallback for initial setups or dry-runs if 0 real deals found
  if (eligible.length === 0 && (allowFallback || allDeals.length > 0)) {
    console.warn('[channel] Note: No 7-day verified real deals found in catalog.db (insufficient historical snapshots).');
    if (allowFallback) {
      console.warn('[channel] Falling back to top active discounted products for dry-run/preview.');
      eligible = allDeals.filter(d => !excludedAsins.has(d.asin));
    }
  }

  // 4. Rank candidates by:
  //    - Unit price presence & best discount percentage
  //    - Confidence high before medium
  //    - Historical discount % descending
  //    - All-time low
  eligible.sort((a, b) => {
    // High confidence preferred
    if (a.confidence === 'high' && b.confidence !== 'high') return -1;
    if (b.confidence === 'high' && a.confidence !== 'high') return 1;

    // All time low preferred
    if ((b.all_time_low || 0) !== (a.all_time_low || 0)) {
      return (b.all_time_low || 0) - (a.all_time_low || 0);
    }

    // Historical discount % descending
    const discA = a.historical_discount_pct || a.advertised_discount_pct || 0;
    const discB = b.historical_discount_pct || b.advertised_discount_pct || 0;
    if (discB !== discA) return discB - discA;

    // Unit price presence preferred
    const hasUnitA = (a.unit_price && a.unit_price > 0) ? 1 : 0;
    const hasUnitB = (b.unit_price && b.unit_price > 0) ? 1 : 0;
    if (hasUnitB !== hasUnitA) return hasUnitB - hasUnitA;

    return 0;
  });

  // 5. Select items enforcing category diversity: maximum 2 per department
  const selected = [];
  const categoryCounts = new Map();

  for (const item of eligible) {
    if (selected.length >= limit) break;

    const cat = item.category_name || item.category_id || 'عام';
    const count = categoryCounts.get(cat) || 0;

    if (count < maxPerCategory) {
      selected.push(item);
      categoryCounts.set(cat, count + 1);
    }
  }

  return selected;
}

/**
 * Generate and schedule the daily posts into channel_queue table.
 * Idempotent: uses INSERT OR IGNORE / ON CONFLICT to avoid duplicate slots.
 *
 * @param {Object} options
 * @param {string} [options.dateStr] - YYYY-MM-DD
 * @param {boolean} [options.allowFallback=false] - Allow fallback to top items if no real deals yet
 * @returns {Array<Object>} Scheduled items with post texts
 */
function generateDailySchedule(options = {}) {
  const dateStr = options.dateStr || getCairoDateString();
  const slots = buildCairoScheduleSlots(dateStr);
  const candidates = selectCandidateDeals({
    limit: slots.length,
    maxPerCategory: 2,
    dateStr,
    allowFallback: options.allowFallback !== undefined ? options.allowFallback : true
  });

  if (candidates.length === 0) {
    console.log(`[channel] No candidate deals available to schedule for ${dateStr}.`);
    return [];
  }

  const scheduled = [];
  const insertStmt = db.prepare(`
    INSERT INTO channel_queue (
      asin, slot, scheduled_at, status
    ) VALUES (
      @asin, @slot, @scheduled_at, 'pending'
    )
    ON CONFLICT(asin, slot) DO NOTHING
  `);

  const tx = db.transaction(() => {
    for (let i = 0; i < candidates.length && i < slots.length; i++) {
      const candidate = candidates[i];
      const slotInfo = slots[i];

      insertStmt.run({
        asin: candidate.asin,
        slot: slotInfo.slot,
        scheduled_at: slotInfo.scheduled_at
      });

      const postText = buildPostContent(candidate, slotInfo.slot);

      scheduled.push({
        asin: candidate.asin,
        title: candidate.title,
        category: candidate.category_name,
        slot: slotInfo.slot,
        scheduled_at: slotInfo.scheduled_at,
        imageUrl: candidate.image_url,
        postText
      });
    }
  });

  tx();

  console.log(`[channel] Successfully queued ${scheduled.length} posts for ${dateStr} across Cairo publishing hours.`);
  return scheduled;
}

module.exports = {
  CAIRO_HOURS,
  getCairoDateString,
  buildCairoScheduleSlots,
  categoryToHashtag,
  buildPostContent,
  selectCandidateDeals,
  generateDailySchedule
};
