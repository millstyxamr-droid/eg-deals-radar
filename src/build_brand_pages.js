/**
 * Amazon Egypt Tez Scraper - Brand Pages Generator for B2B Sourcing
 * Generates /dist/brand/<slug>/index.html for every brand with products sorted by Unit Price.
 * Also generates /dist/brand/index.html (Brand Directory).
 */

const fs = require('fs');
const path = require('path');
const repo = require('./repo');
const { extractBrand } = require('./normalize');
const { withAffiliate, getAffiliateTag } = require('./affiliate');

/**
 * Escapes HTML entities
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
 * Creates a clean, safe URL slug from a brand name
 */
function createBrandSlug(brandName) {
  if (!brandName || typeof brandName !== 'string') return 'other';
  return brandName
    .trim()
    .toLowerCase()
    .replace(/[^\w\u0600-\u06FF\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'brand';
}

/**
 * Main builder for brand pages
 */
function buildBrandPages(options = {}) {
  const startTime = Date.now();
  const distDir = options.distDir || path.join(__dirname, '..', 'dist');
  const brandsDir = path.join(distDir, 'brand');

  if (!fs.existsSync(brandsDir)) {
    fs.mkdirSync(brandsDir, { recursive: true });
  }

  console.log('[*] Loading products from database for brand B2B catalog...');
  const allProducts = repo.getProductsForExport();
  const affiliateTag = getAffiliateTag();

  // Group products by brand
  const brandsMap = new Map();

  for (const prod of allProducts) {
    if (!prod.currentPriceNum || prod.currentPriceNum <= 0) continue;
    if (!prod.imgSrc) continue;

    let brand = prod.brand;
    if (!brand || !brand.trim()) {
      brand = extractBrand(prod.title);
    }

    if (!brand || !brand.trim()) {
      continue;
    }

    const trimmedBrand = brand.trim();
    if (!brandsMap.has(trimmedBrand)) {
      brandsMap.set(trimmedBrand, []);
    }
    brandsMap.get(trimmedBrand).push(prod);
  }

  const brandNames = Array.from(brandsMap.keys()).sort((a, b) => a.localeCompare(b, 'ar'));
  console.log(`Found ${brandNames.length} distinct brands with valid products.`);

  let totalPagesGenerated = 0;
  const brandDirectoryList = [];

  for (const brand of brandNames) {
    const products = brandsMap.get(brand);
    const slug = createBrandSlug(brand);
    const brandFolder = path.join(brandsDir, slug);

    if (!fs.existsSync(brandFolder)) {
      fs.mkdirSync(brandFolder, { recursive: true });
    }

    // Sort products by unit price ascending (B2B wholesale preference: cheapest unit price first)
    products.sort((a, b) => {
      const unitA = (a.unit_price !== null && a.unit_price !== undefined) ? a.unit_price : 999999;
      const unitB = (b.unit_price !== null && b.unit_price !== undefined) ? b.unit_price : 999999;
      if (unitA !== unitB) return unitA - unitB;
      return (a.currentPriceNum || 0) - (b.currentPriceNum || 0);
    });

    // Compute brand metrics
    const prices = products.map(p => p.currentPriceNum).filter(p => p > 0);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const avgPrice = +(prices.reduce((sum, p) => sum + p, 0) / prices.length).toFixed(2);
    const productsWithUnitPrice = products.filter(p => p.unit_price && p.unit_price_unit);
    const lowestUnitPrice = productsWithUnitPrice.length > 0
      ? productsWithUnitPrice[0].unit_price_formatted
      : null;

    brandDirectoryList.push({
      brand,
      slug,
      productCount: products.length,
      minPrice,
      maxPrice,
      avgPrice,
      lowestUnitPrice,
      sampleImage: products[0].imgSrc
    });

    // Product cards for this brand
    const cardsHtml = products.map(prod => {
      const affiliateUrl = withAffiliate(prod.productUrl, 'b2b_brand_' + slug, affiliateTag);
      const hasUnitPrice = Boolean(prod.unit_price && prod.unit_price_unit);

      return `
        <article class="brand-product-card" data-price="${prod.currentPriceNum}" data-unit-price="${prod.unit_price || 999999}">
          <div class="card-media">
            <img src="${escapeHtml(prod.imgSrc)}" alt="${escapeHtml(prod.title)}" loading="lazy" width="200" height="200">
            ${prod.all_time_low ? '<span class="badge badge-atl">أقل سعر تاريخي</span>' : ''}
            ${prod.historical_discount_pct > 0 ? `<span class="badge badge-discount">-${prod.historical_discount_pct}%</span>` : ''}
          </div>
          <div class="card-content">
            <span class="product-category">${escapeHtml(prod.category || 'أخرى')}</span>
            <h3 class="product-title" title="${escapeHtml(prod.title)}">${escapeHtml(prod.title)}</h3>
            
            <div class="product-pricing">
              <div class="price-main">
                <span class="price-val">${prod.currentPriceNum.toFixed(2)} <small>ج.م</small></span>
                ${prod.typical_price && prod.typical_price > prod.currentPriceNum ? `
                  <span class="price-typical">المعتاد: <s>${prod.typical_price.toFixed(2)} ج.م</s></span>
                ` : ''}
              </div>

              ${hasUnitPrice ? `
                <div class="unit-price-highlight" title="سعر الوحدة القياسي لمقارنة توريدات الشركات">
                  <span class="unit-icon">⚖️ سعر الوحدة:</span>
                  <strong>${escapeHtml(prod.unit_price_formatted)}</strong>
                </div>
              ` : `
                <div class="unit-price-highlight muted">
                  <span>سعر الوحدة غير محدد</span>
                </div>
              `}
            </div>

            <div class="card-actions">
              <a href="${escapeHtml(affiliateUrl)}" target="_blank" rel="noopener noreferrer sponsored" class="btn-buy-brand">
                <span>طلب من أمازون</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
              </a>
            </div>
          </div>
        </article>
      `;
    }).join('\n');

    const brandHtml = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>عروض وأسعار منتجات ${escapeHtml(brand)} | مقارنة سعر الوحدة B2B</title>
  <meta name="description" content="قائمة شاملة بجميع منتجات ومستلزمات ماركة ${escapeHtml(brand)} على أمازون مصر مرتبة تصاعدياً بسعر الوحدة القياسي لتسهيل التوريدات والمشتريات.">
  <link rel="canonical" href="https://deals.amazoneg.example.com/brand/${escapeHtml(slug)}/">
  <style>
    :root {
      --font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Cairo", "Noto Sans Arabic", Tahoma, sans-serif;
      --bg-page: #f8fafc;
      --bg-surface: #ffffff;
      --bg-surface-secondary: #f1f5f9;
      --text-main: #0f172a;
      --text-muted: #64748b;
      --border-color: #e2e8f0;
      --primary: #2563eb;
      --accent-green: #16a34a;
      --accent-orange: #ea580c;
      --radius-md: 10px;
      --radius-lg: 16px;
      --shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.05);
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg-page: #0f172a;
        --bg-surface: #1e293b;
        --bg-surface-secondary: #334155;
        --text-main: #f8fafc;
        --text-muted: #94a3b8;
        --border-color: #334155;
        --primary: #3b82f6;
      }
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: var(--font-family); background: var(--bg-page); color: var(--text-main); direction: rtl; line-height: 1.5; }
    .container { max-width: 1200px; margin: 0 auto; padding: 0 16px; }
    header.site-header { background: var(--bg-surface); border-bottom: 1px solid var(--border-color); padding: 14px 0; }
    .nav-links { display: flex; align-items: center; gap: 12px; font-size: 0.88rem; }
    .nav-links a { color: var(--primary); font-weight: 700; text-decoration: none; }
    .breadcrumb { font-size: 0.85rem; color: var(--text-muted); margin: 20px 0 10px; }
    .breadcrumb a { color: var(--primary); text-decoration: none; }
    .brand-hero { background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: var(--radius-lg); padding: 24px; margin-bottom: 24px; box-shadow: var(--shadow-sm); }
    .brand-header-flex { display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 16px; }
    .brand-title { font-size: 1.8rem; font-weight: 800; }
    .brand-stats { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 14px; }
    .brand-stat-tag { background: var(--bg-surface-secondary); padding: 6px 12px; border-radius: 8px; font-size: 0.85rem; font-weight: 700; }
    .brand-stat-tag strong { color: var(--primary); }
    .products-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 18px; margin-bottom: 40px; }
    .brand-product-card { background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: var(--radius-lg); overflow: hidden; display: flex; flex-direction: column; box-shadow: var(--shadow-sm); }
    .card-media { background: #ffffff; padding: 16px; height: 210px; display: flex; align-items: center; justify-content: center; position: relative; border-bottom: 1px solid var(--border-color); }
    .card-media img { max-width: 100%; max-height: 100%; object-fit: contain; }
    .badge { position: absolute; top: 10px; right: 10px; padding: 3px 8px; border-radius: 6px; font-size: 0.75rem; font-weight: 800; }
    .badge-atl { background: #fee2e2; color: #991b1b; }
    .badge-discount { background: #fef2f2; color: #b91c1c; top: 38px; }
    .card-content { padding: 14px; display: flex; flex-direction: column; flex: 1; justify-content: space-between; gap: 10px; }
    .product-category { font-size: 0.75rem; color: var(--text-muted); background: var(--bg-surface-secondary); padding: 2px 8px; border-radius: 999px; align-self: flex-start; }
    .product-title { font-size: 0.9rem; font-weight: 700; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; min-height: 2.6em; }
    .product-pricing { background: var(--bg-surface-secondary); padding: 8px 12px; border-radius: var(--radius-md); }
    .price-main { display: flex; justify-content: space-between; align-items: baseline; }
    .price-val { font-size: 1.25rem; font-weight: 800; color: var(--accent-orange); }
    .price-typical { font-size: 0.78rem; color: var(--text-muted); }
    .unit-price-highlight { margin-top: 4px; font-size: 0.84rem; color: var(--accent-green); font-weight: 700; }
    .unit-price-highlight.muted { color: var(--text-muted); font-weight: 500; font-size: 0.78rem; }
    .btn-buy-brand { display: flex; align-items: center; justify-content: center; gap: 6px; height: 38px; background: var(--primary); color: #fff !important; text-decoration: none; border-radius: var(--radius-md); font-weight: 700; font-size: 0.88rem; }
    .btn-buy-brand:hover { opacity: 0.95; }
  </style>
</head>
<body>
  <header class="site-header">
    <div class="container nav-links">
      <a href="../../index.html">← الرئيسية (أفضل العروض)</a>
      <span style="color: var(--border-color);">|</span>
      <a href="../index.html">دليل الماركات B2B</a>
    </div>
  </header>

  <main class="container">
    <div class="breadcrumb">
      <a href="../../index.html">الرئيسية</a> &gt;
      <a href="../index.html">الماركات</a> &gt;
      <span>${escapeHtml(brand)}</span>
    </div>

    <section class="brand-hero">
      <div class="brand-header-flex">
        <div>
          <h1 class="brand-title">منتجات ${escapeHtml(brand)}</h1>
          <p style="color: var(--text-muted); font-size: 0.9rem; margin-top: 4px;">
            جميع منتجات ماركة ${escapeHtml(brand)} مرتبة تصاعدياً بسعر الوحدة القياسي لمساعدة أصحاب الأعمال في المقارنة الذكية.
          </p>
        </div>
      </div>

      <div class="brand-stats">
        <span class="brand-stat-tag">عدد المنتجات: <strong>${products.length}</strong></span>
        ${lowestUnitPrice ? `<span class="brand-stat-tag">أرخص سعر وحدة: <strong>${escapeHtml(lowestUnitPrice)}</strong></span>` : ''}
        <span class="brand-stat-tag">متوسط السعر: <strong>${avgPrice} ج.م</strong></span>
        <span class="brand-stat-tag">نطاق الأسعار: <strong>${minPrice} - ${maxPrice} ج.م</strong></span>
      </div>
    </section>

    <div class="products-grid">
      ${cardsHtml}
    </div>
  </main>
</body>
</html>
`;

    const brandFile = path.join(brandFolder, 'index.html');
    fs.writeFileSync(brandFile, brandHtml, 'utf-8');

    // Also write dist/brand/<slug>.html as an alias
    const aliasFile = path.join(brandsDir, `${slug}.html`);
    fs.writeFileSync(aliasFile, brandHtml, 'utf-8');

    totalPagesGenerated++;
  }

  // Generate /dist/brand/index.html (Brand Directory)
  brandDirectoryList.sort((a, b) => b.productCount - a.productCount);

  const directoryCards = brandDirectoryList.map(b => `
    <a href="${escapeHtml(b.slug)}/index.html" class="dir-card">
      <div class="dir-img">
        <img src="${escapeHtml(b.sampleImage)}" alt="${escapeHtml(b.brand)}" loading="lazy">
      </div>
      <div class="dir-info">
        <h3>${escapeHtml(b.brand)}</h3>
        <p class="dir-meta">${b.productCount} منتج متوفر</p>
        ${b.lowestUnitPrice ? `<p class="dir-unit">يبدأ من: <strong>${escapeHtml(b.lowestUnitPrice)}</strong></p>` : ''}
        <span class="dir-link">تصفح الأسعار والتوريدات ←</span>
      </div>
    </a>
  `).join('\n');

  const directoryHtml = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>دليل الماركات والشركات B2B | مقارنة أسعار التوريد ووحدة القياس</title>
  <meta name="description" content="تصفح دليل ماركات وشركات أمازون مصر للمشتريات والتوريدات. مقارنة المنتجات بسعر الوحدة القياسي.">
  <link rel="canonical" href="https://deals.amazoneg.example.com/brand/">
  <style>
    :root {
      --font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Cairo", "Noto Sans Arabic", Tahoma, sans-serif;
      --bg-page: #f8fafc;
      --bg-surface: #ffffff;
      --bg-surface-secondary: #f1f5f9;
      --text-main: #0f172a;
      --text-muted: #64748b;
      --border-color: #e2e8f0;
      --primary: #2563eb;
      --radius-lg: 14px;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg-page: #0f172a;
        --bg-surface: #1e293b;
        --bg-surface-secondary: #334155;
        --text-main: #f8fafc;
        --text-muted: #94a3b8;
        --border-color: #334155;
        --primary: #3b82f6;
      }
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: var(--font-family); background: var(--bg-page); color: var(--text-main); direction: rtl; }
    .container { max-width: 1200px; margin: 0 auto; padding: 24px 16px; }
    .top-nav { margin-bottom: 24px; }
    .top-nav a { color: var(--primary); text-decoration: none; font-weight: 700; font-size: 0.9rem; }
    .dir-hero { text-align: center; margin-bottom: 36px; }
    .dir-hero h1 { font-size: 2rem; font-weight: 900; margin-bottom: 8px; }
    .dir-hero p { color: var(--text-muted); font-size: 1rem; max-width: 600px; margin: 0 auto; }
    .dir-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 18px; }
    .dir-card { background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: var(--radius-lg); padding: 18px; text-decoration: none; color: inherit; display: flex; gap: 14px; align-items: center; transition: transform 0.15s ease, box-shadow 0.15s ease; }
    .dir-card:hover { transform: translateY(-3px); box-shadow: 0 4px 12px rgba(0,0,0,0.08); border-color: var(--primary); }
    .dir-img { width: 64px; height: 64px; border-radius: 8px; background: #fff; display: flex; align-items: center; justify-content: center; flex-shrink: 0; border: 1px solid var(--border-color); overflow: hidden; }
    .dir-img img { max-width: 100%; max-height: 100%; object-fit: contain; }
    .dir-info h3 { font-size: 1.05rem; font-weight: 800; margin-bottom: 4px; }
    .dir-meta { font-size: 0.8rem; color: var(--text-muted); }
    .dir-unit { font-size: 0.78rem; color: #16a34a; margin-top: 2px; }
    .dir-link { font-size: 0.78rem; color: var(--primary); font-weight: 700; margin-top: 6px; display: block; }
  </style>
</head>
<body>
  <div class="container">
    <div class="top-nav">
      <a href="../index.html">← العودة إلى أفضل العروض اليومية</a>
    </div>

    <section class="dir-hero">
      <h1>دليل الماركات وتوريدات B2B</h1>
      <p>تصفح منتجات كل علامة تجارية ومقارنة أسعار الوحدة القياسية لتحديد الشراء الأوفر لشركتك أو منزلك.</p>
    </section>

    <div class="dir-grid">
      ${directoryCards}
    </div>
  </div>
</body>
</html>
`;

  const directoryFile = path.join(brandsDir, 'index.html');
  fs.writeFileSync(directoryFile, directoryHtml, 'utf-8');

  const duration = Date.now() - startTime;
  console.log(`[✔] Generated ${totalPagesGenerated} brand pages and brand directory at ${brandsDir} in ${duration}ms.`);

  return {
    totalBrands: totalPagesGenerated,
    brandsDir,
    durationMs: duration
  };
}

if (require.main === module) {
  buildBrandPages();
}

module.exports = { buildBrandPages, createBrandSlug };
