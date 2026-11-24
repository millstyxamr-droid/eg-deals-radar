/**
 * Amazon Egypt Tez Scraper - Deals Static Page Generator
 * Generates dist/index.html directly from SQLite database.
 * Pure Vanilla HTML/CSS/JS (no frameworks), Mobile-First, RTL, SEO, Dark Mode.
 */

const fs = require('fs');
const path = require('path');
const repo = require('./repo');
const { withAffiliate, getAffiliateTag } = require('./affiliate');

/**
 * Escapes HTML entities to prevent XSS
 */
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Build Arabic localized date string
 */
function formatArabicDate(date = new Date()) {
  const arabicDate = new Intl.DateTimeFormat('ar-EG', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  }).format(date);

  const arabicTime = new Intl.DateTimeFormat('ar-EG', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  }).format(date);

  return { arabicDate, arabicTime };
}

/**
 * Main site generator function
 */
function buildDealsPage(options = {}) {
  const startTime = Date.now();
  const distDir = options.distDir || path.join(__dirname, '..', 'dist');

  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  console.log('[*] Fetching enriched products from database...');
  const allProducts = repo.getProductsForExport();

  // Filter products:
  // - exclude confidence === 'low'
  // - exclude products without image
  // - exclude products without price
  const qualifiedDeals = allProducts.filter(p => {
    if (p.confidence === 'low') return false;
    if (!p.imgSrc || typeof p.imgSrc !== 'string' || !p.imgSrc.trim()) return false;
    if (p.currentPriceNum === null || p.currentPriceNum === undefined || p.currentPriceNum <= 0) return false;
    return true;
  });

  // Default sort: historical_discount_pct DESC, then is_real_deal, then all_time_low
  qualifiedDeals.sort((a, b) => {
    const discA = a.historical_discount_pct !== null && a.historical_discount_pct !== undefined ? a.historical_discount_pct : -1;
    const discB = b.historical_discount_pct !== null && b.historical_discount_pct !== undefined ? b.historical_discount_pct : -1;
    if (discB !== discA) return discB - discA;
    if (b.is_real_deal !== a.is_real_deal) return (b.is_real_deal ? 1 : 0) - (a.is_real_deal ? 1 : 0);
    if (b.all_time_low !== a.all_time_low) return (b.all_time_low ? 1 : 0) - (a.all_time_low ? 1 : 0);
    return (a.currentPriceNum || 0) - (b.currentPriceNum || 0);
  });

  // Calculate high-level metrics for Hero and filters
  const { arabicDate, arabicTime } = formatArabicDate(new Date());
  const categoriesMap = new Map();
  let maxPrice = 0;
  let allTimeLowCount = 0;
  let withUnitPriceCount = 0;

  for (const deal of qualifiedDeals) {
    const catName = deal.category || 'أخرى';
    categoriesMap.set(catName, (categoriesMap.get(catName) || 0) + 1);
    if (deal.currentPriceNum > maxPrice) maxPrice = Math.ceil(deal.currentPriceNum);
    if (deal.all_time_low) allTimeLowCount++;
    if (deal.unit_price && deal.unit_price_unit) withUnitPriceCount++;
  }

  const categories = Array.from(categoriesMap.entries()).sort((a, b) => b[1] - a[1]);

  const affiliateTag = getAffiliateTag();
  const heroOgImage = qualifiedDeals.length > 0 ? qualifiedDeals[0].imgSrc : 'https://m.media-amazon.com/images/G/42/AmazonTez/homepage.jpg';

  // JSON-LD ItemList for SEO
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `أفضل عروض أمازون مصر اليوم — ${arabicDate}`,
    description: `عروض وتخفيضات أمازون مصر (Amazon Egypt Tez). تم فحص الأسعار بمقارنة السعر بمتوسط 90 يوماً وسعر الوحدة.`,
    numberOfItems: qualifiedDeals.length,
    itemListElement: qualifiedDeals.slice(0, 50).map((deal, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      item: {
        '@type': 'Product',
        name: deal.title,
        image: deal.imgSrc,
        url: withAffiliate(deal.productUrl, 'seo_jsonld', affiliateTag),
        offers: {
          '@type': 'Offer',
          priceCurrency: 'EGP',
          price: deal.currentPriceNum,
          availability: 'https://schema.org/InStock',
          priceValidUntil: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0]
        }
      }
    }))
  };

  // Render product cards
  const cardsHtml = qualifiedDeals.map(deal => {
    const affiliateUrl = withAffiliate(deal.productUrl, 'deals_page', affiliateTag);
    const hasUnitPrice = Boolean(deal.unit_price && deal.unit_price_unit);
    const unitPriceDisplay = deal.unit_price_formatted && deal.unit_price_formatted !== '—'
      ? deal.unit_price_formatted
      : (hasUnitPrice ? `${deal.unit_price.toFixed(2)} ج.م / ${deal.unit_price_unit}` : '');

    const historicalDiscount = deal.historical_discount_pct !== null && deal.historical_discount_pct !== undefined
      ? deal.historical_discount_pct
      : 0;

    const typicalPriceDisplay = deal.typical_price !== null && deal.typical_price !== undefined
      ? `${deal.typical_price.toFixed(2)} ج.م`
      : '—';

    const store = deal.store || 'amazon';
    const isJumia = store === 'jumia';

    return `
      <article class="deal-card"
        data-asin="${escapeHtml(deal.asin)}"
        data-store="${escapeHtml(store)}"
        data-category="${escapeHtml(deal.category || 'أخرى')}"
        data-brand="${escapeHtml(deal.brand || '')}"
        data-price="${deal.currentPriceNum}"
        data-typical-price="${deal.typical_price || 0}"
        data-discount="${historicalDiscount}"
        data-all-time-low="${deal.all_time_low ? '1' : '0'}"
        data-has-unit-price="${hasUnitPrice ? '1' : '0'}"
        data-unit-price="${deal.unit_price || 999999}">
        
        <div class="card-media">
          <img src="${escapeHtml(deal.imgSrc)}" alt="${escapeHtml(deal.title)}" loading="lazy" width="220" height="220" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'220\\' height=\\'220\\' viewBox=\\'0 0 220 220\\'><rect fill=\\'%23e2e8f0\\' width=\\'220\\' height=\\'220\\'/><text fill=\\'%2394a3b8\\' font-family=\\'sans-serif\\' font-size=\\'14\\' x=\\'50%\\' y=\\'50%\\' text-anchor=\\'middle\\'>صورة غير متاحة</text></svg>'">
          <div class="card-badges">
            ${isJumia ? '<span class="badge badge-jumia">🛍️ جوميا مصر</span>' : '<span class="badge badge-amazon">🛒 أمازون مصر</span>'}
            ${deal.all_time_low ? '<span class="badge badge-atl">🔥 أقل سعر تاريخي</span>' : ''}
            ${historicalDiscount > 0 ? `<span class="badge badge-discount">-${historicalDiscount}% خصم حقيقي</span>` : ''}
            ${deal.is_real_deal && !deal.all_time_low && historicalDiscount <= 0 ? '<span class="badge badge-real">عرض حقيقي</span>' : ''}
          </div>
        </div>

        <div class="card-body">
          <div class="card-meta">
            <span class="card-category">${escapeHtml(deal.category || 'أخرى')}</span>
            ${deal.brand ? `<span class="card-brand">${escapeHtml(deal.brand)}</span>` : ''}
          </div>
          <h3 class="card-title" title="${escapeHtml(deal.title)}">${escapeHtml(deal.title)}</h3>
          
          <div class="card-pricing">
            <div class="price-row">
              <span class="price-current">${deal.currentPriceNum.toFixed(2)} <small>ج.م</small></span>
              ${deal.typical_price && deal.typical_price > deal.currentPriceNum ? `
                <span class="price-typical" title="متوسط سعر المنتج في آخر 90 يوماً">
                  المعتاد: <s>${typicalPriceDisplay}</s>
                </span>
              ` : ''}
            </div>

            ${hasUnitPrice ? `
              <div class="unit-price-row" title="سعر الوحدة القياسي للمقارنة العادلة">
                <span class="unit-price-icon">⚖️</span>
                <span class="unit-price-val">${escapeHtml(unitPriceDisplay)}</span>
              </div>
            ` : `
              <div class="unit-price-row muted">
                <span class="unit-price-icon">⚖️</span>
                <span class="unit-price-val">سعر الوحدة غير متاح</span>
              </div>
            `}
          </div>

          <div class="card-footer">
            <a href="${escapeHtml(affiliateUrl)}" target="_blank" rel="noopener noreferrer sponsored" class="btn-buy ${isJumia ? 'btn-jumia' : 'btn-amazon'}">
              <span>${isJumia ? 'عرض على جوميا' : 'عرض على أمازون'}</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
            </a>
          </div>
        </div>
      </article>
    `;
  }).join('\n');

  // Complete HTML Template
  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>أفضل عروض وتخفيضات أمازون مصر اليوم | ${arabicDate}</title>
  <meta name="description" content="تصفح أفضل عروض وتخفيضات أمازون مصر الحقيقية اليوم (${arabicDate}). كشف الخصومات الحقيقية بمقارنة الأسعار بمتوسط 90 يوماً وسعر الوحدة وأقل سعر تاريخي.">
  <meta name="keywords" content="عروض امازون مصر, تخفيضات امازون, amazon eg deals, كود خصم امازون, عروض تيز, اسعار امازون اليوم">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="https://deals.amazoneg.example.com/">

  <!-- OpenGraph & Social Cards -->
  <meta property="og:type" content="website">
  <meta property="og:locale" content="ar_EG">
  <meta property="og:title" content="أفضل عروض وتخفيضات أمازون مصر اليوم — ${arabicDate}">
  <meta property="og:description" content="${qualifiedDeals.length} عرض حقيقي تم التحقق منه تاريخياً على أمازون مصر. مقارنة السعر بالمتوسط الفعلي وسعر الوحدة.">
  <meta property="og:image" content="${escapeHtml(heroOgImage)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="عروض أمازون مصر الحقيقية — ${arabicDate}">
  <meta name="twitter:description" content="مقارنة بالأسعار التاريخية لآخر 90 يوماً لكشف الخصومات الحقيقية وسعر الوحدة.">

  <!-- Schema.org JSON-LD -->
  <script type="application/ld+json">
  ${JSON.stringify(jsonLd, null, 2)}
  </script>

  <style>
    :root {
      --font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Cairo", "Noto Sans Arabic", Tahoma, sans-serif;
      --bg-page: #f8fafc;
      --bg-surface: #ffffff;
      --bg-surface-secondary: #f1f5f9;
      --text-main: #0f172a;
      --text-muted: #64748b;
      --text-light: #94a3b8;
      --border-color: #e2e8f0;
      --border-focus: #3b82f6;
      --primary: #2563eb;
      --primary-hover: #1d4ed8;
      --accent-orange: #ea580c;
      --accent-green: #16a34a;
      --accent-badge-atl: #dc2626;
      --badge-discount-bg: #fef2f2;
      --badge-discount-text: #b91c1c;
      --badge-atl-bg: #fee2e2;
      --badge-atl-text: #991b1b;
      --shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.05);
      --shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.07), 0 2px 4px -2px rgb(0 0 0 / 0.07);
      --shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.08), 0 4px 6px -4px rgb(0 0 0 / 0.08);
      --radius-sm: 6px;
      --radius-md: 10px;
      --radius-lg: 16px;
      --radius-full: 9999px;
    }

    @media (prefers-color-scheme: dark) {
      :root {
        --bg-page: #0f172a;
        --bg-surface: #1e293b;
        --bg-surface-secondary: #334155;
        --text-main: #f8fafc;
        --text-muted: #94a3b8;
        --text-light: #64748b;
        --border-color: #334155;
        --border-focus: #60a5fa;
        --primary: #3b82f6;
        --primary-hover: #60a5fa;
        --badge-discount-bg: #450a0a;
        --badge-discount-text: #fca5a5;
        --badge-atl-bg: #7f1d1d;
        --badge-atl-text: #fecaca;
        --shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.3);
        --shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.4);
        --shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.5);
      }
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: var(--font-family);
      background-color: var(--bg-page);
      color: var(--text-main);
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
      direction: rtl;
    }

    a {
      color: inherit;
      text-decoration: none;
    }

    .container {
      width: 100%;
      max-width: 1280px;
      margin: 0 auto;
      padding: 0 16px;
    }

    /* Header & Hero */
    header.site-header {
      background: var(--bg-surface);
      border-bottom: 1px solid var(--border-color);
      padding: 14px 0;
      position: sticky;
      top: 0;
      z-index: 40;
      box-shadow: var(--shadow-sm);
    }
    .header-inner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }
    .brand-logo {
      display: flex;
      align-items: center;
      gap: 10px;
      font-weight: 800;
      font-size: 1.15rem;
      color: var(--primary);
    }
    .brand-logo svg {
      color: var(--accent-orange);
    }
    .brand-tag {
      font-size: 0.75rem;
      background: var(--bg-surface-secondary);
      padding: 3px 8px;
      border-radius: var(--radius-full);
      color: var(--text-muted);
      font-weight: 600;
    }

    .hero-section {
      background: linear-gradient(180deg, var(--bg-surface) 0%, var(--bg-page) 100%);
      padding: 40px 0 24px;
      text-align: center;
      border-bottom: 1px solid var(--border-color);
    }
    .hero-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 14px;
      background: var(--bg-surface-secondary);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-full);
      font-size: 0.85rem;
      color: var(--text-muted);
      margin-bottom: 16px;
    }
    .hero-title {
      font-size: clamp(1.6rem, 4vw, 2.4rem);
      font-weight: 900;
      letter-spacing: -0.02em;
      margin-bottom: 12px;
      color: var(--text-main);
    }
    .hero-title span {
      color: var(--primary);
    }
    .hero-subtitle {
      font-size: 1.05rem;
      color: var(--text-muted);
      max-width: 650px;
      margin: 0 auto 24px;
    }
    .stats-pills {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 12px;
    }
    .stat-pill {
      background: var(--bg-surface);
      border: 1px solid var(--border-color);
      padding: 8px 16px;
      border-radius: var(--radius-md);
      display: flex;
      align-items: center;
      gap: 8px;
      box-shadow: var(--shadow-sm);
    }
    .stat-pill-num {
      font-weight: 800;
      font-size: 1.1rem;
      color: var(--primary);
    }
    .stat-pill-label {
      font-size: 0.85rem;
      color: var(--text-muted);
    }

    /* Filters Bar */
    .filters-section {
      background: var(--bg-surface);
      border-radius: var(--radius-lg);
      padding: 20px;
      margin: 28px 0;
      border: 1px solid var(--border-color);
      box-shadow: var(--shadow-sm);
    }
    .filters-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 14px;
      align-items: end;
    }
    .filter-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .filter-label {
      font-size: 0.82rem;
      font-weight: 700;
      color: var(--text-muted);
    }
    .filter-input, .filter-select {
      width: 100%;
      height: 42px;
      padding: 0 12px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border-color);
      background: var(--bg-page);
      color: var(--text-main);
      font-family: inherit;
      font-size: 0.9rem;
      outline: none;
      transition: border-color 0.15s ease;
    }
    .filter-input:focus, .filter-select:focus {
      border-color: var(--border-focus);
    }
    .price-range-inputs {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .price-range-inputs span {
      color: var(--text-muted);
      font-size: 0.85rem;
    }
    .checkboxes-group {
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
      padding-top: 10px;
      grid-column: 1 / -1;
      border-top: 1px solid var(--border-color);
    }
    .checkbox-label {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 0.88rem;
      cursor: pointer;
      user-select: none;
      font-weight: 600;
    }
    .checkbox-label input[type="checkbox"] {
      width: 18px;
      height: 18px;
      accent-color: var(--primary);
      cursor: pointer;
    }
    .filters-actions {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 16px;
      padding-top: 12px;
      border-top: 1px solid var(--border-color);
    }
    .results-count {
      font-size: 0.9rem;
      font-weight: 700;
      color: var(--text-muted);
    }
    .results-count span {
      color: var(--primary);
    }
    .btn-reset {
      background: transparent;
      border: none;
      color: var(--primary);
      cursor: pointer;
      font-size: 0.85rem;
      font-family: inherit;
      font-weight: 700;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .btn-reset:hover {
      text-decoration: underline;
    }

    /* Products Grid */
    .deals-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(270px, 1fr));
      gap: 20px;
      margin-bottom: 48px;
    }

    /* Deal Card */
    .deal-card {
      background: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-lg);
      overflow: hidden;
      display: flex;
      flex-direction: column;
      transition: transform 0.18s ease, box-shadow 0.18s ease;
      position: relative;
      box-shadow: var(--shadow-sm);
    }
    .deal-card:hover {
      transform: translateY(-3px);
      box-shadow: var(--shadow-md);
      border-color: #cbd5e1;
    }
    .card-media {
      position: relative;
      background: #ffffff;
      padding: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-bottom: 1px solid var(--border-color);
      height: 240px;
    }
    .card-media img {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
      transition: transform 0.2s ease;
    }
    .deal-card:hover .card-media img {
      transform: scale(1.03);
    }
    .card-badges {
      position: absolute;
      top: 10px;
      right: 10px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      align-items: flex-start;
      z-index: 10;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      padding: 4px 8px;
      border-radius: var(--radius-sm);
      font-size: 0.75rem;
      font-weight: 800;
      line-height: 1.2;
    }
    .badge-atl {
      background: var(--badge-atl-bg);
      color: var(--badge-atl-text);
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    .badge-discount {
      background: var(--badge-discount-bg);
      color: var(--badge-discount-text);
    }
    .badge-real {
      background: #ecfdf5;
      color: #065f46;
    }
    .badge-amazon {
      background: #fff8e7;
      color: #b45309;
      border: 1px solid #fde68a;
    }
    .badge-jumia {
      background: #fff7ed;
      color: #ea580c;
      border: 1px solid #fed7aa;
    }
    .btn-jumia {
      background: #f68b1e !important;
    }
    .btn-jumia:hover {
      background: #e07b12 !important;
    }

    .card-body {
      padding: 16px;
      display: flex;
      flex-direction: column;
      flex: 1;
      justify-content: space-between;
      gap: 12px;
    }
    .card-meta {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      font-size: 0.78rem;
      color: var(--text-light);
    }
    .card-category {
      background: var(--bg-surface-secondary);
      padding: 2px 8px;
      border-radius: var(--radius-full);
      max-width: 140px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      color: var(--text-muted);
      font-weight: 600;
    }
    .card-brand {
      font-weight: 700;
      color: var(--text-muted);
    }
    .card-title {
      font-size: 0.95rem;
      font-weight: 700;
      line-height: 1.4;
      color: var(--text-main);
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      min-height: 2.8em;
    }
    .card-pricing {
      display: flex;
      flex-direction: column;
      gap: 4px;
      background: var(--bg-surface-secondary);
      padding: 10px 12px;
      border-radius: var(--radius-md);
    }
    .price-row {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 8px;
    }
    .price-current {
      font-size: 1.35rem;
      font-weight: 900;
      color: var(--accent-orange);
    }
    .price-current small {
      font-size: 0.8rem;
      font-weight: 700;
    }
    .price-typical {
      font-size: 0.82rem;
      color: var(--text-muted);
    }
    .price-typical s {
      color: var(--text-light);
    }
    .unit-price-row {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 0.82rem;
      font-weight: 700;
      color: var(--accent-green);
    }
    .unit-price-row.muted {
      color: var(--text-light);
      font-weight: 500;
    }

    .card-footer {
      margin-top: 4px;
    }
    .btn-buy {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      width: 100%;
      height: 42px;
      background: var(--primary);
      color: #ffffff !important;
      font-weight: 700;
      font-size: 0.9rem;
      border-radius: var(--radius-md);
      transition: background 0.15s ease;
    }
    .btn-buy:hover {
      background: var(--primary-hover);
    }

    /* Empty State */
    .empty-state {
      display: none;
      text-align: center;
      padding: 64px 20px;
      background: var(--bg-surface);
      border-radius: var(--radius-lg);
      border: 1px dashed var(--border-color);
      grid-column: 1 / -1;
    }
    .empty-state svg {
      color: var(--text-light);
      margin-bottom: 12px;
    }
    .empty-state h3 {
      font-size: 1.15rem;
      margin-bottom: 6px;
      color: var(--text-main);
    }
    .empty-state p {
      color: var(--text-muted);
      font-size: 0.9rem;
    }

    /* Footer */
    footer.site-footer {
      background: var(--bg-surface);
      border-top: 1px solid var(--border-color);
      padding: 36px 0;
      margin-top: 48px;
      text-align: center;
      color: var(--text-muted);
      font-size: 0.85rem;
    }
    .footer-disclosure {
      max-width: 650px;
      margin: 12px auto 0;
      font-size: 0.78rem;
      color: var(--text-light);
      line-height: 1.6;
    }

    @media (max-width: 640px) {
      .hero-section {
        padding: 24px 0 16px;
      }
      .deals-grid {
        grid-template-columns: 1fr;
      }
      .card-media {
        height: 200px;
      }
    }
  </style>
</head>
<body>

  <!-- Header -->
  <header class="site-header">
    <div class="container header-inner">
      <a href="index.html" class="brand-logo">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
        <span>عروض مصر</span>
      </a>
      <div style="display: flex; align-items: center; gap: 12px;">
        <a href="brand/index.html" style="font-size: 0.85rem; font-weight: 700; color: var(--primary);">دليل الماركات B2B ↗</a>
        <span class="brand-tag">تحديث يومي تلقائي</span>
      </div>
    </div>
  </header>

  <!-- Hero -->
  <section class="hero-section">
    <div class="container">
      <div class="hero-badge">
        <span>⏰ آخر تحديث:</span>
        <strong>${arabicTime}</strong>
      </div>
      <h1 class="hero-title">
        أفضل عروض النهاردة — <span>${arabicDate}</span>
      </h1>
      <p class="hero-subtitle">
        رصد آلي وتدقيق تاريخي لأسعار أمازون مصر (Amazon Egypt Tez). السعر المعتاد يُمثل متوسط 90 يوماً الفعلي وليس سعر الشطب المعلن.
      </p>

      <div class="stats-pills">
        <div class="stat-pill">
          <span class="stat-pill-num">${qualifiedDeals.length}</span>
          <span class="stat-pill-label">عرض معتمد وموثق</span>
        </div>
        <div class="stat-pill">
          <span class="stat-pill-num">${allTimeLowCount}</span>
          <span class="stat-pill-label">أقل سعر تاريخي 🔥</span>
        </div>
        <div class="stat-pill">
          <span class="stat-pill-num">${withUnitPriceCount}</span>
          <span class="stat-pill-label">مزود بسعر الوحدة ⚖️</span>
        </div>
      </div>
    </div>
  </section>

  <!-- Main Content -->
  <main class="container">
    
    <!-- Filters Bar -->
    <section class="filters-section">
      <div class="filters-grid">
        <!-- Store -->
        <div class="filter-group">
          <label class="filter-label" for="filterStore">المتجر:</label>
          <select id="filterStore" class="filter-select">
            <option value="">جميع المتاجر (الكل)</option>
            <option value="amazon">أمازون مصر 🛒</option>
            <option value="jumia">جوميا مصر 🛍️</option>
          </select>
        </div>

        <!-- Search -->
        <div class="filter-group">
          <label class="filter-label" for="filterSearch">البحث عن منتج أو ماركة:</label>
          <input type="text" id="filterSearch" class="filter-input" placeholder="اكتب اسم المنتج أو الماركة...">
        </div>

        <!-- Category -->
        <div class="filter-group">
          <label class="filter-label" for="filterCategory">القسم:</label>
          <select id="filterCategory" class="filter-select">
            <option value="">جميع الأقسام (${qualifiedDeals.length})</option>
            ${categories.map(([cat, count]) => `<option value="${escapeHtml(cat)}">${escapeHtml(cat)} (${count})</option>`).join('\n')}
          </select>
        </div>

        <!-- Historical Discount -->
        <div class="filter-group">
          <label class="filter-label" for="filterDiscount">نسبة الخصم التاريخي:</label>
          <select id="filterDiscount" class="filter-select">
            <option value="0">كل العروض</option>
            <option value="10">خصم 10% فأكثر</option>
            <option value="15">خصم 15% فأكثر</option>
            <option value="20">خصم 20% فأكثر</option>
            <option value="30">خصم 30% فأكثر 🔥</option>
          </select>
        </div>

        <!-- Price Range -->
        <div class="filter-group">
          <label class="filter-label">نطاق السعر (ج.م):</label>
          <div class="price-range-inputs">
            <input type="number" id="filterMinPrice" class="filter-input" placeholder="من 0" min="0">
            <span>إلى</span>
            <input type="number" id="filterMaxPrice" class="filter-input" placeholder="${maxPrice}" min="0">
          </div>
        </div>

        <!-- Sort By -->
        <div class="filter-group">
          <label class="filter-label" for="filterSort">الترتيب حسب:</label>
          <select id="filterSort" class="filter-select">
            <option value="discount-desc">أعلى خصم تاريخي (الافتراضي)</option>
            <option value="price-asc">السعر: من الأقل للأعلى</option>
            <option value="price-desc">السعر: من الأعلى للأقل</option>
            <option value="unit-price-asc">سعر الوحدة: الأرخص أولاً</option>
          </select>
        </div>

        <!-- Checkboxes -->
        <div class="checkboxes-group">
          <label class="checkbox-label">
            <input type="checkbox" id="filterAllTimeLow">
            <span>🔥 أقل سعر تاريخي فقط</span>
          </label>
          <label class="checkbox-label">
            <input type="checkbox" id="filterHasUnitPrice">
            <span>⚖️ يحتوي على سعر وحدة للمقارنة</span>
          </label>
        </div>
      </div>

      <div class="filters-actions">
        <div class="results-count">
          يتم عرض <span id="visibleCount">${qualifiedDeals.length}</span> من أصل <span>${qualifiedDeals.length}</span> عرض
        </div>
        <button type="button" id="btnResetFilters" class="btn-reset">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
          إعادة ضبط الفلاتر
        </button>
      </div>
    </section>

    <!-- Deals Grid -->
    <div id="dealsGrid" class="deals-grid">
      ${cardsHtml}

      <!-- Empty state: distinct copy for "no verified deals yet" vs "filters matched nothing" -->
      <div id="emptyState" class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        ${qualifiedDeals.length === 0 ? `
        <h3>⏳ لسه بنجمع بيانات الأسعار</h3>
        <p>مفيش عروض مؤكدة قبل مرور 7 أيام و5 لقطات سعرية حقيقية لكل منتج. بنراقب الأسعار كل 6 ساعات — ارجع قريب.</p>
        ` : `
        <h3>لا توجد عروض مطابقة للفلاتر المختارة</h3>
        <p>جرب تقليل الفلاتر أو إعادة ضبط البحث لعرض المزيد من المنتجات.</p>
        `}
      </div>
    </div>

  </main>

  <!-- Footer -->
  <footer class="site-footer">
    <div class="container">
      <p>جميع الأسعار والعروض يتم رصدها وتحديثها آلياً من أمازون مصر (Amazon Egypt Tez).</p>
      <p class="footer-disclosure">
        إخلاء مسؤولية الإحالة: بصفتنا مشاركين في برنامج Amazon Associates، قد نحصل على عمولة صغيرة مقابل عمليات الشراء المؤهلة عبر الروابط المرفقة دون أي تكلفة إضافية عليك.
      </p>
    </div>
  </footer>

  <!-- Instant Client-Side Filter & Sort Logic (Vanilla JS, Zero Frameworks) -->
  <script>
    (function() {
      const storeSelect = document.getElementById('filterStore');
      const searchInput = document.getElementById('filterSearch');
      const categorySelect = document.getElementById('filterCategory');
      const discountSelect = document.getElementById('filterDiscount');
      const minPriceInput = document.getElementById('filterMinPrice');
      const maxPriceInput = document.getElementById('filterMaxPrice');
      const allTimeLowCheck = document.getElementById('filterAllTimeLow');
      const hasUnitPriceCheck = document.getElementById('filterHasUnitPrice');
      const sortSelect = document.getElementById('filterSort');
      const btnReset = document.getElementById('btnResetFilters');
      const visibleCountEl = document.getElementById('visibleCount');
      const grid = document.getElementById('dealsGrid');
      const emptyState = document.getElementById('emptyState');
      const cards = Array.from(grid.querySelectorAll('.deal-card'));

      function applyFilters() {
        const selectedStore = storeSelect ? storeSelect.value : '';
        const query = searchInput.value.trim().toLowerCase();
        const selectedCat = categorySelect.value;
        const minDiscount = parseFloat(discountSelect.value) || 0;
        const minPrice = parseFloat(minPriceInput.value) || 0;
        const maxPrice = parseFloat(maxPriceInput.value) || Infinity;
        const atlOnly = allTimeLowCheck.checked;
        const unitPriceOnly = hasUnitPriceCheck.checked;

        let visibleCount = 0;

        cards.forEach(card => {
          const title = (card.querySelector('.card-title')?.textContent || '').toLowerCase();
          const brand = (card.dataset.brand || '').toLowerCase();
          const category = card.dataset.category || '';
          const price = parseFloat(card.dataset.price) || 0;
          const discount = parseFloat(card.dataset.discount) || 0;
          const isAtl = card.dataset.allTimeLow === '1';
          const hasUnit = card.dataset.hasUnitPrice === '1';

          let matches = true;

          // Store filter
          if (selectedStore && (card.dataset.store || 'amazon') !== selectedStore) {
            matches = false;
          }

          // Keyword search
          if (query && !title.includes(query) && !brand.includes(query)) {
            matches = false;
          }

          // Category filter
          if (matches && selectedCat && category !== selectedCat) {
            matches = false;
          }

          // Historical Discount filter
          if (matches && minDiscount > 0 && discount < minDiscount) {
            matches = false;
          }

          // Price range filter
          if (matches && (price < minPrice || price > maxPrice)) {
            matches = false;
          }

          // All-time low filter
          if (matches && atlOnly && !isAtl) {
            matches = false;
          }

          // Unit price filter
          if (matches && unitPriceOnly && !hasUnit) {
            matches = false;
          }

          if (matches) {
            card.style.display = '';
            visibleCount++;
          } else {
            card.style.display = 'none';
          }
        });

        visibleCountEl.textContent = visibleCount;
        if (visibleCount === 0) {
          emptyState.style.display = 'block';
        } else {
          emptyState.style.display = 'none';
        }
      }

      function applySort() {
        const sortMode = sortSelect.value;

        cards.sort((a, b) => {
          const priceA = parseFloat(a.dataset.price) || 0;
          const priceB = parseFloat(b.dataset.price) || 0;
          const discA = parseFloat(a.dataset.discount) || 0;
          const discB = parseFloat(b.dataset.discount) || 0;
          const unitA = parseFloat(a.dataset.unitPrice) || 999999;
          const unitB = parseFloat(b.dataset.unitPrice) || 999999;

          if (sortMode === 'discount-desc') {
            return discB - discA;
          } else if (sortMode === 'price-asc') {
            return priceA - priceB;
          } else if (sortMode === 'price-desc') {
            return priceB - priceA;
          } else if (sortMode === 'unit-price-asc') {
            return unitA - unitB;
          }
          return 0;
        });

        cards.forEach(card => {
          grid.appendChild(card);
        });
        grid.appendChild(emptyState);
      }

      function handleFilterChange() {
        applyFilters();
      }

      function handleSortChange() {
        applySort();
      }

      // Attach event listeners
      if (storeSelect) storeSelect.addEventListener('change', handleFilterChange);
      searchInput.addEventListener('input', handleFilterChange);
      categorySelect.addEventListener('change', handleFilterChange);
      discountSelect.addEventListener('change', handleFilterChange);
      minPriceInput.addEventListener('input', handleFilterChange);
      maxPriceInput.addEventListener('input', handleFilterChange);
      allTimeLowCheck.addEventListener('change', handleFilterChange);
      hasUnitPriceCheck.addEventListener('change', handleFilterChange);
      sortSelect.addEventListener('change', handleSortChange);

      btnReset.addEventListener('click', () => {
        if (storeSelect) storeSelect.value = '';
        searchInput.value = '';
        categorySelect.value = '';
        discountSelect.value = '0';
        minPriceInput.value = '';
        maxPriceInput.value = '';
        allTimeLowCheck.checked = false;
        hasUnitPriceCheck.checked = false;
        sortSelect.value = 'discount-desc';
        applySort();
        applyFilters();
      });

    })();
  </script>

</body>
</html>
`;

  const outputPath = path.join(distDir, 'index.html');
  fs.writeFileSync(outputPath, html, 'utf-8');
  const sizeBytes = fs.statSync(outputPath).size;
  const sizeKb = (sizeBytes / 1024).toFixed(1);
  const duration = Date.now() - startTime;

  console.log(`[✔] Generated ${outputPath} (${sizeKb} KB, ${qualifiedDeals.length} deals in ${duration}ms)`);

  return {
    outputPath,
    totalDeals: qualifiedDeals.length,
    sizeBytes,
    sizeKb,
    durationMs: duration
  };
}

if (require.main === module) {
  buildDealsPage();
}

module.exports = { buildDealsPage };
