/**
 * Amazon Egypt Tez / Now - Brand Competitive Intelligence Report Queries
 * Computes all analytics, competitor comparisons, stock history, and promotional metrics in SQL/JS.
 * Strictly adheres to: deterministic math, CommonJS, native SQLite / better-sqlite3.
 */

const path = require('path');
const db = require('./db');
const { getPriceStats, calculatePercentile } = require('./pricing');
const { extractBrand, normalizeTitle } = require('./normalize');

/**
 * Normalizes brand name search pattern and canonical name
 */
function resolveBrand(brandQuery, dbInstance = db) {
  if (!brandQuery || typeof brandQuery !== 'string') {
    return { canonical: 'Domty', query: 'domty' };
  }
  const clean = brandQuery.trim();
  return { canonical: clean, query: clean.toLowerCase() };
}

/**
 * Returns matching related category IDs (e.g. dairy-cheese and cheese-dairy)
 */
function getRelatedCategoryIds(catId) {
  if (!catId) return [];
  const id = catId.toLowerCase();
  if (['dairy-cheese', 'cheese-dairy', 'cheese'].includes(id)) {
    return ['dairy-cheese', 'cheese-dairy', 'cheese', 'dairy-eggs'];
  }
  if (['dairy-milk', 'milk'].includes(id)) {
    return ['dairy-milk', 'milk', 'dairy-eggs'];
  }
  if (['dairy-yogurt', 'yogurt'].includes(id)) {
    return ['dairy-yogurt', 'yogurt', 'dairy-cream', 'dairy-eggs'];
  }
  if (['bakery', 'bread'].includes(id)) {
    return ['bakery', 'bread'];
  }
  return [catId];
}

/**
 * Fetches all necessary data and computes metrics for a single brand report
 * @param {string} brandName - e.g. "Domty" or "Juhayna"
 * @param {object} options - { days: 30, dbInstance: db, generatedAt: new Date() }
 */
function getBrandReportData(brandName, options = {}) {
  const dbInstance = options.dbInstance || db;
  const days = parseInt(options.days, 10) || 30;
  const generatedAt = options.generatedAt || new Date().toISOString();
  const { canonical, query } = resolveBrand(brandName, dbInstance);

  // 1. Fetch brand products
  const brandProductsQuery = `
    SELECT 
      p.asin, p.title, p.title_norm, p.brand, p.category_id,
      p.weight_value, p.weight_unit, p.pack_count, p.size_text,
      p.unit_price, p.unit_price_unit, p.product_url, p.image_url,
      c.name as category_name, c.name_ar as category_name_ar,
      (
        SELECT price FROM price_snapshots 
        WHERE asin = p.asin AND price IS NOT NULL AND price > 0 
        ORDER BY scraped_at DESC LIMIT 1
      ) as current_price,
      (
        SELECT list_price FROM price_snapshots 
        WHERE asin = p.asin AND list_price IS NOT NULL AND list_price > 0 
        ORDER BY scraped_at DESC LIMIT 1
      ) as list_price,
      (
        SELECT in_stock FROM price_snapshots 
        WHERE asin = p.asin 
        ORDER BY scraped_at DESC LIMIT 1
      ) as current_in_stock
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE lower(p.brand) = lower(?)
       OR (p.brand IS NULL AND lower(p.title) LIKE '%' || lower(?) || '%')
    ORDER BY p.title ASC
  `;

  const brandProducts = dbInstance.prepare(brandProductsQuery).all(query, query);
  const productCount = brandProducts.length;

  // 2. Fetch snapshot period information
  const brandAsinList = brandProducts.map(p => `'${p.asin}'`).join(',');
  let daysObserved = 0;
  let minDate = null;
  let maxDate = null;
  let totalSnapshotsCount = 0;

  if (productCount > 0) {
    const snapMeta = dbInstance.prepare(`
      SELECT 
        count(*) as count,
        count(distinct substr(scraped_at, 1, 10)) as days_observed,
        min(scraped_at) as min_date,
        max(scraped_at) as max_date
      FROM price_snapshots
      WHERE asin IN (${brandAsinList})
        AND scraped_at >= datetime('now', '-' || ? || ' days')
    `).get(days);

    daysObserved = snapMeta ? snapMeta.days_observed : 0;
    minDate = snapMeta ? snapMeta.min_date : null;
    maxDate = snapMeta ? snapMeta.max_date : null;
    totalSnapshotsCount = snapMeta ? snapMeta.count : 0;
  }

  // 3. Insufficient data check (<10 products OR <7 days)
  const isInsufficientData = (productCount < 10 || daysObserved < 7);
  const warningMessage = isInsufficientData
    ? `بيانات غير كافية لبراند "${canonical}": تم رصد ${productCount} منتج و ${daysObserved} أيام مراقبة خلال نافذة ${days} يوماً (الحد الأدنى المطلوب للتقرير: 10 منتجات و 7 أيام مراقبة) لتفادي أرقام مضللة.`
    : null;

  // 4. Category statistics for market comparison
  const brandCategoryIds = Array.from(new Set(brandProducts.map(p => p.category_id).filter(Boolean)));
  
  // Calculate category medians for all products in those categories
  const categoryMedians = {};
  const categoryUnitMedians = {}; // by "category_id|unit"
  
  if (brandCategoryIds.length > 0) {
    const catPlaceholders = brandCategoryIds.map(() => '?').join(',');
    const allCatProducts = dbInstance.prepare(`
      SELECT 
        p.asin, p.category_id, p.unit_price, p.unit_price_unit,
        (SELECT price FROM price_snapshots WHERE asin = p.asin AND price IS NOT NULL AND price > 0 ORDER BY scraped_at DESC LIMIT 1) as price
      FROM products p
      WHERE p.category_id IN (${catPlaceholders})
    `).all(...brandCategoryIds);

    const catPrices = {};
    const catUnitPrices = {};

    for (const p of allCatProducts) {
      if (p.price && p.price > 0) {
        if (!catPrices[p.category_id]) catPrices[p.category_id] = [];
        catPrices[p.category_id].push(p.price);
      }
      if (p.unit_price && p.unit_price > 0 && p.unit_price_unit) {
        const key = `${p.category_id}|${p.unit_price_unit}`;
        if (!catUnitPrices[key]) catUnitPrices[key] = [];
        catUnitPrices[key].push(p.unit_price);
      }
    }

    for (const catId of Object.keys(catPrices)) {
      catPrices[catId].sort((a, b) => a - b);
      categoryMedians[catId] = calculatePercentile(catPrices[catId], 50);
    }
    for (const key of Object.keys(catUnitPrices)) {
      catUnitPrices[key].sort((a, b) => a - b);
      categoryUnitMedians[key] = calculatePercentile(catUnitPrices[key], 50);
    }
  }

  // 5. Competitor pricing comparison table & Nearest 3 Competitors per brand product
  // Criteria: same category + same size +-20% (with strict size indicator)
  const competitorTable = [];
  let maxPriceDiffEvent = null; // { brandProduct, competitorProduct, diffEgp, diffPct }
  let productsAboveMedianCount = 0;
  let totalComparedAboveMedian = 0;

  for (const prod of brandProducts) {
    const brandPrice = prod.current_price;
    const catId = prod.category_id;
    const catMedian = catId ? categoryMedians[catId] : null;

    if (brandPrice && catMedian) {
      totalComparedAboveMedian++;
      if (brandPrice > catMedian) {
        productsAboveMedianCount++;
      }
    }

    // Query candidate competitors in same or related category
    let competitors = [];
    if (catId) {
      const relatedCats = getRelatedCategoryIds(catId);
      const catPlaceholders = relatedCats.map(() => '?').join(',');

      const candidateCompetitors = dbInstance.prepare(`
        SELECT 
          p.asin, p.title, p.brand, p.category_id,
          p.weight_value, p.weight_unit, p.pack_count, p.size_text,
          p.unit_price, p.unit_price_unit,
          (
            SELECT price FROM price_snapshots 
            WHERE asin = p.asin AND price IS NOT NULL AND price > 0 
            ORDER BY scraped_at DESC LIMIT 1
          ) as price
        FROM products p
        WHERE (p.brand IS NULL OR lower(p.brand) != lower(?))
          AND p.category_id IN (${catPlaceholders})
          AND (SELECT price FROM price_snapshots WHERE asin = p.asin AND price IS NOT NULL AND price > 0 ORDER BY scraped_at DESC LIMIT 1) IS NOT NULL
        ORDER BY p.title ASC
      `).all(canonical, ...relatedCats);

      const prodWeight = prod.weight_value;
      const prodUnit = prod.weight_unit;

      const strictMatches = [];
      const categoryMatches = [];

      for (const comp of candidateCompetitors) {
        if (!comp.price || comp.price <= 0) continue;

        let isStrictSizeMatch = false;
        let sizeDiffRatio = 0;

        if (prodWeight && prodUnit && comp.weight_value && comp.weight_unit) {
          const isSameUnit = (prodUnit === comp.weight_unit) ||
            (['كجم', 'جم'].includes(prodUnit) && ['كجم', 'جم'].includes(comp.weight_unit)) ||
            (['لتر', 'مل'].includes(prodUnit) && ['لتر', 'مل'].includes(comp.weight_unit));

          if (isSameUnit) {
            let w1 = prodWeight;
            if (prodUnit === 'كجم' || prodUnit === 'kg') w1 *= 1000;
            if (prodUnit === 'لتر' || prodUnit === 'l') w1 *= 1000;

            let w2 = comp.weight_value;
            if (comp.weight_unit === 'كجم' || comp.weight_unit === 'kg') w2 *= 1000;
            if (comp.weight_unit === 'لتر' || comp.weight_unit === 'l') w2 *= 1000;

            if (w1 > 0 && w2 >= w1 * 0.8 && w2 <= w1 * 1.2) {
              isStrictSizeMatch = true;
              sizeDiffRatio = Math.abs(w2 - w1) / w1;
            }
          }
        }

        const diffEgp = brandPrice ? +(brandPrice - comp.price).toFixed(2) : null;
        const diffPct = brandPrice && comp.price ? +(((brandPrice - comp.price) / comp.price) * 100).toFixed(1) : null;
        let cheaper = 'متساويان';
        if (brandPrice && comp.price) {
          if (brandPrice < comp.price) {
            cheaper = `${canonical} أرخص`;
          } else if (brandPrice > comp.price) {
            cheaper = `${comp.brand || 'المنافس'} أرخص`;
          }
        }

        const compObj = {
          asin: comp.asin,
          title: comp.title,
          brand: comp.brand || 'غير محدد',
          price: comp.price,
          unit_price: comp.unit_price,
          unit_price_unit: comp.unit_price_unit,
          size_text: comp.size_text || (comp.weight_value ? `${comp.weight_value} ${comp.weight_unit || ''}` : '—'),
          is_strict_size_match: isStrictSizeMatch,
          sizeDiffRatio,
          diffEgp,
          diffPct,
          cheaper
        };

        if (isStrictSizeMatch) {
          strictMatches.push(compObj);
        } else {
          categoryMatches.push(compObj);
        }
      }

      // Sort matches: strict size matches first, then category proximity
      strictMatches.sort((a, b) => a.sizeDiffRatio - b.sizeDiffRatio || Math.abs(a.diffEgp || 0) - Math.abs(b.diffEgp || 0));
      categoryMatches.sort((a, b) => Math.abs((a.diffEgp || 0)) - Math.abs((b.diffEgp || 0)));

      // If strict matches available, prefer them; otherwise provide closest category matches
      const combined = strictMatches.length > 0 ? strictMatches : categoryMatches;
      competitors = combined.slice(0, 3);

      // Track max price difference among strict size matches (or closest category matches if no strict match)
      for (const comp of competitors) {
        if (comp.diffEgp !== null && (!maxPriceDiffEvent || Math.abs(comp.diffEgp) > Math.abs(maxPriceDiffEvent.diffEgp))) {
          maxPriceDiffEvent = {
            brandProduct: prod.title,
            brandPrice: brandPrice,
            competitorProduct: comp.title,
            competitorBrand: comp.brand || 'المنافس',
            competitorPrice: comp.price,
            diffEgp: comp.diffEgp,
            diffPct: comp.diffPct,
            cheaper: comp.cheaper,
            isStrictSizeMatch: comp.is_strict_size_match
          };
        }
      }
    }

    // Price index for this product
    const unitKey = prod.category_id && prod.unit_price_unit ? `${prod.category_id}|${prod.unit_price_unit}` : null;
    const catUnitMedian = unitKey ? categoryUnitMedians[unitKey] : null;
    const priceIndex = (prod.unit_price && catUnitMedian && catUnitMedian > 0)
      ? +(prod.unit_price / catUnitMedian).toFixed(2)
      : null;

    competitorTable.push({
      asin: prod.asin,
      title: prod.title,
      category_id: prod.category_id,
      category_name: prod.category_name_ar || prod.category_name || prod.category_id,
      current_price: brandPrice,
      unit_price: prod.unit_price,
      unit_price_unit: prod.unit_price_unit,
      size_text: prod.size_text || (prod.weight_value ? `${prod.weight_value} ${prod.weight_unit || ''}` : '—'),
      price_index: priceIndex,
      competitors,
      has_competitors: competitors.length > 0
    });
  }

  // 6. Unit Price comparison: Brand Average vs Market Average
  const brandUnitPricesKg = brandProducts.filter(p => p.unit_price && p.unit_price_unit === 'ج.م/كجم').map(p => p.unit_price);
  const brandUnitPricesLtr = brandProducts.filter(p => p.unit_price && p.unit_price_unit === 'ج.م/لتر').map(p => p.unit_price);
  const brandUnitPricesPcs = brandProducts.filter(p => p.unit_price && p.unit_price_unit === 'ج.م/قطعة').map(p => p.unit_price);

  let brandAvgUnitPrice = null;
  let marketAvgUnitPrice = null;
  let unitComparisonLabel = 'ج.م/كجم';
  let unitPriceDiffPct = null;

  if (brandUnitPricesKg.length > 0) {
    brandAvgUnitPrice = +(brandUnitPricesKg.reduce((a, b) => a + b, 0) / brandUnitPricesKg.length).toFixed(2);
    unitComparisonLabel = 'ج.م/كجم';
    const catPlaceholders = brandCategoryIds.map(() => '?').join(',');
    const marketKgRows = dbInstance.prepare(`
      SELECT unit_price FROM products 
      WHERE category_id IN (${catPlaceholders}) AND unit_price_unit = 'ج.م/كجم' AND unit_price > 0
    `).all(...brandCategoryIds);
    if (marketKgRows.length > 0) {
      marketAvgUnitPrice = +(marketKgRows.reduce((a, b) => a + b.unit_price, 0) / marketKgRows.length).toFixed(2);
      unitPriceDiffPct = +(((brandAvgUnitPrice - marketAvgUnitPrice) / marketAvgUnitPrice) * 100).toFixed(1);
    }
  } else if (brandUnitPricesPcs.length > 0) {
    brandAvgUnitPrice = +(brandUnitPricesPcs.reduce((a, b) => a + b, 0) / brandUnitPricesPcs.length).toFixed(2);
    unitComparisonLabel = 'ج.م/قطعة';
    const catPlaceholders = brandCategoryIds.map(() => '?').join(',');
    const marketPcsRows = dbInstance.prepare(`
      SELECT unit_price FROM products 
      WHERE category_id IN (${catPlaceholders}) AND unit_price_unit = 'ج.م/قطعة' AND unit_price > 0
    `).all(...brandCategoryIds);
    if (marketPcsRows.length > 0) {
      marketAvgUnitPrice = +(marketPcsRows.reduce((a, b) => a + b.unit_price, 0) / marketPcsRows.length).toFixed(2);
      unitPriceDiffPct = +(((brandAvgUnitPrice - marketAvgUnitPrice) / marketAvgUnitPrice) * 100).toFixed(1);
    }
  }

  // 7. Out of Stock Analysis (نفاد المخزون)
  let outOfStockList = [];
  let totalOosEvents = 0;
  if (productCount > 0) {
    outOfStockList = dbInstance.prepare(`
      SELECT 
        p.asin, p.title,
        count(s.id) as total_snapshots,
        sum(case when s.in_stock = 0 then 1 else 0 end) as oos_snapshots,
        max(case when s.in_stock = 1 then s.scraped_at else null end) as last_seen_in_stock
      FROM products p
      JOIN price_snapshots s ON p.asin = s.asin
      WHERE (lower(p.brand) = lower(?) OR (p.brand IS NULL AND lower(p.title) LIKE '%' || lower(?) || '%'))
        AND s.scraped_at >= datetime('now', '-' || ? || ' days')
      GROUP BY p.asin
      HAVING oos_snapshots > 0
      ORDER BY oos_snapshots DESC, (oos_snapshots * 1.0 / total_snapshots) DESC
    `).all(query, query, days).map(item => {
      const unavailablePct = +((item.oos_snapshots / item.total_snapshots) * 100).toFixed(1);
      totalOosEvents += item.oos_snapshots;
      return {
        asin: item.asin,
        title: item.title,
        total_snapshots: item.total_snapshots,
        oos_snapshots: item.oos_snapshots,
        unavailable_pct: unavailablePct,
        last_seen_in_stock: item.last_seen_in_stock ? item.last_seen_in_stock.replace('T', ' ').slice(0, 16) : 'لم ترصد متاحة'
      };
    });
  }

  // 8. Promotions Analysis in last 30 days (عروض آخر 30 يوم)
  let p30DropCount = 0;
  let deepestDiscountPct = 0;
  const promoSpells = [];
  const brandPromoDates = new Set();

  for (const prod of brandProducts) {
    const stats = getPriceStats(prod.asin, 90, dbInstance);
    if (!stats || !stats.p30 || stats.count < 2) continue;

    const snapshots = dbInstance.prepare(`
      SELECT price, list_price, scraped_at 
      FROM price_snapshots 
      WHERE asin = ? AND price IS NOT NULL AND scraped_at >= datetime('now', '-' || ? || ' days')
      ORDER BY scraped_at ASC
    `).all(prod.asin, days);

    let inSpell = false;
    let spellStart = null;
    let spellMinPrice = null;

    for (let i = 0; i < snapshots.length; i++) {
      const snap = snapshots[i];
      const isDrop = snap.price < stats.p30;

      if (isDrop) {
        p30DropCount++;
        const dateStr = snap.scraped_at.slice(0, 10);
        brandPromoDates.add(dateStr);

        const typical = stats.median || stats.p30;
        const discountPct = typical > 0 ? Math.round(((typical - snap.price) / typical) * 100) : 0;
        if (discountPct > deepestDiscountPct) {
          deepestDiscountPct = discountPct;
        }

        if (!inSpell) {
          inSpell = true;
          spellStart = new Date(snap.scraped_at);
          spellMinPrice = snap.price;
        } else {
          spellMinPrice = Math.min(spellMinPrice, snap.price);
        }
      } else {
        if (inSpell) {
          const spellEnd = new Date(snap.scraped_at);
          const durationDays = Math.max(1, (spellEnd - spellStart) / (1000 * 60 * 60 * 24));
          promoSpells.push(durationDays);
          inSpell = false;
        }
      }
    }

    if (inSpell && snapshots.length > 0) {
      const lastSnap = snapshots[snapshots.length - 1];
      const durationDays = Math.max(1, (new Date(lastSnap.scraped_at) - spellStart) / (1000 * 60 * 60 * 24));
      promoSpells.push(durationDays);
    }
  }

  const avgPromoDurationDays = promoSpells.length > 0
    ? +(promoSpells.reduce((a, b) => a + b, 0) / promoSpells.length).toFixed(1)
    : 0;

  // Check competitor promotion synchronicity
  let competitorPromoDaysCount = 0;
  let synchronizedPromoDaysCount = 0;

  if (brandCategoryIds.length > 0 && brandPromoDates.size > 0) {
    const catPlaceholders = brandCategoryIds.map(() => '?').join(',');
    const compDrops = dbInstance.prepare(`
      SELECT distinct substr(s.scraped_at, 1, 10) as dt
      FROM price_snapshots s
      JOIN products p ON s.asin = p.asin
      WHERE (p.brand IS NULL OR lower(p.brand) != lower(?))
        AND p.category_id IN (${catPlaceholders})
        AND s.scraped_at >= datetime('now', '-' || ? || ' days')
        AND s.list_price > s.price
    `).all(canonical, ...brandCategoryIds, days);

    const compDates = new Set(compDrops.map(c => c.dt));
    competitorPromoDaysCount = compDates.size;

    for (const bDate of brandPromoDates) {
      if (compDates.has(bDate)) {
        synchronizedPromoDaysCount++;
      }
    }
  }

  const promoSyncRatePct = brandPromoDates.size > 0
    ? +((synchronizedPromoDaysCount / brandPromoDates.size) * 100).toFixed(1)
    : 0;

  let promoSyncStatus = 'لا توجد عروض كافية للمقارنة';
  if (brandPromoDates.size > 0) {
    if (promoSyncRatePct >= 50) {
      promoSyncStatus = `متزامنة بنسبة ${promoSyncRatePct}% مع عروض المنافسين في نفس الفئات`;
    } else if (promoSyncRatePct >= 20) {
      promoSyncStatus = `متزامنة جزئياً (${promoSyncRatePct}%) مع عروض المنافسين`;
    } else {
      promoSyncStatus = `عروض مستقلة (${promoSyncRatePct}% تزامن مع المنافسين)`;
    }
  }

  // 9. Price Index Data & SVG Chart Data (مؤشر السعر)
  const priceIndexItems = competitorTable
    .filter(p => p.price_index !== null)
    .sort((a, b) => a.price_index - b.price_index);

  const priceIndexValues = priceIndexItems.map(p => p.price_index);
  const avgPriceIndex = priceIndexValues.length > 0
    ? +(priceIndexValues.reduce((a, b) => a + b, 0) / priceIndexValues.length).toFixed(2)
    : null;

  const svgChart = generatePriceIndexSvg(priceIndexItems.slice(0, 15), avgPriceIndex);

  // 10. Compile Executive Summary 5 Points
  const executiveSummary = [
    {
      title: 'حجم المحفظة المرصودة',
      value: `${productCount} منتج`,
      subtitle: `في ${brandCategoryIds.length} فئات نشطة على المتجر`,
      status: productCount >= 10 ? 'normal' : 'warning'
    },
    {
      title: 'متوسط سعر الوحدة مقابل السوق',
      value: brandAvgUnitPrice ? `${brandAvgUnitPrice} ${unitComparisonLabel}` : 'غير متاح',
      subtitle: marketAvgUnitPrice 
        ? `${unitPriceDiffPct <= 0 ? 'أقل بنسبة' : 'أعلى بنسبة'} ${Math.abs(unitPriceDiffPct)}% من متوسط السوق (${marketAvgUnitPrice} ${unitComparisonLabel})`
        : 'لا توجد بيانات وحدة مقارنة كافية',
      status: unitPriceDiffPct !== null ? (unitPriceDiffPct <= 0 ? 'positive' : 'warning') : 'neutral'
    },
    {
      title: 'منتجات أعلى من وسيط الفئة',
      value: `${productsAboveMedianCount} من أصل ${totalComparedAboveMedian}`,
      subtitle: totalComparedAboveMedian > 0
        ? `بنسبة ${((productsAboveMedianCount / totalComparedAboveMedian) * 100).toFixed(1)}% من المنتجات المقارنة`
        : 'بيانات غير كافية',
      status: (productsAboveMedianCount / (totalComparedAboveMedian || 1)) > 0.5 ? 'warning' : 'positive'
    },
    {
      title: 'حالات نفاد المخزون (OOS)',
      value: `${totalOosEvents} حالة رصد`,
      subtitle: outOfStockList.length > 0
        ? `تأثر بها ${outOfStockList.length} منتج خلال فترة ${days} يوماً`
        : 'توفر كامل بنسبة 100% دون أي نفاد مسجل',
      status: totalOosEvents === 0 ? 'positive' : 'warning'
    },
    {
      title: 'أكبر فرق سعري مع منافس',
      value: maxPriceDiffEvent ? `${Math.abs(maxPriceDiffEvent.diffEgp)} ج.م` : 'لا يوجد',
      subtitle: maxPriceDiffEvent
        ? `${maxPriceDiffEvent.cheaper} — (${maxPriceDiffEvent.brandProduct.slice(0, 24)}... مقابل ${maxPriceDiffEvent.competitorProduct.slice(0, 24)}...)`
        : 'لا يوجد منافس مباشر مطابق للحجم',
      status: maxPriceDiffEvent && maxPriceDiffEvent.cheaper.includes(canonical) ? 'positive' : 'neutral'
    }
  ];

  return {
    brand: canonical,
    days,
    generatedAt,
    minDate: minDate ? minDate.slice(0, 10) : '—',
    maxDate: maxDate ? maxDate.slice(0, 10) : '—',
    daysObserved,
    productCount,
    isInsufficientData,
    warningMessage,
    executiveSummary,
    competitorTable,
    outOfStockList,
    totalOosEvents,
    promotions: {
      p30DropCount,
      deepestDiscountPct,
      avgPromoDurationDays,
      promoSyncRatePct,
      promoSyncStatus
    },
    priceIndex: {
      items: priceIndexItems,
      avgPriceIndex,
      svgChart
    }
  };
}

/**
 * Generates an SVG bar chart for Price Index comparison
 * Baseline at 1.0 (Median). Bars going left or right depending on ratio.
 */
function generatePriceIndexSvg(items, avgIndex) {
  if (!items || items.length === 0) {
    return `<div style="text-align: center; color: #64748b; padding: 20px;">لا تتوفر بيانات كافية لرسم مؤشر السعر</div>`;
  }

  const width = 760;
  const rowHeight = 34;
  const marginTop = 55;
  const marginBottom = 35;
  const height = marginTop + items.length * rowHeight + marginBottom;

  const labelWidth = 250;
  const chartWidth = 420;
  const chartLeft = labelWidth + 30;

  const minVal = 0.2;
  const maxVal = 1.8;
  const scale = (val) => {
    const clamped = Math.max(minVal, Math.min(maxVal, val));
    return chartLeft + ((clamped - minVal) / (maxVal - minVal)) * chartWidth;
  };

  const centerLineX = scale(1.0);

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="${height}" style="font-family: Cairo, Tahoma, sans-serif;">
    <rect width="${width}" height="${height}" fill="#f8fafc" rx="8" />
    
    <!-- Title and Subtitle -->
    <text x="${width - 20}" y="24" text-anchor="end" font-size="13" font-weight="bold" fill="#0f172a" direction="rtl">مؤشر سعر الوحدة (سعر الوحدة ÷ وسيط الفئة)</text>
    <text x="${width - 20}" y="42" text-anchor="end" font-size="10" fill="#64748b" direction="rtl">خط 1.0 يمثل وسيط السوق (أقل من 1.0 = أرخص من وسيط الفئة، أعلى من 1.0 = أغلى)</text>

    <!-- Grid Lines & Legend -->
    <line x1="${scale(0.5)}" y1="${marginTop}" x2="${scale(0.5)}" y2="${height - marginBottom}" stroke="#e2e8f0" stroke-dasharray="3,3" />
    <text x="${scale(0.5)}" y="${height - marginBottom + 18}" text-anchor="middle" font-size="9" fill="#94a3b8">0.5x</text>

    <line x1="${scale(0.8)}" y1="${marginTop}" x2="${scale(0.8)}" y2="${height - marginBottom}" stroke="#e2e8f0" stroke-dasharray="3,3" />
    <text x="${scale(0.8)}" y="${height - marginBottom + 18}" text-anchor="middle" font-size="9" fill="#94a3b8">0.8x</text>

    <!-- Center Line 1.0 -->
    <line x1="${centerLineX}" y1="${marginTop}" x2="${centerLineX}" y2="${height - marginBottom}" stroke="#0284c7" stroke-width="2" />
    <text x="${centerLineX}" y="${height - marginBottom + 18}" text-anchor="middle" font-size="10" font-weight="bold" fill="#0284c7">1.0x (وسيط الفئة)</text>

    <line x1="${scale(1.2)}" y1="${marginTop}" x2="${scale(1.2)}" y2="${height - marginBottom}" stroke="#e2e8f0" stroke-dasharray="3,3" />
    <text x="${scale(1.2)}" y="${height - marginBottom + 18}" text-anchor="middle" font-size="9" fill="#94a3b8">1.2x</text>

    <line x1="${scale(1.5)}" y1="${marginTop}" x2="${scale(1.5)}" y2="${height - marginBottom}" stroke="#e2e8f0" stroke-dasharray="3,3" />
    <text x="${scale(1.5)}" y="${height - marginBottom + 18}" text-anchor="middle" font-size="9" fill="#94a3b8">1.5x</text>
  `;

  // Draw Bars
  items.forEach((item, idx) => {
    const y = marginTop + idx * rowHeight;
    const barHeight = 16;
    const idxVal = item.price_index;
    const barX = idxVal < 1.0 ? scale(idxVal) : centerLineX;
    const barW = Math.max(3, Math.abs(scale(idxVal) - centerLineX));

    let barColor = '#10b981'; // green (<1.0)
    if (idxVal > 1.05) barColor = '#f59e0b'; // amber
    if (idxVal > 1.25) barColor = '#ef4444'; // red

    const shortTitle = item.title.length > 32 ? item.title.slice(0, 32) + '...' : item.title;

    svg += `
      <g>
        <!-- Product Label -->
        <text x="${labelWidth}" y="${y + 12}" text-anchor="end" font-size="9.5" fill="#334155" direction="rtl">${shortTitle}</text>
        
        <!-- Bar Background -->
        <rect x="${chartLeft}" y="${y}" width="${chartWidth}" height="${barHeight}" fill="#f1f5f9" rx="3" />
        
        <!-- Value Bar -->
        <rect x="${barX}" y="${y}" width="${barW}" height="${barHeight}" fill="${barColor}" rx="3" opacity="0.9" />
        
        <!-- Value Text positioned cleanly -->
        <text x="${idxVal < 1.0 ? barX - 6 : barX + barW + 6}" y="${y + 12}" text-anchor="${idxVal < 1.0 ? 'end' : 'start'}" font-size="9" font-weight="bold" fill="#0f172a">${idxVal}x</text>
      </g>
    `;
  });

  svg += `</svg>`;
  return svg;
}

module.exports = {
  resolveBrand,
  getRelatedCategoryIds,
  getBrandReportData,
  generatePriceIndexSvg,
  getProspectList,
  getOpportunitiesAndRecommendations
};

/**
 * Returns prioritized prospective brand list (top 20)
 * Scored by:
 * - Product count (weight 3)
 * - Stockout incidents (weight 10)
 * - Price volatility/changes (weight 5)
 */
function getProspectList(limit = 20, dbInstance = db) {
  const prods = dbInstance.prepare(`
    SELECT
      p.asin, p.title, p.brand, p.category_id,
      c.name as category_name, c.name_ar as category_name_ar,
      (SELECT count(*) FROM price_snapshots WHERE asin = p.asin) as snap_count,
      (SELECT count(distinct price) FROM price_snapshots WHERE asin = p.asin AND price IS NOT NULL) as distinct_prices,
      (SELECT count(*) FROM price_snapshots WHERE asin = p.asin AND (in_stock = 0 OR price IS NULL)) as stockouts,
      (SELECT price FROM price_snapshots WHERE asin = p.asin AND price IS NOT NULL ORDER BY scraped_at DESC LIMIT 1) as current_price
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE p.is_active = 1
  `).all();

  const brandMap = new Map();

  for (const p of prods) {
    const brand = p.brand || extractBrand(p.title);
    if (!brand || brand === 'Unknown' || brand === 'null') continue;

    if (!brandMap.has(brand)) {
      brandMap.set(brand, {
        brand,
        product_count: 0,
        priced_count: 0,
        stockout_count: 0,
        price_changes: 0,
        categories: new Set()
      });
    }

    const entry = brandMap.get(brand);
    entry.product_count++;
    if (p.current_price) entry.priced_count++;
    entry.stockout_count += (p.stockouts || 0);
    if (p.distinct_prices > 1) {
      entry.price_changes += (p.distinct_prices - 1);
    }
    if (p.category_name_ar || p.category_name) {
      entry.categories.add(p.category_name_ar || p.category_name);
    }
  }

  const list = Array.from(brandMap.values()).map(b => {
    const priority_score = (b.product_count * 3) + (b.stockout_count * 10) + (b.price_changes * 5);
    let priority_tier = 'أولوية متوسطة';
    if (priority_score >= 100 || b.product_count >= 20) {
      priority_tier = 'أولوية قصوى';
    } else if (priority_score >= 25 || b.product_count >= 5) {
      priority_tier = 'أولوية مرتفعة';
    }

    const catStr = Array.from(b.categories).slice(0, 2).join(' / ') || 'أغذية وسوبرماركت';

    return {
      brand: b.brand,
      product_count: b.product_count,
      priced_count: b.priced_count,
      stockout_count: b.stockout_count,
      price_changes: b.price_changes,
      priority_score,
      priority_tier,
      categories: catStr,
      sample_trigger: `${b.brand}: ${b.product_count} منتج مرصود، ${b.stockout_count} رصد نفاد مخزون، ${b.price_changes} تقلبات سعرية`
    };
  });

  list.sort((a, b) => b.priority_score - a.priority_score || b.product_count - a.product_count);
  return list.slice(0, limit);
}

/**
 * Returns 3 specific data-backed recommendations for the Lead Report "صفحة الفرص"
 */
function getOpportunitiesAndRecommendations(reportData) {
  const {
    brand,
    executiveSummary,
    competitorTable,
    outOfStockList,
    totalOosEvents,
    priceIndex,
    productCount
  } = reportData;

  const recs = [];

  // Recommendation 1: Pricing rebalance & defending market share
  const expensiveProducts = (competitorTable || [])
    .filter(p => p.price_index && p.price_index > 1.05)
    .sort((a, b) => b.price_index - a.price_index);

  if (expensiveProducts.length > 0) {
    const topExp = expensiveProducts[0];
    const topComp = topExp.competitors && topExp.competitors[0];
    const compNote = topComp
      ? `مقارنة بـ "${topComp.title.slice(0, 30)}..." من ${topComp.brand} بسعر ${topComp.price} ج.م`
      : 'مقارنة بمتوسط البدائل المباشرة';
    const gapPct = +((topExp.price_index - 1) * 100).toFixed(1);

    recs.push({
      num: 1,
      title: 'إعادة موازنة الأسعار للأصناف المتأثرة واستعادة المبيعات',
      category: 'التسعير التنافسي',
      metric: `${expensiveProducts.length} منتج مسعر أعلى من وسيط الفئة (${gapPct}% أعلى صنف)`,
      action: `يُوصى بمراجعة تسعير الصنف "${topExp.title.slice(0, 45)}..." المسعر بـ ${topExp.current_price} ج.م (${compNote}). التعديل السعري بنسبة 5-8% أو توفير عروض باقات ترويجية (Bundle) سيعيد توجيه طلب المتسوقين السريعين للعلامة ويمنع تسرب المبيعات للمنافسين.`
    });
  } else {
    recs.push({
      num: 1,
      title: 'استغلال القوة السعرية وزيادة الهامش الربحي تدريجياً',
      category: 'تحسين الهامش',
      metric: `كافة منتجات العلامة مسعرة بنطاق تنافسي ومساوٍ لوسيط السوق`,
      action: `بما أن أسعار العلامة تقع ضمن نطاق وسيط السوق دون مغالاة، يمكن دراسة زيادة محسوبة بنسبة 2-3% على الأصناف القيادية الأكثر طلباً لتعظيم الهامش الربحي دون التأثير على وتيرة التحويل.`
    });
  }

  // Recommendation 2: Stockout prevention & revenue protection
  if (outOfStockList && outOfStockList.length > 0) {
    const worstOos = outOfStockList[0];
    recs.push({
      num: 2,
      title: 'سد فجوات الإتاحة اللوجستية وتأمين المخزون في ساعات الذروة',
      category: 'سلاسل التوريد والتوفر',
      metric: `${outOfStockList.length} منتج سجل حالات نفاد مخزون (أبرزها بنسبة عدم إتاحة ${worstOos.unavailable_pct}%)`,
      action: `رصدنا نفاد مخزون متكرر على الصنف "${worstOos.title.slice(0, 40)}..." (${worstOos.oos_snapshots} مرات رصد). في منصات التوصيل الفوري، نفاد الصنف يعني خسارة فورية 100% للسلة لصالح المنافس المتاح خلال 15 دقيقة. يُوصى بمزامنة جداول التوريد مع فترات ذروة طلب مخازن Amazon Tez.`
    });
  } else {
    recs.push({
      num: 2,
      title: 'الحفاظ على ميزة الإتاحة الكاملة واستثمارها تسويقياً',
      category: 'الموثوقية اللوجستية',
      metric: `معدل إتاحة كامل 100% دون أي حالات نفاد مسجلة`,
      action: `تسجيل العلامة لمعدل إتاحة 100% يمنحها ميزة تفضيل في خوارزميات Amazon Now. يُوصى بالتركيز على ضمان توافر العبوات الكبيرة (Family Packs) لرفع متوسط قيمة سلة الشراء (AOV) أثناء تسوق العائلات.`
    });
  }

  // Recommendation 3: Hero SKU & Unit price advantage
  const heroProducts = (competitorTable || [])
    .filter(p => p.price_index && p.price_index < 0.95)
    .sort((a, b) => a.price_index - b.price_index);

  if (heroProducts.length > 0) {
    const bestHero = heroProducts[0];
    const savingsPct = +((1 - bestHero.price_index) * 100).toFixed(1);
    recs.push({
      num: 3,
      title: 'تنشيط الأصناف البطلة (Hero SKUs) ذات أفضل سعر وحدة',
      category: 'استراتيجية المنتجات البطلة',
      metric: `${heroProducts.length} منتج يوفر ميزة سعر وحدة قيادية (توفير حتى ${savingsPct}%)`,
      action: `الصنف "${bestHero.title.slice(0, 45)}..." يوفر سعر وحدة ممتاز (${bestHero.unit_price ? bestHero.unit_price + ' ' + (bestHero.unit_price_unit || '') : bestHero.current_price + ' ج.م'}) متفوقاً بـ ${savingsPct}% على البدائل. يُوصى بوضعه كصنف بطل في واجهات المتاجر والحملات الإعلانية المدفوعة لجذب المشترين الجدد.`
    });
  } else {
    recs.push({
      num: 3,
      title: 'ابتكار عبوات توفيرية بحجم اقتصادي (Multipacks)',
      category: 'تطوير العبوات',
      metric: `فرصة لإنشاء صنف ريادي في سعر الوحدة`,
      action: `يُوصى بطرح عبوات ترويجية متعددة (مثل عبوة 4 قطع أو حزم 1 كجم) لخفض سعر الوحدة المعروض، مما يجذب فئة المستهلكين الحساسة لسعر الكيلو/اللتر في فترات التضخم.`
    });
  }

  return recs;
}
