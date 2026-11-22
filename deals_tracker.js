const fs = require('fs');
const path = require('path');
const repo = require('./src/repo');
const db = require('./src/db');
const pricing = require('./src/pricing');

const PRODUCTS_FILE = path.join(__dirname, 'products.json');
const HISTORY_FILE = path.join(__dirname, 'price_history.json');
const DEALS_FILE = path.join(__dirname, 'deals_report.json');

/**
 * Deal & Price History Tracker
 * Analyzes products from SQLite repo (with JSON fallback), calculates real historical discounts
 * based on 90-day typical prices (median) and fair prices (p30), tracks unit prices,
 * and identifies verified true price drops.
 * JSON files are kept as export only.
 */
function analyzeDeals(options = {}) {
  // Check for --unit-price-audit flag
  if (process.argv.includes('--unit-price-audit') || options.unitPriceAudit) {
    return pricing.auditUnitPrices();
  }

  const now = new Date().toISOString();

  // 1. Load products from SQLite repository, with fallback to products.json
  let products = [];
  try {
    const dbProducts = repo.getProductsForExport();
    if (dbProducts && dbProducts.length > 0) {
      products = dbProducts;
    }
  } catch (err) {
    console.warn('[-] Repository query failed, falling back to products.json:', err.message);
  }

  if (products.length === 0 && fs.existsSync(PRODUCTS_FILE)) {
    try {
      products = JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf-8'));
    } catch (e) {
      console.error('[-] Failed to read products.json fallback:', e.message);
      return null;
    }
  }

  if (products.length === 0) {
    console.error('[-] No products found to analyze!');
    return null;
  }

  const analyzed = [];
  const priceDrops = [];
  const exportHistory = {};

  products.forEach(p => {
    const asin = p.asin;
    const currentPrice = p.currentPriceNum;
    const listedOldPrice = p.oldPriceNum;

    // Fetch previous snapshot from SQLite repo for drop detection
    let prevPrice = null;
    let snapshots = [];

    try {
      snapshots = db.prepare(`
        SELECT scraped_at, price, list_price
        FROM price_snapshots
        WHERE asin = ?
        ORDER BY scraped_at ASC, id ASC
      `).all(asin);

      if (snapshots.length > 1) {
        prevPrice = snapshots[snapshots.length - 2].price;
      }
    } catch (e) {}

    // Build history export object from DB snapshots
    const firstSnap = snapshots.length > 0 ? snapshots[0] : null;
    exportHistory[asin] = {
      asin,
      title: p.title,
      category: p.category,
      productUrl: p.productUrl,
      firstSeen: firstSnap ? firstSnap.scraped_at : now,
      baselinePrice: firstSnap ? (firstSnap.list_price || firstSnap.price) : (listedOldPrice || currentPrice),
      lowestPrice: p.lowestPrice,
      highestPrice: p.highestPrice,
      history: snapshots.length > 0
        ? snapshots.map(s => ({
            date: s.scraped_at,
            price: s.price,
            listedOldPrice: s.list_price
          }))
        : [{
            date: now,
            price: currentPrice,
            listedOldPrice: listedOldPrice
          }]
    };

    // Detect price drop compared to previous scrape
    let isDrop = false;
    let dropAmount = 0;
    if (prevPrice !== null && currentPrice !== null && currentPrice < prevPrice) {
      isDrop = true;
      dropAmount = +(prevPrice - currentPrice).toFixed(2);
      priceDrops.push({
        asin,
        title: p.title,
        oldPrice: prevPrice,
        newPrice: currentPrice,
        dropAmount,
        discountPct: p.historical_discount_pct || 0
      });

      // Log price drop alert into SQLite
      try {
        repo.logAlert({
          asin,
          rule: 'price_drop',
          threshold: prevPrice,
          price: currentPrice,
          triggered_at: now,
          channel: 'system',
          payload: { dropAmount, historical_discount_pct: p.historical_discount_pct }
        });
      } catch (e) {}
    }

    // Save Deal Score into SQLite deals_scores table
    try {
      repo.saveDealScore({
        asin: p.asin,
        run_id: null,
        fair_price: p.fair_price,
        typical_price: p.typical_price,
        historical_discount_pct: p.historical_discount_pct,
        advertised_discount_pct: p.advertised_discount_pct,
        is_real_deal: p.is_real_deal,
        confidence: p.confidence,
        all_time_low: p.all_time_low,
        price_index: p.price_index,
        computed_at: now
      });
    } catch (e) {}

    // Log real deal alert if verified
    if (p.is_real_deal) {
      try {
        repo.logAlert({
          asin,
          rule: 'real_deal',
          threshold: p.fair_price,
          price: currentPrice,
          triggered_at: now,
          channel: 'system',
          payload: {
            historical_discount_pct: p.historical_discount_pct,
            fair_price: p.fair_price,
            typical_price: p.typical_price,
            confidence: p.confidence
          }
        });
      } catch (e) {}
    }

    analyzed.push({
      ...p,
      isDrop,
      dropAmount
    });
  });

  // Filter & sort real deals (strictly high & medium confidence deals, NOT low)
  const realDeals = analyzed
    .filter(p => p.is_real_deal && (p.confidence === 'high' || p.confidence === 'medium'))
    .sort((a, b) => (b.historical_discount_pct || 0) - (a.historical_discount_pct || 0));

  const topSavingsInEgp = [...realDeals]
    .sort((a, b) => (b.egpSaved || 0) - (a.egpSaved || 0));

  const gatheringDataCount = analyzed.filter(p => p.confidence === 'low').length;
  const withUnitPriceCount = analyzed.filter(p => p.unit_price !== null).length;

  const report = {
    analyzedAt: now,
    totalProducts: analyzed.length,
    totalDealsCount: realDeals.length,
    gatheringDataCount: gatheringDataCount,
    withUnitPriceCount: withUnitPriceCount,
    newPriceDropsCount: priceDrops.length,
    topDealsByPercentage: realDeals.slice(0, 15),
    topDealsByEgpSavings: topSavingsInEgp.slice(0, 15),
    priceDrops: priceDrops
  };

  // Export JSON files (JSON as export only)
  try {
    fs.writeFileSync(DEALS_FILE, JSON.stringify(report, null, 2), 'utf-8');
    fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(analyzed, null, 2), 'utf-8');
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(exportHistory, null, 2), 'utf-8');
  } catch (err) {
    console.error('[-] Error exporting JSON files:', err.message);
  }

  // Print Summary to Console
  printDealsReport(report);

  return report;
}

function printDealsReport(report) {
  console.log('\n===============================================================');
  console.log('   🔥 تقرير رادار كشف العروض الحقيقية (Real Deals Detector)   ');
  console.log('===============================================================');
  console.log(`📊 إجمالي المنتجات المفحوصة: ${report.totalProducts}`);
  console.log(`🎯 إجمالي العروض الحقيقية المؤكدة (High/Med Confidence): ${report.totalDealsCount}`);
  console.log(`⏳ منتجات جديدة جاري جمع تاريخها: ${report.gatheringDataCount}`);
  console.log(`⚖️ منتجات تم احتساب سعر الوحدة لها: ${report.withUnitPriceCount}`);
  if (report.newPriceDropsCount > 0) {
    console.log(`⚡ هبوط أسعار جديد منذ آخر كشط: ${report.newPriceDropsCount} منتج`);
  }
  console.log('---------------------------------------------------------------');
  console.log('🏆 أكبر عروض الخصم الحقيقي التاريخي (Historical Discount %):');
  if (report.topDealsByPercentage.length === 0) {
    console.log('  (لا توجد عروض تستوفي شروط الخصم التاريخي حالياً)');
  } else {
    report.topDealsByPercentage.slice(0, 10).forEach((p, idx) => {
      const unitStr = p.unit_price_formatted && p.unit_price_formatted !== '—' ? ` [${p.unit_price_formatted}]` : '';
      console.log(` ${idx + 1}. [خصم تاريخي ${p.historical_discount_pct}% | وفر ${p.egpSaved} ج.م]${unitStr} ${p.title}`);
      console.log(`    السعر الآن: EGP ${p.currentPriceNum} (السعر العادل p30: EGP ${p.fair_price} | المعتاد: EGP ${p.typical_price}) | ثقة: ${p.confidence}`);
    });
  }

  if (report.topDealsByEgpSavings.length > 0) {
    console.log('---------------------------------------------------------------');
    console.log('💰 أكبر العروض حسب الوفر بالجنيه من السعر المعتاد:');
    report.topDealsByEgpSavings.slice(0, 5).forEach((p, idx) => {
      console.log(` ${idx + 1}. [وفر ${p.egpSaved} ج.م | -${p.historical_discount_pct}%] ${p.title}`);
      console.log(`    السعر الآن: EGP ${p.currentPriceNum} (المعتاد: EGP ${p.typical_price})`);
    });
  }
  console.log('===============================================================\n');
}

if (require.main === module) {
  analyzeDeals();
}

module.exports = { analyzeDeals };
