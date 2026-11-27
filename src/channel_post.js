/**
 * Telegram Channel Post Generator
 * Selects candidate deals from deals_scores (is_real_deal=1, confidence high/medium),
 * enforces category diversity (max 2 per department), checks 7-day cooldown,
 * formats concise Egyptian Arabic posts, and schedules slots across Cairo peak/regular hours.
 */

const path = require('path');
const db = require('./db');
const repo = require('./repo');
const config = require('./config');
const { withAffiliate } = require('./affiliate');
const { validateProductImage } = require('./telegram');

// Cairo publishing hours: 9,11,13,15,17,19,21,23 + peak hours (12, 14, 18, 20, 22) -> 13 slots
const CAIRO_HOURS = [9, 11, 12, 13, 14, 15, 17, 18, 19, 20, 21, 22, 23];

function getCairoPublishingHours() {
  const settings = config.userSettings;
  if (settings && settings.deals_filter && Array.isArray(settings.deals_filter.cairo_publishing_hours) && settings.deals_filter.cairo_publishing_hours.length > 0) {
    return settings.deals_filter.cairo_publishing_hours;
  }
  return CAIRO_HOURS;
}

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
function buildCairoScheduleSlots(dateStr = getCairoDateString(), customHours = null) {
  const hours = customHours || getCairoPublishingHours();
  return hours.map(hour => {
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
 * Build a 2-row Telegram inline keyboard for a channel deal post.
 * Row 1 (full width): Affiliate link to Amazon.eg
 * Row 2 (2 buttons): Deep-link to bot tracking (when bot_username is configured) + info link
 */
function buildInlineKeyboard(product, slot = 'channel', options = {}) {
  const productUrl = product.product_url || product.productUrl || (product.asin ? `https://www.amazon.eg/dp/${product.asin}` : '');
  const affiliateUrl = withAffiliate(productUrl, slot);

  const settings = config.userSettings || {};
  const tgSettings = settings.telegram || {};
  const rawBotUsername = options.botUsername !== undefined
    ? options.botUsername
    : (process.env.TELEGRAM_BOT_USERNAME || tgSettings.bot_username || '');
  const botUsername = String(rawBotUsername).trim().replace(/^@/, '');

  const infoUrl = options.infoUrl || tgSettings.deals_site_url || 'https://t.me/eg_deals_radar';

  const row1 = [
    { text: '🛒 شوفه على أمازون', url: affiliateUrl }
  ];

  const row2 = [];
  if (botUsername && product.asin) {
    row2.push({
      text: '🎯 تتبع العرض',
      url: `https://t.me/${botUsername}?start=track_${product.asin}`
    });
  }
  row2.push({
    text: 'ℹ️ الأسعار ممكن تتغير',
    url: infoUrl
  });

  return {
    inline_keyboard: [row1, row2]
  };
}

/**
 * Format post message content in concise Egyptian Arabic
 *
 * Rules:
 * - No fake exaggeration.
 * - "أرخص سعر" is strictly forbidden UNLESS all_time_low === 1 AND a verified
 *   historical discount exists (i.e. at least 7 days / 5 snapshots of real data).
 * - Amazon's advertised discount is labelled as such and never described as the
 *   product's "usual price".
 */
function buildPostContent(product, slot = 'channel', options = {}) {
  const lines = [];

  const hasVerifiedHistory =
    product.historical_discount_pct !== null && product.historical_discount_pct !== undefined;
  const historicalDiscount = Number(product.historical_discount_pct);

  // 1. Urgency tier header & title line (with optional low-stock badge)
  const isUrgent = hasVerifiedHistory && (
    product.all_time_low === 1 || (!isNaN(historicalDiscount) && historicalDiscount >= 30)
  );
  const urgencyHeader = isUrgent ? '🔥 الحق 🔥' : '⚡ عرض ⚡';
  const title = (product.title || '').trim().replace(/\s+/g, ' ');
  const stockNote = (product.stock_note || product.stockNote || '').trim();
  const stockSuffix = stockNote ? ` (⚠️ ${stockNote})` : '';

  lines.push(urgencyHeader);
  lines.push(`${title}${stockSuffix}`);

  // Optional truthful badge: only when we have verified history AND it is the lowest recorded price.
  // With a single snapshot, all_time_low is trivially true, so it must not be trusted on its own.
  if (product.all_time_low === 1 && hasVerifiedHistory) {
    lines.push(`📉 أرخص سعر اتسجل للمنتج ده!`);
  } else if (!hasVerifiedHistory) {
    lines.push(`🔎 السعر تحت التتبع (بيانات أولية — لسه بنجمع تاريخ السعر 7 أيام)`);
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
  if (hasVerifiedHistory && historicalDiscount > 0) {
    priceLine += ` — أقل من سعره المعتاد ${Math.round(historicalDiscount)}%`;
  }
  lines.push(priceLine);

  // 90-day typical price (median) when available
  const typicalPrice = Number(product.typical_price);
  if (!isNaN(typicalPrice) && typicalPrice > 0) {
    const typicalPriceStr = typicalPrice % 1 === 0 ? typicalPrice.toFixed(0) : typicalPrice.toFixed(2);
    lines.push(`📉 متوسط السعر: ${typicalPriceStr} ج.م`);
  }

  // Unverified discounts are Amazon's own claim: label them explicitly, never as "usual price".
  const advertisedDiscount = Number(product.advertised_discount_pct);
  if (!hasVerifiedHistory && advertisedDiscount > 0) {
    lines.push(`🏷️ خصم معلن من أمازون: ${Math.round(advertisedDiscount)}% (مقارنة بالسعر المعلن)`);
  }

  // 3. Smart Unit price line (only when truly useful and not redundant with total price)
  if (product.unit_price && product.unit_price_unit) {
    const unitPriceNum = Number(product.unit_price);
    const isRedundantSingleUnit = currentPrice > 0 && Math.abs(currentPrice - unitPriceNum) < 1;

    // Only show if it provides real value (e.g. multipack, bulk, or distinct unit price)
    if (!isRedundantSingleUnit || (product.pack_count && product.pack_count > 1)) {
      const unitPriceStr = unitPriceNum % 1 === 0 ? unitPriceNum.toFixed(0) : unitPriceNum.toFixed(1);
      const unitUnit = String(product.unit_price_unit);
      let label = 'الوحدة';
      if (unitUnit.includes('قطعة')) label = 'سعر القطعة';
      else if (unitUnit.includes('حفاضة')) label = 'سعر الحفاضة';
      else if (unitUnit.includes('كيس')) label = 'سعر الكيس';
      else if (unitUnit.includes('لتر')) label = 'سعر اللتر';
      else if (unitUnit.includes('كجم')) label = 'سعر الكيلو';
      else if (unitUnit.includes('جم')) label = 'سعر الـ 100 جم';

      lines.push(`💡 ${label}: ${unitPriceStr} ج.م`);
    }
  }

  // 4. Affiliate link (formatted as clean, high-converting HTML hyperlink)
  const productUrl = product.product_url || product.productUrl || '';
  const affiliateUrl = withAffiliate(productUrl, slot);
  lines.push(`🛒 <b>رابط الشراء:</b> <a href="${affiliateUrl}">اضغط هنا للشراء من أمازون مصر</a>`);

  // 5. Trust & Seller notes (Yousif Ayman style)
  const settings = config.userSettings || {};
  const tgSettings = settings.telegram || {};

  const includeTrust = options.include_trust_notes !== undefined
    ? options.include_trust_notes
    : (tgSettings.include_trust_notes !== undefined ? tgSettings.include_trust_notes : true);

  const includeHub = options.include_hub_links !== undefined
    ? options.include_hub_links
    : (tgSettings.include_hub_links !== undefined ? tgSettings.include_hub_links : true);

  if (includeTrust) {
    lines.push(`🚚 توصيل سريع برايم | البائع: أمازون مصر`);
    lines.push(`⚠️ لو السعر أو البائع اتغير = العرض انتهى`);
  }

  // 6. Hub links for stacked conversions (clean HTML hyperlinks)
  if (includeHub) {
    const hubUrl = withAffiliate('https://www.amazon.eg/b?node=21863836031', `${slot}_hub`);
    lines.push(`══════════════════`);
    lines.push(`» <a href="${hubUrl}">جميع عروض وتخفيضات السوبرماركت اليوم من هنا</a>`);
    lines.push(`» <a href="https://t.me/eg_deals_radar">قناة رادار العروض والتوفير على تليجرام</a>`);
  }

  // 7. Category tag + #إعلان
  const catTag = categoryToHashtag(product.category_name || product.category);
  lines.push(`#${catTag} #عروض_النهاردة #إعلان`);

  return lines.join('\n');
}

/**
 * Hard safety gate for publishing.
 *
 * The project rule: never publish a "deal" before a product has at least
 * 7 days / 5 real snapshots of history. `deals_scores.is_real_deal` is only 1
 * when those thresholds are met, so anything else must never be sent to the
 * channel — regardless of how attractive Amazon's advertised discount looks.
 *
 * A single snapshot makes `all_time_low` trivially true, so it is not a signal.
 */
function isPublishableDeal(item, options = {}) {
  if (!item) return false;

  const confidence = String(item.confidence || '').toLowerCase();
  const hasVerifiedConfidence = confidence === 'high' || confidence === 'medium';

  const hist = item.historical_discount_pct;
  const hasHistoricalDiscount =
    hist !== null && hist !== undefined && Number.isFinite(Number(hist)) && Number(hist) > 0;

  if (item.is_real_deal === 1 && hasVerifiedConfidence && hasHistoricalDiscount) {
    return true;
  }

  // Transitional mode (while collecting 7-day / 5-snapshot history):
  // allow products with a real advertised strike-through discount >= minDiscountPct.
  if (options.allowTransitional) {
    const minDiscountPct = options.minDiscountPct !== undefined ? Number(options.minDiscountPct) : 25;
    const adv = Number(item.advertised_discount_pct);
    const currentPrice = Number(item.current_price !== undefined ? item.current_price : item.price);
    const oldPrice = Number(item.old_price !== undefined ? item.old_price : item.list_price);
    const hasPriceDrop = Number.isFinite(currentPrice) && currentPrice > 0 && Number.isFinite(oldPrice) && oldPrice > currentPrice;
    return Number.isFinite(adv) && adv >= minDiscountPct && hasPriceDrop;
  }

  return false;
}

/**
 * Select candidate deals according to the required business logic:
 * - is_real_deal = 1 and confidence IN ('high', 'medium')
 * - Discount >= minDiscountPct (from config.json deals_filter.min_discount_pct)
 * - Max posts per department (from config.json deals_filter.max_posts_per_category)
 * - Not posted in the last 7 days
 * - Not already queued for this date
 * - Ranked by unit price value and historical discount %
 */
function selectCandidateDeals(options = {}) {
  const settings = config.userSettings || {};
  const dealsFilter = settings.deals_filter || {};

  const minDiscountPct = options.minDiscountPct !== undefined
    ? options.minDiscountPct
    : (dealsFilter.min_discount_pct !== undefined ? dealsFilter.min_discount_pct : 25);

  const maxPerCategory = options.maxPerCategory !== undefined
    ? options.maxPerCategory
    : (dealsFilter.max_posts_per_category !== undefined ? dealsFilter.max_posts_per_category : 2);

  const limit = options.limit !== undefined ? options.limit : 13;
  const dateStr = options.dateStr || getCairoDateString();
  const allowFallback = options.allowFallback !== undefined ? options.allowFallback : false;

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
      s.discount_badge,
      s.stock_note
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

  const getDealDiscount = (d) => {
    if (d.historical_discount_pct !== null && d.historical_discount_pct !== undefined) {
      return d.historical_discount_pct;
    }
    return d.advertised_discount_pct || 0;
  };

  // 3. Filter for real deals with high or medium confidence AND discount >= minDiscountPct
  let eligible = allDeals.filter(d => {
    if (excludedAsins.has(d.asin)) return false;
    if (getDealDiscount(d) < minDiscountPct) return false;
    return d.is_real_deal === 1 && (d.confidence === 'high' || d.confidence === 'medium');
  });

  // Transitional fallback while 7-day history is still being collected (only when 0 verified deals exist)
  if (eligible.length === 0 && (allowFallback || allDeals.length > 0)) {
    console.warn('[channel] Note: No 7-day verified real deals found in catalog.db (insufficient historical snapshots).');
    if (allowFallback) {
      console.warn('[channel] Transitional mode: selecting active products with advertised discount >= ' + minDiscountPct + '% and strike-through price.');
      eligible = allDeals.filter(d => {
        if (excludedAsins.has(d.asin)) return false;
        const adv = Number(d.advertised_discount_pct || 0);
        const cur = Number(d.current_price || 0);
        const old = Number(d.old_price || 0);
        return adv >= minDiscountPct && cur > 0 && old > cur;
      });
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

  // 5. Select items enforcing category diversity: maximum maxPerCategory per department
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
 * Generate and schedule daily posts into channel_queue table.
 * Idempotent: uses INSERT OR IGNORE / ON CONFLICT to avoid duplicate slots.
 *
 * @param {Object} options
 * @param {string} [options.dateStr] - YYYY-MM-DD
 * @param {number} [options.postsPerSlot] - Number of deals scheduled per slot
 * @param {number} [options.minDiscountPct] - Minimum discount threshold %
 * @param {number} [options.maxPerCategory] - Max posts from same category
 * @param {boolean} [options.allowFallback=false] - Allow fallback to top items if no real deals yet
 * @returns {Array<Object>} Scheduled items with post texts
 */
function generateDailySchedule(options = {}) {
  const settings = config.userSettings || {};
  const tgSettings = settings.telegram || {};
  const dealsFilter = settings.deals_filter || {};

  const postsPerSlot = options.postsPerSlot !== undefined
    ? options.postsPerSlot
    : (tgSettings.posts_per_slot !== undefined ? tgSettings.posts_per_slot : 4);

  const maxPerCategory = options.maxPerCategory !== undefined
    ? options.maxPerCategory
    : (dealsFilter.max_posts_per_category !== undefined ? dealsFilter.max_posts_per_category : 2);

  const minDiscountPct = options.minDiscountPct !== undefined
    ? options.minDiscountPct
    : (dealsFilter.min_discount_pct !== undefined ? dealsFilter.min_discount_pct : 25);

  const dateStr = options.dateStr || getCairoDateString();
  const slots = buildCairoScheduleSlots(dateStr);
  const totalSlotsNeeded = slots.length * postsPerSlot;

  const candidates = selectCandidateDeals({
    limit: totalSlotsNeeded,
    maxPerCategory,
    minDiscountPct,
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
    for (let i = 0; i < candidates.length && i < totalSlotsNeeded; i++) {
      const candidate = candidates[i];
      const slotInfo = slots[i % slots.length];

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

  console.log(`[channel] Successfully queued ${scheduled.length} posts for ${dateStr} across Cairo publishing hours (${postsPerSlot} per slot).`);
  return scheduled;
}

module.exports = {
  CAIRO_HOURS,
  getCairoDateString,
  buildCairoScheduleSlots,
  categoryToHashtag,
  buildInlineKeyboard,
  buildPostContent,
  isPublishableDeal,
  selectCandidateDeals,
  generateDailySchedule
};
