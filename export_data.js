const fs = require('fs');
const path = require('path');
const repo = require('./src/repo');

const watchlistPath = path.join(__dirname, 'watchlist.json');
let watchlist = [];
if (fs.existsSync(watchlistPath)) {
  try {
    watchlist = JSON.parse(fs.readFileSync(watchlistPath, 'utf-8'));
  } catch (e) {}
}

// Read products directly from SQLite database via repo, with fallback to products.json
let products = [];
try {
  products = repo.getProductsForExport();
  if (!products || products.length === 0) {
    const dataPath = path.join(__dirname, 'products.json');
    if (fs.existsSync(dataPath)) {
      products = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
    }
  }
} catch (e) {
  const dataPath = path.join(__dirname, 'products.json');
  if (fs.existsSync(dataPath)) {
    products = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
  }
}

// 1. Generate CSV with UTF-8 BOM for Excel including Deal Analysis, Unit Pricing & Brand/Size
function generateCSV(items) {
  const headers = [
    'ASIN',
    'Product Name',
    'Category',
    'Brand',
    'Weight Value',
    'Weight Unit',
    'Size Text',
    'Current Price (EGP)',
    'Unit Price (سعر الوحدة)',
    'Typical Price (السعر المعتاد)',
    'Advertised Old Price (سعر أمازون المعلن)',
    'Historical Discount (%)',
    'Advertised Discount (%)',
    'Is Real Deal (عرض حقيقي)',
    'Confidence (درجة الثقة)',
    'All Time Low (أقل سعر تاريخي)',
    'Product Link',
    'Image Link'
  ];

  const rows = items.map(p => [
    p.asin,
    `"${(p.title || '').replace(/"/g, '""')}"`,
    `"${(p.category || '').replace(/"/g, '""')}"`,
    `"${(p.brand || '').replace(/"/g, '""')}"`,
    p.weight_value !== null && p.weight_value !== undefined ? p.weight_value : '',
    p.weight_unit || '',
    `"${(p.size_text || '').replace(/"/g, '""')}"`,
    p.currentPriceNum !== null ? p.currentPriceNum : '',
    `"${p.unit_price_formatted || '—'}"`,
    p.typical_price !== null && p.typical_price !== undefined ? p.typical_price : '',
    p.oldPriceNum !== null && p.oldPriceNum !== undefined ? p.oldPriceNum : '',
    p.historical_discount_pct !== null && p.historical_discount_pct !== undefined ? `${p.historical_discount_pct}%` : 'لسه بنجمع بيانات',
    p.advertised_discount_pct ? `${p.advertised_discount_pct}%` : '',
    p.is_real_deal ? 'نعم (عرض حقيقي)' : 'لا',
    p.confidence || 'low',
    p.all_time_low ? 'نعم' : 'لا',
    `"${p.productUrl}"`,
    `"${p.imgSrc}"`
  ]);

  const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n');
  const csvPath = path.join(__dirname, 'amazon_tez_products.csv');
  fs.writeFileSync(csvPath, csvContent, 'utf-8');
  console.log(`Saved CSV with Deals, Brands & Sizes: ${csvPath}`);
}

// 2. Generate XML Spreadsheet with native Excel styling, Unit Price, Brand, Size & Historical Deals
function generateExcelXML(items) {
  const xmlRows = items.map(p => `
    <Row>
      <Cell><Data ss:Type="String">${escapeXml(p.asin)}</Data></Cell>
      <Cell><Data ss:Type="String">${escapeXml(p.title)}</Data></Cell>
      <Cell><Data ss:Type="String">${escapeXml(p.category)}</Data></Cell>
      <Cell><Data ss:Type="String">${escapeXml(p.brand || '—')}</Data></Cell>
      <Cell><Data ss:Type="String">${escapeXml(p.size_text || '—')}</Data></Cell>
      <Cell ss:StyleID="CurrentPrice"><Data ss:Type="Number">${p.currentPriceNum ?? 0}</Data></Cell>
      <Cell ss:StyleID="Default"><Data ss:Type="String">${escapeXml(p.unit_price_formatted || '—')}</Data></Cell>
      <Cell ss:StyleID="Currency"><Data ss:Type="${p.typical_price ? 'Number' : 'String'}">${p.typical_price ?? '-'}</Data></Cell>
      <Cell ss:StyleID="Currency"><Data ss:Type="${p.oldPriceNum ? 'Number' : 'String'}">${p.oldPriceNum ?? '-'}</Data></Cell>
      <Cell ss:StyleID="${p.historical_discount_pct > 0 ? 'DiscountCell' : 'Default'}"><Data ss:Type="String">${p.historical_discount_pct !== null && p.historical_discount_pct !== undefined ? `${p.historical_discount_pct}%` : 'لسه بنجمع بيانات'}</Data></Cell>
      <Cell ss:StyleID="${p.is_real_deal ? 'SavedCell' : 'Default'}"><Data ss:Type="String">${p.is_real_deal ? '🔥 عرض حقيقي' : 'سعر عادي'}</Data></Cell>
      <Cell ss:Formula="=HYPERLINK(&quot;${escapeXml(p.productUrl)}&quot;,&quot;عرض على أمازون&quot;)"><Data ss:Type="String">عرض على أمازون</Data></Cell>
    </Row>`).join('\n');

  const xmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal">
   <Alignment ss:Vertical="Center"/>
   <Borders/>
   <Font ss:FontName="Segoe UI" ss:Size="10"/>
   <Interior/>
   <NumberFormat/>
   <Protection/>
  </Style>
  <Style ss:ID="Header">
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="2" ss:Color="#232F3E"/>
   </Borders>
   <Font ss:FontName="Segoe UI" ss:Size="11" ss:Bold="1" ss:Color="#FFFFFF"/>
   <Interior ss:Color="#232F3E" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="CurrentPrice">
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
   <Font ss:FontName="Segoe UI" ss:Size="10" ss:Bold="1" ss:Color="#111111"/>
   <NumberFormat ss:Format="#,##0.00 &quot;EGP&quot;"/>
  </Style>
  <Style ss:ID="Currency">
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
   <NumberFormat ss:Format="#,##0.00 &quot;EGP&quot;"/>
  </Style>
  <Style ss:ID="DiscountCell">
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
   <Font ss:FontName="Segoe UI" ss:Size="10" ss:Bold="1" ss:Color="#B12704"/>
   <Interior ss:Color="#FFF0F0" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="SavedCell">
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
   <Font ss:FontName="Segoe UI" ss:Size="10" ss:Bold="1" ss:Color="#007600"/>
   <Interior ss:Color="#F0FFF0" ss:Pattern="Solid"/>
  </Style>
 </Styles>
 <Worksheet ss:Name="عروض ومنتجات أمازون مصر">
  <Table ss:DefaultRowHeight="24">
   <Column ss:Width="105"/>
   <Column ss:Width="300"/>
   <Column ss:Width="130"/>
   <Column ss:Width="110"/>
   <Column ss:Width="115"/>
   <Column ss:Width="110"/>
   <Column ss:Width="110"/>
   <Column ss:Width="120"/>
   <Column ss:Width="110"/>
   <Column ss:Width="120"/>
   <Row ss:Height="28">
    <Cell ss:StyleID="Header"><Data ss:Type="String">ASIN</Data></Cell>
    <Cell ss:StyleID="Header"><Data ss:Type="String">اسم المنتج</Data></Cell>
    <Cell ss:StyleID="Header"><Data ss:Type="String">القسم</Data></Cell>
    <Cell ss:StyleID="Header"><Data ss:Type="String">البراند</Data></Cell>
    <Cell ss:StyleID="Header"><Data ss:Type="String">الحجم / الوزن</Data></Cell>
    <Cell ss:StyleID="Header"><Data ss:Type="String">السعر الحالي</Data></Cell>
    <Cell ss:StyleID="Header"><Data ss:Type="String">سعر الوحدة</Data></Cell>
    <Cell ss:StyleID="Header"><Data ss:Type="String">السعر المعتاد</Data></Cell>
    <Cell ss:StyleID="Header"><Data ss:Type="String">سعر أمازون المعلن</Data></Cell>
    <Cell ss:StyleID="Header"><Data ss:Type="String">الخصم التاريخي</Data></Cell>
    <Cell ss:StyleID="Header"><Data ss:Type="String">التقييم</Data></Cell>
    <Cell ss:StyleID="Header"><Data ss:Type="String">رابط المنتج</Data></Cell>
   </Row>
   ${xmlRows}
  </Table>
 </Worksheet>
</Workbook>`;

  const xlsPath = path.join(__dirname, 'amazon_tez_products.xls');
  fs.writeFileSync(xlsPath, xmlContent, 'utf-8');
  console.log(`Saved Excel XLS with Deals & Unit Prices: ${xlsPath}`);
}

function escapeXml(unsafe) {
  if (!unsafe) return '';
  return String(unsafe).replace(/[<>&'"]/g, c => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
    }
  });
}

// 3. Generate HTML Dashboard with Deals Radar & Deal Badges
function generateHTML(items, watchlistData = []) {
  const categories = [...new Set(items.map(p => p.category))];
  const totalDeals = items.filter(p => p.isRealDeal).length;
  const topDeal = [...items].sort((a, b) => (b.realDiscountPct || 0) - (a.realDiscountPct || 0))[0];
  const maxSavings = [...items].sort((a, b) => (b.egpSaved || 0) - (a.egpSaved || 0))[0];
  const itemsJson = JSON.stringify(items);
  const watchlistJson = JSON.stringify(watchlistData);

  const htmlContent = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>رادار كشف عروض أمازون مصر (Amazon Egypt Deals Radar)</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&display=swap" rel="stylesheet">
  <style>
    :root {
      --primary: #FF9900;
      --secondary: #146EB4;
      --dark: #131921;
      --light-dark: #232f3e;
      --bg: #f5f7fa;
      --card-bg: #ffffff;
      --text: #212529;
      --muted: #6c757d;
      --border: #e2e8f0;
      --deal-red: #cc0c39;
      --deal-green: #007600;
      --highlight: #fff8e7;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      font-family: 'Cairo', sans-serif;
    }

    body {
      background-color: var(--bg);
      color: var(--text);
      line-height: 1.6;
      padding-bottom: 60px;
    }

    header {
      background: linear-gradient(135deg, var(--dark) 0%, var(--light-dark) 100%);
      color: white;
      padding: 24px 20px 20px;
      box-shadow: 0 4px 15px rgba(0,0,0,0.12);
    }

    .container {
      max-width: 1300px;
      margin: 0 auto;
      padding: 0 16px;
    }

    .header-content {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
    }

    .logo-title h1 {
      font-size: 1.65rem;
      font-weight: 900;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .badge-radar {
      background: linear-gradient(45deg, #FF512F, #DD2476);
      color: white;
      font-size: 0.8rem;
      padding: 4px 10px;
      border-radius: 20px;
      font-weight: 800;
      letter-spacing: 0.5px;
      animation: pulse 2s infinite;
    }

    @keyframes pulse {
      0% { box-shadow: 0 0 0 0 rgba(221, 36, 118, 0.7); }
      70% { box-shadow: 0 0 0 10px rgba(221, 36, 118, 0); }
      100% { box-shadow: 0 0 0 0 rgba(221, 36, 118, 0); }
    }

    .header-stats {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
    }

    .stat-pill {
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 10px;
      padding: 8px 16px;
      text-align: center;
    }

    .stat-pill .num {
      font-size: 1.25rem;
      font-weight: 800;
      color: var(--primary);
    }

    .stat-pill .label {
      font-size: 0.75rem;
      color: #ddd;
    }

    .actions-bar {
      margin-top: 18px;
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: center;
    }

    .btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 16px;
      border-radius: 8px;
      font-size: 0.9rem;
      font-weight: 700;
      cursor: pointer;
      text-decoration: none;
      transition: all 0.2s;
      border: none;
    }

    .btn-excel { background: #107C41; color: white; }
    .btn-excel:hover { background: #0c6133; }
    .btn-csv { background: var(--secondary); color: white; }
    .btn-csv:hover { background: #0c548a; }

    /* Deals Radar Highlight Bar */
    .deals-radar-bar {
      background: linear-gradient(135deg, #FFF5F5 0%, #FFF9E6 100%);
      border: 2px solid #FFCCD5;
      border-radius: 14px;
      padding: 16px 20px;
      margin: 25px 0 15px;
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: center;
      gap: 15px;
      box-shadow: 0 4px 12px rgba(204, 12, 57, 0.06);
    }

    .radar-summary {
      display: flex;
      align-items: center;
      gap: 15px;
    }

    .radar-icon {
      font-size: 2.2rem;
    }

    .radar-text h2 {
      font-size: 1.2rem;
      color: var(--deal-red);
      font-weight: 800;
    }
    .radar-text p {
      font-size: 0.85rem;
      color: #555;
    }

    .quick-deal-filters {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .btn-filter-deal {
      background: white;
      border: 1.5px solid var(--border);
      padding: 6px 14px;
      border-radius: 20px;
      font-size: 0.85rem;
      font-weight: 700;
      color: #333;
      cursor: pointer;
      transition: all 0.2s;
    }

    .btn-filter-deal:hover, .btn-filter-deal.active {
      background: var(--deal-red);
      border-color: var(--deal-red);
      color: white;
    }

    /* Filters Section */
    .filters-section {
      background: white;
      border-radius: 12px;
      padding: 16px 20px;
      margin-bottom: 25px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.04);
      display: flex;
      flex-wrap: wrap;
      gap: 14px;
      justify-content: space-between;
      align-items: center;
    }

    .search-box {
      flex: 1;
      min-width: 260px;
    }

    .search-box input {
      width: 100%;
      padding: 10px 14px;
      border: 1.5px solid var(--border);
      border-radius: 8px;
      font-size: 0.95rem;
      outline: none;
      transition: border-color 0.2s;
    }
    .search-box input:focus { border-color: var(--secondary); }

    .filter-group {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      align-items: center;
    }

    select {
      padding: 9px 14px;
      border: 1.5px solid var(--border);
      border-radius: 8px;
      font-size: 0.9rem;
      background: white;
      cursor: pointer;
      outline: none;
    }

    .view-toggle {
      display: flex;
      background: var(--bg);
      border-radius: 8px;
      padding: 3px;
    }
    .view-toggle button {
      border: none;
      background: none;
      padding: 6px 12px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.85rem;
      font-weight: 700;
    }
    .view-toggle button.active {
      background: white;
      color: var(--secondary);
      box-shadow: 0 2px 4px rgba(0,0,0,0.06);
    }

    /* Products Grid */
    .products-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
      gap: 20px;
    }

    .product-card {
      background: white;
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      position: relative;
      transition: transform 0.2s, box-shadow 0.2s;
    }

    .product-card:hover {
      transform: translateY(-4px);
      box-shadow: 0 10px 25px rgba(0,0,0,0.08);
    }

    .deal-badge-container {
      position: absolute;
      top: 12px;
      right: 12px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      align-items: flex-end;
      z-index: 2;
    }

    .badge-discount {
      background: var(--deal-red);
      color: white;
      font-size: 0.78rem;
      font-weight: 800;
      padding: 3px 8px;
      border-radius: 6px;
      box-shadow: 0 2px 4px rgba(204,12,57,0.3);
    }

    .badge-savings {
      background: #E8F5E9;
      color: var(--deal-green);
      font-size: 0.72rem;
      font-weight: 800;
      padding: 2px 6px;
      border-radius: 4px;
      border: 1px solid #C8E6C9;
    }

    .img-wrapper {
      width: 100%;
      height: 180px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 12px;
    }

    .img-wrapper img {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
    }

    .card-category {
      font-size: 0.75rem;
      color: var(--muted);
      margin-bottom: 4px;
      font-weight: 600;
    }

    .card-title {
      font-size: 0.95rem;
      font-weight: 700;
      color: var(--dark);
      margin-bottom: 10px;
      flex-grow: 1;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      line-height: 1.45;
    }

    .card-price-row {
      display: flex;
      align-items: baseline;
      gap: 8px;
      margin-bottom: 8px;
    }

    .current-price {
      font-size: 1.25rem;
      font-weight: 900;
      color: #111;
    }

    .old-price {
      font-size: 0.88rem;
      color: #888;
      text-decoration: line-through;
    }

    .savings-text {
      font-size: 0.78rem;
      color: var(--deal-green);
      font-weight: 700;
      margin-bottom: 10px;
    }

    .asin-tag {
      font-size: 0.7rem;
      color: #999;
      font-family: monospace;
      margin-bottom: 10px;
    }

    .btn-buy {
      background: #f7ca00;
      border: 1px solid #a88734;
      border-radius: 20px;
      color: #111;
      text-align: center;
      padding: 7px 12px;
      font-size: 0.85rem;
      font-weight: 700;
      text-decoration: none;
      transition: background 0.2s;
    }
    .btn-buy:hover { background: #fa8900; }

    /* Table View */
    .table-view-container {
      display: none;
      background: white;
      border-radius: 12px;
      overflow-x: auto;
      box-shadow: 0 2px 8px rgba(0,0,0,0.04);
    }

    table {
      width: 100%;
      border-collapse: collapse;
      text-align: right;
    }

    th, td {
      padding: 12px 16px;
      border-bottom: 1px solid var(--border);
      font-size: 0.9rem;
    }

    th { background: #f1f5f9; font-weight: 800; color: var(--dark); }
    tr:hover { background: #f8fafc; }

    .table-img {
      width: 45px;
      height: 45px;
      object-fit: contain;
    }
  </style>
</head>
<body>

  <header>
    <div class="container">
      <div class="header-content">
        <div class="logo-title">
          <h1>
            <span>سوق أمازون مصر (Amazon Egypt Deals Radar)</span>
            <span class="badge-radar">🔥 كاشف العروض الذكي</span>
          </h1>
          <p style="color: #cbd5e1; font-size: 0.85rem; margin-top: 4px;">رصد العروض الحقيقية، حساب نسب الخصم المباشرة، وقيمة الوفر بالجنيه</p>
        </div>
        <div class="header-stats">
          <div class="stat-pill">
            <div class="num" id="statTotal">${items.length}</div>
            <div class="label">إجمالي الكتالوج</div>
          </div>
          <div class="stat-pill" style="border-color: rgba(204,12,57,0.5); background: rgba(204,12,57,0.15);">
            <div class="num" style="color: #ff6b8b;">${totalDeals}</div>
            <div class="label">عروض حقيقية مكتشفة</div>
          </div>
          <div class="stat-pill">
            <div class="num" style="color: #4ade80;">${topDeal ? topDeal.realDiscountPct : 0}%</div>
            <div class="label">أعلى نسبة خصم</div>
          </div>
          <div class="stat-pill">
            <div class="num" style="color: #fbbf24;">${maxSavings ? maxSavings.egpSaved : 0} ج.م</div>
            <div class="label">أكبر وفر بالجنيه</div>
          </div>
        </div>
      </div>

      <div class="actions-bar">
        <button onclick="toggleWatchlistView()" class="btn" style="background: linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%); color:white;">
          ⭐ المنتجات المراقبة (<span id="watchCount">0</span>)
        </button>
        <a href="amazon_tez_products.xls" download class="btn btn-excel">
          📊 تحميل تقرير الإكسل (.xls)
        </a>
        <a href="amazon_tez_products.csv" download class="btn btn-csv">
          📄 تحميل ملف CSV
        </a>
        <a href="deals_report.json" download class="btn" style="background:#475569; color:white;">
          { } تقرير العروض (JSON)
        </a>
      </div>
    </div>
  </header>

  <main class="container">

    <!-- Watchlist Panel -->
    <div id="watchlistPanel" style="display:none; background:white; border:2px solid #8b5cf6; border-radius:14px; padding:20px; margin:20px 0; box-shadow:0 8px 25px rgba(139,92,246,0.12);">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px; border-bottom:1px solid #f1f5f9; padding-bottom:12px;">
        <h2 style="font-size:1.25rem; color:#6d28d9; display:flex; align-items:center; gap:8px;">
          <span>⭐ قائمة مراقبة وتتبع المنتجات الخاصة</span>
          <span style="font-size:0.8rem; background:#ede9fe; color:#6d28d9; padding:2px 8px; border-radius:12px;" id="watchlistBadge">0 منتج</span>
        </h2>
        <button onclick="toggleWatchlistView()" style="background:none; border:none; font-size:1.2rem; cursor:pointer; color:#888;">✕</button>
      </div>

      <!-- Add New Product to Watchlist Form -->
      <div style="background:#faf5ff; border:1px solid #e9d5ff; border-radius:10px; padding:12px 16px; margin-bottom:18px; display:flex; flex-wrap:wrap; gap:10px; align-items:center;">
        <span style="font-weight:700; color:#581c87; font-size:0.9rem;">+ تتبع منتج جديد:</span>
        <input type="text" id="watchInputAsin" placeholder="كود ASIN (مثال: B0D4B1S9G3) أو رابط المنتج..." style="flex:2; min-width:200px; padding:8px 12px; border:1px solid #d8b4fe; border-radius:6px; outline:none; font-size:0.85rem;">
        
        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
          <input type="number" id="watchInputTargetPrice" placeholder="السعر المستهدف (ج.م)" style="width:145px; padding:8px 10px; border:1px solid #d8b4fe; border-radius:6px; outline:none; font-size:0.85rem;">
          <span style="font-weight:700; color:#7c3aed; font-size:0.85rem;">أو</span>
          <input type="number" id="watchInputTargetDiscount" placeholder="نسبة الخصم %" min="1" max="99" style="width:120px; padding:8px 10px; border:1px solid #d8b4fe; border-radius:6px; outline:none; font-size:0.85rem;">
        </div>

        <button onclick="addManualToWatch()" style="background:#7c3aed; color:white; border:none; padding:8px 18px; border-radius:6px; font-weight:700; cursor:pointer; font-size:0.9rem;">إضافة للتتبع</button>
      </div>

      <div id="watchlistGrid" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:15px;"></div>
    </div>

    <!-- Deals Radar Banner -->
    <div class="deals-radar-bar">
      <div class="radar-summary">
        <div class="radar-icon">🎯</div>
        <div class="radar-text">
          <h2>رادار العروض الحقيقية الموثقة</h2>
          <p>تم فحص الأسعار الأصلية واستبعاد التخفيضات الوهمية. اضغط للتصفية السريعة:</p>
        </div>
      </div>
      <div class="quick-deal-filters">
        <button class="btn-filter-deal active" onclick="setQuickFilter('all', this)">الكل (${items.length})</button>
        <button class="btn-filter-deal" onclick="setQuickFilter('deals', this)">🔥 كل العروض (${totalDeals})</button>
        <button class="btn-filter-deal" onclick="setQuickFilter('deals30', this)">⚡ خصم +30%</button>
        <button class="btn-filter-deal" onclick="setQuickFilter('deals20', this)">⚡ خصم +20%</button>
        <button class="btn-filter-deal" onclick="setQuickFilter('savings50', this)">💰 وفر أكثر من 50 ج.م</button>
      </div>
    </div>

    <!-- Filters Section -->
    <div class="filters-section">
      <div class="search-box">
        <input type="text" id="searchInput" placeholder="بحث باسم المنتج، البراند، أو كود ASIN..." oninput="filterData()">
      </div>
      <div class="filter-group">
        <select id="categoryFilter" onchange="filterData()">
          <option value="all">كل الأقسام (${categories.length})</option>
          ${categories.map(c => `<option value="${escapeXml(c)}">${escapeXml(c)}</option>`).join('\n')}
        </select>

        <select id="sortFilter" onchange="filterData()">
          <option value="discount-desc">الأعلى خصماً (Highest % OFF)</option>
          <option value="savings-desc">الأكبر وفراً بالجنيه (Biggest EGP Saved)</option>
          <option value="price-asc">السعر: من الأقل للأعلى</option>
          <option value="price-desc">السعر: من الأعلى للأقل</option>
          <option value="default">الترتيب الافتراضي</option>
        </select>

        <div class="view-toggle">
          <button id="cardViewBtn" class="active" onclick="switchView('grid')">شبكة كروت</button>
          <button id="tableViewBtn" onclick="switchView('table')">جدول بيانات</button>
        </div>
      </div>
    </div>

    <!-- Grid View -->
    <div class="products-grid" id="productsGrid"></div>

    <!-- Table View -->
    <div class="table-view-container" id="tableView">
      <table>
        <thead>
          <tr>
            <th>الصورة</th>
            <th>اسم المنتج</th>
            <th>القسم</th>
            <th>السعر الحالي</th>
            <th>سعر الوحدة</th>
            <th>السعر المعتاد</th>
            <th>الخصم التاريخي</th>
            <th>الوفر بالجنيه</th>
            <th>الحالة</th>
            <th>رابط الشراء</th>
          </tr>
        </thead>
        <tbody id="tableBody"></tbody>
      </table>
    </div>
  </main>

  <script>
    const allProducts = ${itemsJson};
    let myWatchlist = ${watchlistJson};
    let currentDealQuickFilter = 'all';

    function initWatchlist() {
      // Sync with localStorage if present
      const saved = localStorage.getItem('amazon_watchlist');
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) myWatchlist = parsed;
        } catch(e) {}
      }
      updateWatchlistUI();
    }

    function toggleWatchlistView() {
      const p = document.getElementById('watchlistPanel');
      p.style.display = p.style.display === 'none' ? 'block' : 'none';
    }

    function updateWatchlistUI() {
      document.getElementById('watchCount').innerText = myWatchlist.length;
      document.getElementById('watchlistBadge').innerText = myWatchlist.length + ' منتج';
      localStorage.setItem('amazon_watchlist', JSON.stringify(myWatchlist));

      const grid = document.getElementById('watchlistGrid');
      if (myWatchlist.length === 0) {
        grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:20px; color:#888;">لا توجد منتجات مضافة للتتبع بعد. اضغط "⭐ راقب السعر" على أي منتج أو أضف كود ASIN مباشرة أعلاه.</div>';
        return;
      }

      grid.innerHTML = myWatchlist.map((item, idx) => {
        const catProd = allProducts.find(p => p.asin.toUpperCase() === item.asin.toUpperCase());
        const discPct = item.realDiscountPct || (catProd ? catProd.realDiscountPct : 0) || (item.oldPriceNum && item.currentPriceNum && item.oldPriceNum > item.currentPriceNum ? Math.round(((item.oldPriceNum - item.currentPriceNum) / item.oldPriceNum) * 100) : 0);

        const priceReached = Boolean(item.targetPrice && item.currentPriceNum && item.currentPriceNum <= item.targetPrice);
        const discountReached = Boolean(item.targetDiscountPct && discPct >= item.targetDiscountPct);
        const isReached = priceReached || discountReached;

        let targetBadgeHtml = '';
        if (priceReached && discountReached) {
          targetBadgeHtml = \`<span style="font-size:0.75rem; font-weight:700; color:#16a34a; background:#dcfce7; padding:3px 8px; border-radius:6px; border:1px solid #bbf7d0;">🎯 تحقق الهدفان! (\${item.targetPrice} ج.م & خصم \${item.targetDiscountPct}%)</span>\`;
        } else if (priceReached) {
          targetBadgeHtml = \`<span style="font-size:0.75rem; font-weight:700; color:#16a34a; background:#dcfce7; padding:3px 8px; border-radius:6px; border:1px solid #bbf7d0;">🎯 تحقق هدف السعر! (<=\${item.targetPrice} ج.م)</span>\`;
        } else if (discountReached) {
          targetBadgeHtml = \`<span style="font-size:0.75rem; font-weight:700; color:#16a34a; background:#dcfce7; padding:3px 8px; border-radius:6px; border:1px solid #bbf7d0;">🎯 تحقق هدف الخصم! (\${discPct}% >=\${item.targetDiscountPct}%)</span>\`;
        } else if (item.targetPrice && item.targetDiscountPct) {
          targetBadgeHtml = \`<span style="font-size:0.75rem; font-weight:700; color:#d97706; background:#fef3c7; padding:3px 8px; border-radius:6px; border:1px solid #fde68a;">المستهدف: \${item.targetPrice} ج.م أو خصم \${item.targetDiscountPct}%</span>\`;
        } else if (item.targetPrice) {
          targetBadgeHtml = \`<span style="font-size:0.75rem; font-weight:700; color:#d97706; background:#fef3c7; padding:3px 8px; border-radius:6px; border:1px solid #fde68a;">المستهدف: \${item.targetPrice} ج.م</span>\`;
        } else if (item.targetDiscountPct) {
          targetBadgeHtml = \`<span style="font-size:0.75rem; font-weight:700; color:#d97706; background:#fef3c7; padding:3px 8px; border-radius:6px; border:1px solid #fde68a;">المستهدف: خصم \${item.targetDiscountPct}% (الحالي: \${discPct}%)</span>\`;
        } else {
          targetBadgeHtml = \`<span style="font-size:0.75rem; color:#888;">بدون هدف محدد</span>\`;
        }

        return \`
          <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:12px; display:flex; flex-direction:column; position:relative; box-shadow:0 2px 6px rgba(0,0,0,0.03);">
            <button onclick="removeFromWatch(\${idx})" style="position:absolute; top:8px; left:8px; background:none; border:none; color:#ef4444; font-weight:800; cursor:pointer; font-size:1rem;" title="حذف">✕</button>
            <div style="font-weight:700; font-size:0.88rem; color:#1e293b; margin-bottom:6px; line-height:1.4; padding-left:22px;">\${item.title}</div>
            
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; flex-wrap:wrap; gap:6px;">
              <div style="display:flex; align-items:baseline; gap:6px;">
                <span style="font-size:1.15rem; font-weight:800; color:#111;">\${item.currentPrice}</span>
                \${discPct > 0 ? \`<span style="font-size:0.75rem; color:#dc2626; background:#fee2e2; padding:1px 6px; border-radius:4px; font-weight:700;">خصم \${discPct}%</span>\` : ''}
              </div>
              \${targetBadgeHtml}
            </div>

            <div style="display:flex; justify-content:space-between; align-items:center; margin-top:auto; font-size:0.75rem;">
              <span style="color:#64748b;">ASIN: \${item.asin}</span>
              <a href="\${item.productUrl}" target="_blank" style="color:#7c3aed; font-weight:700; text-decoration:none;">عرض بأمازون ↗</a>
            </div>
          </div>
        \`;
      }).join('');
    }

    function addCurrentToWatch(asin) {
      const p = allProducts.find(x => x.asin === asin);
      if (!p) return;

      const currentPriceText = p.currentPriceNum ? (p.currentPriceNum + ' ج.م') : '';
      const currentDiscountText = p.realDiscountPct ? ('خصم ' + p.realDiscountPct + '%') : 'بدون خصم';

      const promptMsg = 'تتبع: ' + p.title.slice(0, 45) + '...\\n' +
        'السعر الحالي: ' + currentPriceText + ' (' + currentDiscountText + ')\\n\\n' +
        'أدخل هدف التنبيه:\\n' +
        '• سعر مستهدف بالجنيه: اكتب الرقم (مثال: ' + (p.currentPriceNum ? Math.floor(p.currentPriceNum * 0.9) : 400) + ')\\n' +
        '• أو نسبة خصم مستهدفة: اكتب الرقم مع علامة % (مثال: 25%)';

      const defaultVal = p.currentPriceNum ? String(Math.floor(p.currentPriceNum * 0.9)) : '20%';
      const targetInput = prompt(promptMsg, defaultVal);
      if (targetInput === null) return;

      const val = targetInput.trim();
      let targetPrice = null;
      let targetDiscountPct = null;

      if (val.includes('%')) {
        targetDiscountPct = parseFloat(val.replace('%', '').trim());
      } else if (val && !isNaN(val)) {
        targetPrice = parseFloat(val);
      }

      const idx = myWatchlist.findIndex(x => x.asin === asin);
      const record = {
        asin: p.asin,
        title: p.title,
        currentPrice: p.currentPrice,
        currentPriceNum: p.currentPriceNum,
        oldPrice: p.oldPrice,
        oldPriceNum: p.oldPriceNum,
        realDiscountPct: p.realDiscountPct,
        targetPrice: targetPrice,
        targetDiscountPct: targetDiscountPct,
        productUrl: p.productUrl,
        imgSrc: p.imgSrc,
        dateAdded: new Date().toLocaleDateString('ar-EG')
      };

      if (idx >= 0) {
        myWatchlist[idx] = Object.assign({}, myWatchlist[idx], record);
      } else {
        myWatchlist.push(record);
      }

      updateWatchlistUI();
      document.getElementById('watchlistPanel').style.display = 'block';
    }

    function addManualToWatch() {
      const input = document.getElementById('watchInputAsin').value.trim();
      const targetPriceVal = document.getElementById('watchInputTargetPrice').value.trim();
      const targetDiscountVal = document.getElementById('watchInputTargetDiscount').value.trim();

      if (!input) return alert('يرجى إدخال كود ASIN أو رابط المنتج');

      let asin = input;
      const m = input.match(new RegExp('(?:dp|gp/product|product)/([A-Z0-9]{10})', 'i'));
      if (m) asin = m[1].toUpperCase();

      const existing = allProducts.find(p => p.asin.toUpperCase() === asin.toUpperCase());
      const title = existing ? existing.title : 'منتج أمازون (' + asin + ')';
      const price = existing ? existing.currentPrice : 'جاري الفحص...';
      const priceNum = existing ? existing.currentPriceNum : null;
      const oldPrice = existing ? existing.oldPrice : null;
      const oldPriceNum = existing ? existing.oldPriceNum : null;
      const realDiscountPct = existing ? existing.realDiscountPct : null;

      const targetPrice = targetPriceVal ? parseFloat(targetPriceVal) : null;
      const targetDiscountPct = targetDiscountVal ? parseFloat(targetDiscountVal) : null;

      const existingIdx = myWatchlist.findIndex(x => x.asin.toUpperCase() === asin.toUpperCase());
      const record = {
        asin: asin.toUpperCase(),
        title: title,
        currentPrice: price,
        currentPriceNum: priceNum,
        oldPrice: oldPrice,
        oldPriceNum: oldPriceNum,
        realDiscountPct: realDiscountPct,
        targetPrice: targetPrice,
        targetDiscountPct: targetDiscountPct,
        productUrl: 'https://www.amazon.eg/dp/' + asin,
        dateAdded: new Date().toLocaleDateString('ar-EG')
      };

      if (existingIdx >= 0) {
        myWatchlist[existingIdx] = Object.assign({}, myWatchlist[existingIdx], record);
      } else {
        myWatchlist.push(record);
      }

      document.getElementById('watchInputAsin').value = '';
      document.getElementById('watchInputTargetPrice').value = '';
      document.getElementById('watchInputTargetDiscount').value = '';
      updateWatchlistUI();
    }

    function removeFromWatch(idx) {
      myWatchlist.splice(idx, 1);
      updateWatchlistUI();
    }

    function renderGrid(products) {
      const grid = document.getElementById('productsGrid');
      if (products.length === 0) {
        grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 50px; color: #888; font-size:1.1rem;">لا توجد منتجات تطابق معايير العروض المختارة</div>';
        return;
      }

      grid.innerHTML = products.map(p => {
        const hasDeal = p.isRealDeal && p.realDiscountPct > 0;
        return \`
          <div class="product-card">
            \${hasDeal ? \`
              <div class="deal-badge-container">
                <span class="badge-discount">\${p.realDiscountPct}% خصم</span>
                \${p.egpSaved > 0 ? \`<span class="badge-savings">وفر \${p.egpSaved} ج.م</span>\` : ''}
              </div>
            \` : ''}
            <div class="img-wrapper">
              <img src="\${p.imgSrc}" alt="\${p.title}" loading="lazy" onerror="this.src='https://placehold.co/200x200?text=No+Image'">
            </div>
            <span class="card-category">\${p.category || 'عام'}</span>
            <h3 class="card-title" title="\${p.title}">\${p.title}</h3>
            <div class="card-price-row">
              <span class="current-price">\${p.currentPrice}</span>
              \${(p.typical_price && p.typical_price > p.currentPriceNum) ? \`
                <span class="old-price">EGP \${p.typical_price}</span>
              \` : (p.oldPriceNum ? \`<span class="old-price">EGP \${p.oldPriceNum}</span>\` : '')}
            </div>
            \${(p.unit_price_formatted && p.unit_price_formatted !== '—') ? \`
              <div style="font-size:0.82rem; color:#4b5563; font-weight:700; margin-bottom:4px;">⚖️ \${p.unit_price_formatted}</div>
            \` : '<div style="height:18px;"></div>'}
            \${p.egpSaved > 0 ? \`
              <div class="savings-text">💰 توفير مباشر: \${p.egpSaved} جنيه</div>
            \` : '<div style="height:21px;"></div>'}
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
              <span class="asin-tag" style="margin:0;">ASIN: \${p.asin}</span>
              <button onclick="addCurrentToWatch('\${p.asin}')" style="background:#ede9fe; color:#6d28d9; border:none; padding:3px 8px; border-radius:6px; font-size:0.75rem; font-weight:700; cursor:pointer;" title="إضافة لقائمة المراقبة">⭐ راقب السعر</button>
            </div>
            <a href="\${p.productUrl}" target="_blank" class="btn-buy">عرض على أمازون ↗</a>
          </div>
        \`;
      }).join('');
    }

    function renderTable(products) {
      const tbody = document.getElementById('tableBody');
      if (products.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" style="text-align: center; padding: 30px; color: #888;">لا توجد نتائج</td></tr>';
        return;
      }

      tbody.innerHTML = products.map(p => \`
        <tr>
          <td><img src="\${p.imgSrc}" class="table-img" alt="" onerror="this.src='https://placehold.co/50x50?text=IMG'"></td>
          <td><strong>\${p.title}</strong></td>
          <td><span style="color:#666">\${p.category || '-'}</span></td>
          <td><span style="font-weight:800; color:#111;">\${p.currentPrice}</span></td>
          <td><span style="font-weight:700; color:#4b5563;">\${p.unit_price_formatted || '—'}</span></td>
          <td><span style="color:#888; text-decoration:line-through;">\${p.typical_price ? 'EGP ' + p.typical_price : (p.oldPriceNum ? 'EGP ' + p.oldPriceNum : '-')}</span></td>
          <td>
            \${p.historical_discount_pct > 0 ? \`<span style="color:var(--deal-red); font-weight:800;">\${p.historical_discount_pct}%</span>\` : (p.confidence === 'low' ? '<span style="color:#888; font-size:0.75rem;">لسه بنجمع بيانات</span>' : '-')}
          </td>
          <td>
            \${p.egpSaved > 0 ? \`<span style="color:var(--deal-green); font-weight:800;">+\${p.egpSaved} ج.م</span>\` : '-'}
          </td>
          <td>
            \${p.is_real_deal ? '<span style="color:var(--deal-green); font-weight:700;">🔥 عرض حقيقي</span>' : (p.confidence === 'low' ? '<span style="color:#888;">⏳ قيد المراقبة</span>' : '<span style="color:#888;">سعر عادي</span>')}
          </td>
          <td><a href="\${p.productUrl}" target="_blank" style="color:var(--secondary); font-weight:700; text-decoration:none;">عرض المنتج ↗</a></td>
        </tr>
      \`).join('');
    }

    function setQuickFilter(mode, btnElement) {
      currentDealQuickFilter = mode;
      document.querySelectorAll('.btn-filter-deal').forEach(b => b.classList.remove('active'));
      if (btnElement) {
        btnElement.classList.add('active');
      } else if (window.event && window.event.target) {
        window.event.target.classList.add('active');
      }
      filterData();
    }

    function filterData() {
      const query = document.getElementById('searchInput').value.trim().toLowerCase();
      const cat = document.getElementById('categoryFilter').value;
      const sort = document.getElementById('sortFilter').value;

      let filtered = allProducts.filter(p => {
        const matchesQuery = p.title.toLowerCase().includes(query) || p.asin.toLowerCase().includes(query);
        const matchesCat = cat === 'all' || p.category === cat;

        let matchesDeal = true;
        if (currentDealQuickFilter === 'deals') {
          matchesDeal = p.isRealDeal;
        } else if (currentDealQuickFilter === 'deals30') {
          matchesDeal = (p.realDiscountPct || 0) >= 30;
        } else if (currentDealQuickFilter === 'deals20') {
          matchesDeal = (p.realDiscountPct || 0) >= 20;
        } else if (currentDealQuickFilter === 'savings50') {
          matchesDeal = (p.egpSaved || 0) >= 50;
        }

        return matchesQuery && matchesCat && matchesDeal;
      });

      if (sort === 'discount-desc') {
        filtered.sort((a, b) => (b.realDiscountPct || 0) - (a.realDiscountPct || 0));
      } else if (sort === 'savings-desc') {
        filtered.sort((a, b) => (b.egpSaved || 0) - (a.egpSaved || 0));
      } else if (sort === 'price-asc') {
        filtered.sort((a, b) => (a.currentPriceNum || 0) - (b.currentPriceNum || 0));
      } else if (sort === 'price-desc') {
        filtered.sort((a, b) => (b.currentPriceNum || 0) - (a.currentPriceNum || 0));
      }

      document.getElementById('statTotal').innerText = filtered.length;
      renderGrid(filtered);
      renderTable(filtered);
    }

    function switchView(mode) {
      const grid = document.getElementById('productsGrid');
      const table = document.getElementById('tableView');
      const cardBtn = document.getElementById('cardViewBtn');
      const tableBtn = document.getElementById('tableViewBtn');

      if (mode === 'grid') {
        grid.style.display = 'grid';
        table.style.display = 'none';
        cardBtn.classList.add('active');
        tableBtn.classList.remove('active');
      } else {
        grid.style.display = 'none';
        table.style.display = 'block';
        cardBtn.classList.remove('active');
        tableBtn.classList.add('active');
      }
    }

    // Default Sort by Discount
    filterData();
    initWatchlist();
  </script>
</body>
</html>`;

  const htmlPath = path.join(__dirname, 'index.html');
  fs.writeFileSync(htmlPath, htmlContent, 'utf-8');
  console.log(`Saved HTML Deals View: ${htmlPath}`);
}

generateCSV(products);
generateExcelXML(products);
generateHTML(products, watchlist);
console.log('All exports with Deal Radar updated successfully!');
