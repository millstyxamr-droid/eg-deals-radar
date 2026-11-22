/**
 * Amazon Egypt Tez / Now - Pricing Engine & Historical Deals Analyzer
 * CommonJS, native SQLite / JS math, deterministic percentiles & unit pricing.
 */

const path = require('path');

function getDb() {
  return require('./db');
}

/**
 * Snapshot sources that contain synthetic/demo data.
 * They must NEVER influence deal classification, rankings, confidence,
 * price history exports, or anything published to users.
 * Real sources: 'full_store_scraper', 'price_history.json', 'track_product', ...
 */
const UNTRUSTED_SNAPSHOT_SOURCES = Object.freeze(['seed_history']);

/** SQL fragment usable in any price_snapshots query to keep only trustworthy rows. */
const TRUSTED_SNAPSHOT_SQL = `COALESCE(source, '') NOT IN (${UNTRUSTED_SNAPSHOT_SOURCES
  .map(s => `'${s.replace(/'/g, "''")}'`)
  .join(', ')})`;

function isTrustedSnapshotSource(source) {
  return !UNTRUSTED_SNAPSHOT_SOURCES.includes(source || '');
}

/**
 * Normalizes Arabic and Hindi-Arabic digits and punctuation
 */
function normalizeDigitsAndChars(str) {
  if (!str) return '';
  const arabicDigits = '٠١٢٣٤٥٦٧٨٩';
  return str
    .replace(/[٠-٩]/g, d => arabicDigits.indexOf(d))
    .replace(/[،٫]/g, '.')
    .replace(/[\u064B-\u065F]/g, ''); // strip tashkeel
}

/**
 * Format numbers with Eastern Arabic numerals (e.g. 45.5 -> ٤٥.٥)
 */
function toArabicNumerals(num) {
  if (num === null || num === undefined || isNaN(num)) return '';
  const str = String(num);
  const arabicDigits = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  return str.replace(/\d/g, d => arabicDigits[Number(d)]);
}

// Comprehensive unit lists for bilingual regex
const SOLIDS_UNITS = 'كيلوجرامات|كيلوغرامات|كيلوجرام|كيلوغرام|كيلو|كغم|كجم|كغ|kilograms|kilogram|kilos|kilo|kgs|kg|جرامات|غرامات|جرام|غرام|جم|غ|grams|gram|gms|gm|g';
const LIQUIDS_UNITS = 'مليلتر|مليليتر|لترات|لترا|لتر|litres|litre|liters|liter|l|ملم|ملل|مل|millilitres|millilitre|milliliters|milliliter|mls|ml';
const COUNT_UNITS = 'كبسولات|كبسولة|زجاجات|زجاجة|أكياس|اكياس|أظرف|حبات|أقراص|بكرات|قطعة|قطع|حبة|كيس|ظرف|علبة|علب|قرص|رول|بكرة|capsules|capsule|bottles|bottle|tablets|tablet|sachets|sachet|pieces|piece|items|item|rolls|roll|cans|can|bags|bag|pcs';
const ALL_UNITS = `${SOLIDS_UNITS}|${LIQUIDS_UNITS}|${COUNT_UNITS}`;

// Boundary matching for Arabic and English: matches whitespace, end of string, or non-alphanumeric punctuation
const BOUNDARY = '(?:$|\\s|[^\\u0600-\\u06FFA-Za-z0-9])';

/**
 * Extracts size, weight, pack count and unit from text
 * Supports Arabic, English, multi-packs and single quantities.
 * Returns: { weight_value, weight_unit, pack_count, size_text } or null
 */
function parseSize(title) {
  if (!title || typeof title !== 'string') return null;

  const raw = title.trim();
  const normalized = normalizeDigitsAndChars(raw);

  // 1. Multi-pack patterns like: "6 × 100 جم", "6 x 100g", "6*100 gm", "4 x 250 ml", "6 عبوات × 100 جم", "Pack of 6 x 100g"
  const multiRegex1 = new RegExp(`(\\d+)\\s*(?:[×xX*]|عبوات?|قطع|علب|باكت?|أكياس?|اكياس?|زجاجات?)\\s*(\\d+(?:\\.\\d+)?)\\s*(${ALL_UNITS})${BOUNDARY}`, 'i');
  const matchMulti1 = normalized.match(multiRegex1);
  if (matchMulti1) {
    const packCount = parseInt(matchMulti1[1], 10);
    const weightVal = parseFloat(matchMulti1[2]);
    const rawUnit = matchMulti1[3];
    const unit = canonicalUnit(rawUnit);
    return {
      weight_value: weightVal,
      weight_unit: unit,
      pack_count: packCount,
      size_text: matchMulti1[0].trim()
    };
  }

  // Multi-pack reversed: "100 جم × 6" or "250ml x 4"
  const multiRegex2 = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(${ALL_UNITS})\\s*(?:[×xX*])\\s*(\\d+)`, 'i');
  const matchMulti2 = normalized.match(multiRegex2);
  if (matchMulti2) {
    const weightVal = parseFloat(matchMulti2[1]);
    const rawUnit = matchMulti2[2];
    const packCount = parseInt(matchMulti2[3], 10);
    const unit = canonicalUnit(rawUnit);
    return {
      weight_value: weightVal,
      weight_unit: unit,
      pack_count: packCount,
      size_text: matchMulti2[0].trim()
    };
  }

  // 2. Single quantity weights/volumes: "1 كجم", "500 جم", "1.5 لتر", "750 مل", "250g", "1.5L", "8 Kilograms"
  const singleRegex = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(${ALL_UNITS})${BOUNDARY}`, 'i');
  const matchSingle = normalized.match(singleRegex);
  if (matchSingle) {
    const weightVal = parseFloat(matchSingle[1]);
    const rawUnit = matchSingle[2];
    const unit = canonicalUnit(rawUnit);

    // Check if there is also a pack multiplier nearby, e.g. "Pack of 2" or "عبوة من 2" or "× 2"
    let packCount = 1;
    const packMatch = normalized.match(/(?:pack\s*of|عبوة\s*من|باكت\s*من|[×xX])\s*(\d+)/i);
    if (packMatch) {
      packCount = parseInt(packMatch[1], 10);
    }

    return {
      weight_value: weightVal,
      weight_unit: unit,
      pack_count: packCount,
      size_text: matchSingle[0].trim()
    };
  }

  // 3. Countable items: "12 قطعة", "20 كيس", "24 علبة", "6 زجاجة", "30 قرص", "Pack of 12", "12 pieces"
  const countRegex = new RegExp(`(\\d+)\\s*(${COUNT_UNITS})${BOUNDARY}`, 'i');
  const matchCount = normalized.match(countRegex);
  if (matchCount) {
    const count = parseInt(matchCount[1], 10);
    const rawUnit = matchCount[2];
    const unit = canonicalUnit(rawUnit);
    return {
      weight_value: count,
      weight_unit: unit,
      pack_count: count,
      size_text: matchCount[0].trim()
    };
  }

  // Pack of N without unit: "Pack of 6", "عبوة من 6", "6 Pack"
  const genericPackRegex = /(?:pack\s*of|عبوة\s*من|مجموعة\s*من)\s*(\d+)|(\d+)\s*pack\b/i;
  const matchGenericPack = normalized.match(genericPackRegex);
  if (matchGenericPack) {
    const count = parseInt(matchGenericPack[1] || matchGenericPack[2], 10);
    return {
      weight_value: count,
      weight_unit: 'قطعة',
      pack_count: count,
      size_text: matchGenericPack[0].trim()
    };
  }

  return null;
}

/**
 * Normalizes various unit aliases to standard Arabic representations
 */
function canonicalUnit(rawUnit) {
  if (!rawUnit) return null;
  const u = rawUnit.trim().toLowerCase();

  // Solids
  if (['كجم', 'كغ', 'كيلو', 'كغم', 'كيلوجرام', 'كيلوغرام', 'كيلوجرامات', 'كيلوغرامات', 'kg', 'kgs', 'kilogram', 'kilograms', 'kilo', 'kilos'].includes(u)) {
    return 'كجم';
  }
  if (['جم', 'غ', 'غرام', 'غرامات', 'جرام', 'جرامات', 'g', 'gm', 'gms', 'gram', 'grams'].includes(u)) {
    return 'جم';
  }

  // Liquids
  if (['لتر', 'لترا', 'لترات', 'l', 'liter', 'liters', 'litre', 'litres'].includes(u)) {
    return 'لتر';
  }
  if (['مل', 'ملم', 'ملل', 'مليلتر', 'مليليتر', 'ml', 'mls', 'milli', 'milliliter', 'milliliters', 'millilitre', 'millilitres'].includes(u)) {
    return 'مل';
  }

  // Countables
  if (['قطعة', 'قطع', 'حبة', 'حبات', 'كيس', 'أكياس', 'اكياس', 'ظرف', 'أظرف', 'علبة', 'علب', 'زجاجة', 'زجاجات', 'قرص', 'أقراص', 'كبسولة', 'كبسولات', 'رول', 'بكرة', 'بكرات',
       'piece', 'pieces', 'pcs', 'item', 'items', 'sachet', 'sachets', 'bag', 'bags', 'can', 'cans', 'bottle', 'bottles', 'tablet', 'tablets', 'capsule', 'capsules', 'roll', 'rolls'].includes(u)) {
    return 'قطعة';
  }

  return u;
}

/**
 * Calculate unit price based on weight/volume/count
 * Solids: EGP / kg
 * Liquids: EGP / L
 * Countables: EGP / piece
 */
function calculateUnitPrice(price, sizeInfo) {
  if (price === null || price === undefined || price <= 0 || !sizeInfo) {
    return null;
  }

  const { weight_value, weight_unit, pack_count = 1 } = sizeInfo;
  if (!weight_value || weight_value <= 0) return null;

  const count = pack_count > 0 ? pack_count : 1;
  const u = (weight_unit || '').trim().toLowerCase();

  // Solids -> EGP/kg
  if (['كجم', 'kg', 'كيلو'].includes(u)) {
    const totalKg = weight_value * count;
    if (totalKg <= 0) return null;
    return {
      unit_price: +(price / totalKg).toFixed(2),
      unit_price_unit: 'ج.م/كجم',
      canonical_unit: 'EGP/kg'
    };
  }

  if (['جم', 'غ', 'جرام', 'غرام', 'g', 'gm'].includes(u)) {
    const totalKg = (weight_value / 1000) * count;
    if (totalKg <= 0) return null;
    return {
      unit_price: +(price / totalKg).toFixed(2),
      unit_price_unit: 'ج.م/كجم',
      canonical_unit: 'EGP/kg'
    };
  }

  // Liquids -> EGP/L
  if (['لتر', 'l', 'liter'].includes(u)) {
    const totalLiters = weight_value * count;
    if (totalLiters <= 0) return null;
    return {
      unit_price: +(price / totalLiters).toFixed(2),
      unit_price_unit: 'ج.م/لتر',
      canonical_unit: 'EGP/L'
    };
  }

  if (['مل', 'ملم', 'ml'].includes(u)) {
    const totalLiters = (weight_value / 1000) * count;
    if (totalLiters <= 0) return null;
    return {
      unit_price: +(price / totalLiters).toFixed(2),
      unit_price_unit: 'ج.م/لتر',
      canonical_unit: 'EGP/L'
    };
  }

  // Countables -> EGP/piece
  if (['قطعة', 'piece', 'pcs', 'حبة', 'كيس', 'علبة', 'زجاجة', 'قرص'].includes(u)) {
    const totalPieces = count > 1 ? count : weight_value;
    if (totalPieces <= 0) return null;
    return {
      unit_price: +(price / totalPieces).toFixed(2),
      unit_price_unit: 'ج.م/قطعة',
      canonical_unit: 'EGP/piece'
    };
  }

  return null;
}

/**
 * Format unit price in Arabic with Eastern Arabic numerals: e.g. "٤٥.٥ ج.م/كجم"
 * If unit_price is null or unknown: returns "—" (no guessing).
 */
function formatUnitPrice(unitPrice, unitPriceUnit, options = {}) {
  if (unitPrice === null || unitPrice === undefined || isNaN(unitPrice) || unitPrice <= 0 || !unitPriceUnit) {
    return '—';
  }

  const { arabicDigits = true } = options;
  const numStr = Number(unitPrice).toFixed(unitPrice % 1 === 0 ? 0 : 1);
  const formattedNum = arabicDigits ? toArabicNumerals(numStr) : numStr;

  return `${formattedNum} ${unitPriceUnit}`;
}

/**
 * Deterministic percentile calculation (Linear interpolation on sorted array)
 */
function calculatePercentile(sortedPrices, p) {
  if (!sortedPrices || sortedPrices.length === 0) return null;
  const n = sortedPrices.length;
  if (n === 1) return sortedPrices[0];

  const k = (p / 100) * (n - 1);
  const floor = Math.floor(k);
  const ceil = Math.ceil(k);

  if (floor === ceil) {
    return sortedPrices[floor];
  }

  const alpha = k - floor;
  const val = sortedPrices[floor] + alpha * (sortedPrices[ceil] - sortedPrices[floor]);
  return Number(val.toFixed(2));
}

/**
 * Computes price statistics for an ASIN within the last N days (or all time)
 * Returns: { count, min, max, p10, p30, median, p50, p90, last_price, days_observed }
 */
function getPriceStats(asin, days = null, dbInstance = null) {
  const activeDb = dbInstance || getDb();
  let query = `
    SELECT price, scraped_at
    FROM price_snapshots
    WHERE asin = ? AND price IS NOT NULL AND price > 0
      AND ${TRUSTED_SNAPSHOT_SQL}
  `;
  const params = [asin];

  if (days && Number.isInteger(days)) {
    query += ` AND scraped_at >= datetime('now', '-' || ? || ' days')`;
    params.push(days);
  }

  query += ` ORDER BY scraped_at ASC, id ASC`;

  const rows = activeDb.prepare(query).all(...params);

  if (!rows || rows.length === 0) {
    return {
      count: 0,
      min: null,
      max: null,
      p10: null,
      p30: null,
      median: null,
      p50: null,
      p90: null,
      last_price: null,
      days_observed: 0
    };
  }

  const sortedPrices = rows.map(r => r.price).sort((a, b) => a - b);
  const distinctDays = new Set(rows.map(r => (r.scraped_at ? r.scraped_at.slice(0, 10) : ''))).size;

  const min = sortedPrices[0];
  const max = sortedPrices[sortedPrices.length - 1];
  const p10 = calculatePercentile(sortedPrices, 10);
  const p30 = calculatePercentile(sortedPrices, 30);
  const median = calculatePercentile(sortedPrices, 50);
  const p90 = calculatePercentile(sortedPrices, 90);
  const lastPrice = rows[rows.length - 1].price;

  return {
    count: sortedPrices.length,
    min,
    max,
    p10,
    p30,
    median,
    p50: median,
    p90,
    last_price: lastPrice,
    days_observed: distinctDays
  };
}

/**
 * Classifies a deal according to strict historical rules
 * fair_price = p30 (90-day window)
 * typical_price = median (90-day window)
 * historical_discount_pct = round((typical_price - price) / typical_price * 100)
 * is_real_deal = price <= fair_price AND price < typical_price * 0.95 AND days_observed >= 7 AND count >= 5
 * confidence: 'high' if days_observed>=30 & count>=20, 'medium' if >=7/5, 'low' otherwise
 * all_time_low = price <= min (all time)
 */
function classifyDeal({ price, oldPriceNum = null, stats90, statsAllTime }) {
  if (price === null || price === undefined || !stats90) {
    return {
      fair_price: null,
      typical_price: null,
      historical_discount_pct: null,
      advertised_discount_pct: 0,
      is_real_deal: false,
      confidence: 'low',
      all_time_low: false,
      display_discount: 'لسه بنجمع بيانات'
    };
  }

  const fairPrice = stats90.p30;
  const typicalPrice = stats90.median;

  // Advertised discount from Amazon strike-through price (stored as context only)
  let advertisedDiscountPct = 0;
  if (oldPriceNum && oldPriceNum > price) {
    advertisedDiscountPct = Math.round(((oldPriceNum - price) / oldPriceNum) * 100);
  }

  // Determine confidence
  let confidence = 'low';
  if (stats90.days_observed >= 30 && stats90.count >= 20) {
    confidence = 'high';
  } else if (stats90.days_observed >= 7 && stats90.count >= 5) {
    confidence = 'medium';
  } else {
    confidence = 'low';
  }

  // All-time low
  const allTimeMin = statsAllTime ? statsAllTime.min : stats90.min;
  const allTimeLow = Boolean(allTimeMin !== null && price <= allTimeMin);

  // If new product (no history / low confidence): do not calculate misleading historical discount
  if (confidence === 'low' || typicalPrice === null || typicalPrice <= 0) {
    return {
      fair_price: fairPrice,
      typical_price: typicalPrice,
      historical_discount_pct: null,
      advertised_discount_pct: advertisedDiscountPct,
      is_real_deal: false,
      confidence: 'low',
      all_time_low: allTimeLow,
      display_discount: 'لسه بنجمع بيانات'
    };
  }

  // Historical discount percentage relative to typical price
  const historicalDiscountPct = Math.round(((typicalPrice - price) / typicalPrice) * 100);

  // is_real_deal condition
  const isRealDeal = Boolean(
    price <= fairPrice &&
    price < (typicalPrice * 0.95) &&
    stats90.days_observed >= 7 &&
    stats90.count >= 5
  );

  let displayDiscount = 'سعر عادي';
  if (isRealDeal && historicalDiscountPct > 0) {
    displayDiscount = `${historicalDiscountPct}% خصم حقيقي`;
  } else if (historicalDiscountPct > 0) {
    displayDiscount = `${historicalDiscountPct}% أقل من المعتاد`;
  }

  return {
    fair_price: fairPrice,
    typical_price: typicalPrice,
    historical_discount_pct: historicalDiscountPct,
    advertised_discount_pct: advertisedDiscountPct,
    is_real_deal: isRealDeal,
    confidence,
    all_time_low: allTimeLow,
    display_discount: displayDiscount
  };
}

/**
 * Calculates price index (unit_price / category_median_unit_price)
 * For each (category_id + unit_price_unit), calculates median unit price
 */
function calculatePriceIndices(products) {
  const groups = {};

  products.forEach(p => {
    if (p.unit_price && p.unit_price > 0 && p.unit_price_unit) {
      const key = `${p.category_id || p.category || 'other'}_${p.unit_price_unit}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(p.unit_price);
    }
  });

  const medians = {};
  for (const [key, prices] of Object.entries(groups)) {
    prices.sort((a, b) => a - b);
    medians[key] = calculatePercentile(prices, 50);
  }

  return products.map(p => {
    if (p.unit_price && p.unit_price > 0 && p.unit_price_unit) {
      const key = `${p.category_id || p.category || 'other'}_${p.unit_price_unit}`;
      const median = medians[key];
      const priceIndex = median && median > 0 ? +(p.unit_price / median).toFixed(2) : null;
      return { ...p, price_index: priceIndex };
    }
    return { ...p, price_index: null };
  });
}

/**
 * Audit unit price calculation across all products
 */
function auditUnitPrices(options = {}) {
  const dbInstance = options.db || getDb();
  const products = dbInstance.prepare(`
    SELECT asin, title, weight_value, weight_unit, pack_count, unit_price, unit_price_unit,
      (SELECT price FROM price_snapshots WHERE asin = products.asin AND ${TRUSTED_SNAPSHOT_SQL} ORDER BY scraped_at DESC LIMIT 1) AS currentPriceNum
    FROM products
  `).all();

  let succeeded = 0;
  let failed = 0;
  const failures = {
    regex_miss: [],
    missing_price: [],
    unknown_unit: []
  };

  const results = [];

  for (const p of products) {
    let sizeInfo = null;
    if (p.weight_value && p.weight_unit) {
      sizeInfo = {
        weight_value: p.weight_value,
        weight_unit: p.weight_unit,
        pack_count: p.pack_count || 1
      };
    } else {
      sizeInfo = parseSize(p.title);
    }

    if (!sizeInfo) {
      failed++;
      failures.regex_miss.push({ asin: p.asin, title: p.title });
      results.push({ asin: p.asin, title: p.title, status: 'fail', reason: 'regex_miss' });
      continue;
    }

    if (!p.currentPriceNum) {
      failed++;
      failures.missing_price.push({ asin: p.asin, title: p.title });
      results.push({ asin: p.asin, title: p.title, status: 'fail', reason: 'missing_price' });
      continue;
    }

    const unitPriceCalc = calculateUnitPrice(p.currentPriceNum, sizeInfo);
    if (unitPriceCalc) {
      succeeded++;
      results.push({
        asin: p.asin,
        title: p.title,
        status: 'ok',
        sizeInfo,
        unit_price: unitPriceCalc.unit_price,
        unit_price_unit: unitPriceCalc.unit_price_unit,
        formatted: formatUnitPrice(unitPriceCalc.unit_price, unitPriceCalc.unit_price_unit)
      });
    } else {
      failed++;
      failures.unknown_unit.push({ asin: p.asin, title: p.title, unit: sizeInfo.weight_unit });
      results.push({ asin: p.asin, title: p.title, status: 'fail', reason: 'unknown_unit' });
    }
  }

  const total = products.length;
  const successRate = total > 0 ? ((succeeded / total) * 100).toFixed(1) : 0;

  console.log('\n===============================================================');
  console.log('       🔍 تقرير تدقيق أسعار الوحدة (Unit Price Audit)           ');
  console.log('===============================================================');
  console.log(`📦 إجمالي المنتجات المفحوصة: ${total}`);
  console.log(`✅ تم حساب سعر الوحدة بنجاح: ${succeeded} (${successRate}%)`);
  console.log(`❌ تعذر الحساب: ${failed} (${(100 - successRate).toFixed(1)}%)`);
  console.log('---------------------------------------------------------------');
  console.log('تفاصيل أسباب التعذر:');
  console.log(`  • عدم التعرف على الحجم في العنوان (regex miss): ${failures.regex_miss.length}`);
  console.log(`  • عدم توفر سعر حالي للمنتج (missing price): ${failures.missing_price.length}`);
  console.log(`  • وحدة غير مدعومة (unknown unit): ${failures.unknown_unit.length}`);

  if (failures.regex_miss.length > 0) {
    console.log('---------------------------------------------------------------');
    console.log('عينة من العناوين التي تحتاج تحسين أنماط الـ Regex (أول 5):');
    failures.regex_miss.slice(0, 5).forEach((item, idx) => {
      console.log(`  ${idx + 1}. [${item.asin}] ${item.title}`);
    });
  }
  console.log('===============================================================\n');

  return {
    total,
    succeeded,
    failed,
    successRate: Number(successRate),
    failures,
    results
  };
}

// CLI handler for --unit-price-audit
if (require.main === module) {
  if (process.argv.includes('--unit-price-audit')) {
    auditUnitPrices();
  } else {
    console.log('Pricing engine module loaded. Use --unit-price-audit to run audit.');
  }
}

module.exports = {
  parseSize,
  canonicalUnit,
  calculateUnitPrice,
  formatUnitPrice,
  toArabicNumerals,
  calculatePercentile,
  getPriceStats,
  classifyDeal,
  calculatePriceIndices,
  auditUnitPrices,
  UNTRUSTED_SNAPSHOT_SOURCES,
  TRUSTED_SNAPSHOT_SQL,
  isTrustedSnapshotSource
};
