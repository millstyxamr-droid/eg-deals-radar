#!/usr/bin/env node

/**
 * scripts/brand_report.js
 * 
 * Generates a professional single-brand competitive intelligence PDF report
 * using Playwright (HTML -> PDF with local Arabic font Cairo and printBackground: true).
 * 
 * Usage:
 *   node scripts/brand_report.js --brand "Domty" --days 30 --out reports/domty-2026-11.pdf
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { getBrandReportData } = require('../src/report_queries');

// Parse CLI arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    brand: 'Domty',
    days: 30,
    out: null,
    keepHtml: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--brand' && args[i + 1]) {
      options.brand = args[++i];
    } else if (arg === '--days' && args[i + 1]) {
      options.days = parseInt(args[++i], 10) || 30;
    } else if (arg === '--out' && args[i + 1]) {
      options.out = args[++i];
    } else if (arg === '--keep-html') {
      options.keepHtml = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
استخدام تقرير أسعار البراند:
  node scripts/brand_report.js --brand "Domty" --days 30 --out reports/domty-2026-11.pdf

الخيارات:
  --brand <اسم>    اسم البراند المطلوب تحليله (افتراضي: Domty)
  --days <عدد>     عدد أيام المراقبة السابقة (افتراضي: 30)
  --out <مسار>     مسار ملف PDF الناتج (افتراضي: reports/<brand>-YYYY-MM.pdf)
  --keep-html      الاحتفاظ بملف HTML المؤقت للفحص
      `);
      process.exit(0);
    }
  }

  if (!options.out) {
    const now = new Date();
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const safeBrand = options.brand.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    options.out = path.join('reports', `${safeBrand}-${yearMonth}.pdf`);
  }

  return options;
}

// Loads local font as base64 for reliable PDF embedding
function loadLocalFontBase64() {
  const fontPaths = [
    path.join(__dirname, '..', 'assets', 'fonts', 'Cairo-Regular.ttf'),
    path.join(__dirname, '..', 'assets', 'fonts', 'Cairo-Bold.ttf')
  ];

  for (const fp of fontPaths) {
    if (fs.existsSync(fp)) {
      try {
        const buffer = fs.readFileSync(fp);
        return buffer.toString('base64');
      } catch (e) {
        console.warn(`[-] تعذر قراءة الخط من ${fp}:`, e.message);
      }
    }
  }
  return null;
}

// Builds the complete HTML report
function buildHtmlReport(data, fontBase64) {
  const fontFaceCss = fontBase64
    ? `
      @font-face {
        font-family: 'Cairo';
        src: url(data:font/truetype;charset=utf-8;base64,${fontBase64}) format('truetype');
        font-weight: 300 900;
        font-style: normal;
        font-display: swap;
      }
    `
    : '';

  const formatEgp = (num) => {
    if (num === null || num === undefined || isNaN(num)) return '—';
    return `${Number(num).toFixed(2)} ج.م`;
  };

  const formatUnitPrice = (price, unit) => {
    if (!price || !unit) return '—';
    return `${Number(price).toFixed(2)} ${unit}`;
  };

  // Executive summary cards
  const summaryCardsHtml = data.executiveSummary.map((card, idx) => {
    let borderColor = '#cbd5e1';
    let valColor = '#0f172a';
    let icon = '📊';

    if (card.status === 'positive') {
      borderColor = '#10b981';
      valColor = '#047857';
      icon = '✅';
    } else if (card.status === 'warning') {
      borderColor = '#f59e0b';
      valColor = '#b45309';
      icon = '⚠️';
    }

    if (idx === 0) icon = '📦';
    if (idx === 1) icon = '⚖️';
    if (idx === 2) icon = '📈';
    if (idx === 3) icon = '⏳';
    if (idx === 4) icon = '🎯';

    return `
      <div class="kpi-card" style="border-top: 3px solid ${borderColor};">
        <div class="kpi-header">
          <span class="kpi-icon">${icon}</span>
          <span class="kpi-title">${card.title}</span>
        </div>
        <div class="kpi-value" style="color: ${valColor};">${card.value}</div>
        <div class="kpi-subtitle">${card.subtitle}</div>
      </div>
    `;
  }).join('');

  // Warning banner if insufficient data
  const warningBannerHtml = data.isInsufficientData
    ? `
      <div class="warning-banner">
        <div class="warning-icon">⚠️</div>
        <div class="warning-content">
          <div class="warning-title">تنبيه: عينة البيانات غير كافية</div>
          <div class="warning-text">${data.warningMessage}</div>
        </div>
      </div>
    `
    : '';

  // Competitor Pricing Table rows
  const competitorRowsHtml = data.competitorTable.map((item, idx) => {
    const brandPriceStr = formatEgp(item.current_price);
    const brandUnitStr = formatUnitPrice(item.unit_price, item.unit_price_unit);

    let competitorsColHtml = '';
    if (item.competitors && item.competitors.length > 0) {
      competitorsColHtml = `
        <div class="comp-list">
          ${item.competitors.map(c => {
            const diffClass = c.diffPct <= 0 ? 'diff-positive' : 'diff-negative';
            const diffSign = c.diffPct > 0 ? '+' : '';
            const sizeBadge = c.is_strict_size_match 
              ? `<span class="badge badge-strict">مطابق للحجم ±20%</span>` 
              : `<span class="badge badge-approx">نفس الفئة</span>`;

            return `
              <div class="comp-item">
                <div class="comp-top">
                  <span class="comp-brand">${c.brand}</span>
                  <span class="comp-title">${c.title}</span>
                  ${sizeBadge}
                </div>
                <div class="comp-bottom">
                  <span class="comp-price">${formatEgp(c.price)}</span>
                  ${c.unit_price ? `<span class="comp-unit">(${formatUnitPrice(c.unit_price, c.unit_price_unit)})</span>` : ''}
                  <span class="comp-diff ${diffClass}">فرق: ${diffSign}${c.diffPct}%</span>
                  <span class="comp-cheaper">${c.cheaper}</span>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    } else {
      competitorsColHtml = `<div class="no-comp-text">لا يوجد منافس مباشر مطابق للحجم (±20%) في نفس الفئة</div>`;
    }

    return `
      <tr>
        <td class="col-num">${idx + 1}</td>
        <td class="col-product">
          <div class="prod-title">${item.title}</div>
          <div class="prod-meta">
            <span class="prod-cat">${item.category_name}</span>
            <span class="prod-size">${item.size_text}</span>
            <span class="prod-asin">ASIN: ${item.asin}</span>
          </div>
        </td>
        <td class="col-price">
          <div class="price-val">${brandPriceStr}</div>
          <div class="unit-val">${brandUnitStr}</div>
        </td>
        <td class="col-comps">
          ${competitorsColHtml}
        </td>
      </tr>
    `;
  }).join('');

  // Out of stock rows or card
  let oosSectionHtml = '';
  if (data.outOfStockList && data.outOfStockList.length > 0) {
    const oosRows = data.outOfStockList.map((item, idx) => `
      <tr>
        <td class="col-num">${idx + 1}</td>
        <td>
          <div class="prod-title">${item.title}</div>
          <div class="prod-asin">ASIN: ${item.asin}</div>
        </td>
        <td style="text-align: center;">${item.total_snapshots}</td>
        <td style="text-align: center; color: #b45309; font-weight: bold;">${item.oos_snapshots}</td>
        <td style="text-align: center;">
          <span class="badge badge-warning">${item.unavailable_pct}%</span>
        </td>
        <td style="text-align: center;">${item.last_seen_in_stock}</td>
      </tr>
    `).join('');

    oosSectionHtml = `
      <div class="table-container">
        <table class="report-table">
          <thead>
            <tr>
              <th style="width: 5%;">#</th>
              <th style="width: 45%;">المنتج المتأثر</th>
              <th style="width: 12%; text-align: center;">إجمالي الرصد</th>
              <th style="width: 12%; text-align: center;">مرات النفاد</th>
              <th style="width: 13%; text-align: center;">نسبة عدم التوفر</th>
              <th style="width: 13%; text-align: center;">آخر رصد متاح</th>
            </tr>
          </thead>
          <tbody>
            ${oosRows}
          </tbody>
        </table>
      </div>
    `;
  } else {
    oosSectionHtml = `
      <div class="success-box">
        <div class="success-icon">✨</div>
        <div class="success-text">
          <strong>توفر كامل ومستقر بنسبة 100%:</strong> لم تسجل أي لقطة سعرية حالة نفاد مخزون (in_stock = 0) لمنتجات ${data.brand} خلال فترة الـ ${data.days} يوماً السابقة.
        </div>
      </div>
    `;
  }

  // Promotions section HTML
  const promo = data.promotions;

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <title>تقرير أسعار المنافسة — ${data.brand}</title>
  <style>
    ${fontFaceCss}

    * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    @page {
      size: A4 portrait;
      margin: 12mm 10mm 15mm 10mm;
      @bottom-left {
        content: "تقرير ذكاء أسعار Amazon Now / Tez — سرّي وداخلي";
        font-family: 'Cairo', Tahoma, sans-serif;
        font-size: 8pt;
        color: #94a3b8;
      }
      @bottom-right {
        content: counter(page);
        font-family: 'Cairo', Tahoma, sans-serif;
        font-size: 8pt;
        color: #94a3b8;
      }
    }

    body {
      font-family: 'Cairo', 'Segoe UI', Tahoma, sans-serif;
      margin: 0;
      padding: 0;
      background: #ffffff;
      color: #0f172a;
      direction: rtl;
      text-align: right;
      font-size: 11pt;
      line-height: 1.5;
    }

    /* Cover Page */
    .cover-page {
      page-break-after: always;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      min-height: 92vh;
      padding: 30px 20px;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      background: linear-gradient(180deg, #f8fafc 0%, #ffffff 100%);
    }

    .cover-header {
      border-bottom: 2px solid #0284c7;
      padding-bottom: 20px;
    }

    .brand-badge {
      display: inline-block;
      background: #0284c7;
      color: #ffffff;
      font-size: 10pt;
      font-weight: bold;
      padding: 4px 14px;
      border-radius: 20px;
      margin-bottom: 12px;
    }

    .cover-title {
      font-size: 26pt;
      font-weight: 900;
      color: #0f172a;
      margin: 0 0 10px 0;
      line-height: 1.2;
    }

    .cover-subtitle {
      font-size: 15pt;
      color: #475569;
      margin: 0;
    }

    .cover-center {
      padding: 40px 0;
    }

    .brand-hero {
      background: #ffffff;
      border: 1px solid #cbd5e1;
      border-radius: 12px;
      padding: 24px;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
    }

    .brand-hero-name {
      font-size: 28pt;
      font-weight: bold;
      color: #0369a1;
      margin-bottom: 8px;
    }

    .brand-hero-desc {
      font-size: 12pt;
      color: #64748b;
    }

    .cover-meta-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 15px;
      margin-top: 25px;
    }

    .cover-meta-item {
      background: #f1f5f9;
      padding: 12px 16px;
      border-radius: 8px;
      border-right: 3px solid #0284c7;
    }

    .cover-meta-label {
      font-size: 9pt;
      color: #64748b;
      margin-bottom: 4px;
    }

    .cover-meta-value {
      font-size: 11pt;
      font-weight: bold;
      color: #0f172a;
    }

    .cover-footer {
      border-top: 1px solid #e2e8f0;
      padding-top: 15px;
      font-size: 9pt;
      color: #94a3b8;
      display: flex;
      justify-content: space-between;
    }

    /* Page Content Styling */
    .page-break {
      page-break-before: always;
      margin-top: 20px;
    }

    .section-container {
      margin-bottom: 25px;
    }

    .section-title {
      font-size: 15pt;
      font-weight: bold;
      color: #0f172a;
      border-right: 4px solid #0284c7;
      padding-right: 12px;
      margin: 20px 0 15px 0;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .section-badge {
      font-size: 9pt;
      background: #f1f5f9;
      color: #475569;
      padding: 2px 10px;
      border-radius: 12px;
      font-weight: normal;
    }

    /* Warning Banner */
    .warning-banner {
      background: #fffbeb;
      border: 1px solid #fde68a;
      border-right: 4px solid #f59e0b;
      border-radius: 8px;
      padding: 12px 16px;
      margin-bottom: 20px;
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .warning-icon {
      font-size: 20pt;
    }

    .warning-title {
      font-weight: bold;
      color: #92400e;
      font-size: 11pt;
    }

    .warning-text {
      color: #b45309;
      font-size: 9.5pt;
      margin-top: 2px;
    }

    /* KPI Cards */
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 10px;
      margin-bottom: 25px;
      page-break-inside: avoid;
    }

    .kpi-card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 12px 10px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      min-height: 105px;
    }

    .kpi-header {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 6px;
    }

    .kpi-icon {
      font-size: 12pt;
    }

    .kpi-title {
      font-size: 8.5pt;
      color: #64748b;
      font-weight: 600;
    }

    .kpi-value {
      font-size: 13pt;
      font-weight: 800;
      margin-bottom: 4px;
      line-height: 1.1;
      font-family: 'Cairo', 'Segoe UI', Tahoma, sans-serif;
    }

    .kpi-subtitle {
      font-size: 7.5pt;
      color: #64748b;
      line-height: 1.2;
    }

    /* Tables */
    .table-container {
      width: 100%;
      margin-bottom: 20px;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      overflow: hidden;
    }

    .report-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 9.5pt;
      text-align: right;
    }

    .report-table thead th {
      background: #f1f5f9;
      color: #334155;
      padding: 10px 12px;
      font-weight: 700;
      border-bottom: 2px solid #cbd5e1;
      font-size: 9pt;
    }

    .report-table tbody tr {
      border-bottom: 1px solid #f1f5f9;
      page-break-inside: avoid;
    }

    .report-table tbody tr:nth-child(even) {
      background: #fafafa;
    }

    .report-table td {
      padding: 10px 12px;
      vertical-align: top;
    }

    .col-num {
      width: 4%;
      text-align: center;
      color: #94a3b8;
      font-size: 8.5pt;
    }

    .col-product {
      width: 32%;
    }

    .prod-title {
      font-weight: bold;
      color: #0f172a;
      line-height: 1.3;
      margin-bottom: 4px;
    }

    .prod-meta {
      font-size: 8pt;
      color: #64748b;
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .prod-cat {
      background: #e2e8f0;
      padding: 1px 6px;
      border-radius: 4px;
    }

    .prod-size {
      background: #e0f2fe;
      color: #0369a1;
      padding: 1px 6px;
      border-radius: 4px;
    }

    .prod-asin {
      color: #94a3b8;
    }

    .col-price {
      width: 16%;
    }

    .price-val {
      font-size: 11pt;
      font-weight: bold;
      color: #0f172a;
    }

    .unit-val {
      font-size: 8.5pt;
      color: #0284c7;
      margin-top: 2px;
    }

    .col-comps {
      width: 48%;
    }

    .comp-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .comp-item {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 6px 8px;
      font-size: 8.5pt;
    }

    .comp-top {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 3px;
    }

    .comp-brand {
      font-weight: bold;
      color: #0369a1;
      background: #f0f9ff;
      padding: 1px 5px;
      border-radius: 4px;
      font-size: 8pt;
    }

    .comp-title {
      color: #334155;
      flex: 1;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .comp-bottom {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 8pt;
    }

    .comp-price {
      font-weight: bold;
      color: #0f172a;
    }

    .comp-unit {
      color: #64748b;
      font-size: 7.5pt;
    }

    .comp-diff {
      font-weight: bold;
      padding: 1px 6px;
      border-radius: 4px;
    }

    .diff-positive {
      background: #dcfce7;
      color: #15803d;
    }

    .diff-negative {
      background: #fee2e2;
      color: #b91c1c;
    }

    .comp-cheaper {
      color: #475569;
      font-size: 7.5pt;
    }

    .no-comp-text {
      color: #94a3b8;
      font-size: 8.5pt;
      font-style: italic;
      padding: 6px 0;
    }

    /* Badges */
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 7.5pt;
      font-weight: 600;
    }

    .badge-strict {
      background: #e0f2fe;
      color: #0369a1;
    }

    .badge-approx {
      background: #f1f5f9;
      color: #64748b;
    }

    .badge-warning {
      background: #fef3c7;
      color: #92400e;
    }

    /* Promotions Grid */
    .promo-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
      margin-bottom: 20px;
    }

    .promo-card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 14px;
      text-align: center;
    }

    .promo-val {
      font-size: 16pt;
      font-weight: 800;
      color: #0284c7;
      margin-bottom: 4px;
    }

    .promo-label {
      font-size: 9pt;
      color: #475569;
    }

    .promo-sync-box {
      background: #f0fdf4;
      border: 1px solid #bbf7d0;
      border-right: 4px solid #16a34a;
      border-radius: 8px;
      padding: 12px 16px;
      margin-top: 10px;
      font-size: 9.5pt;
      color: #166534;
    }

    /* Success Box */
    .success-box {
      background: #f0fdf4;
      border: 1px solid #bbf7d0;
      border-radius: 8px;
      padding: 16px;
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 20px;
    }

    .success-icon {
      font-size: 18pt;
    }

    .success-text {
      font-size: 10pt;
      color: #166534;
    }

    /* Price Index Chart Container */
    .chart-container {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 15px;
      margin-bottom: 20px;
      page-break-inside: avoid;
    }

    /* Disclaimer & Methodology Footer */
    .disclaimer-box {
      background: #f8fafc;
      border-top: 2px solid #cbd5e1;
      padding: 16px 20px;
      margin-top: 30px;
      border-radius: 8px;
      font-size: 8.5pt;
      color: #64748b;
      line-height: 1.6;
      page-break-inside: avoid;
    }

    .disclaimer-title {
      font-weight: bold;
      color: #334155;
      margin-bottom: 4px;
      font-size: 9pt;
    }
  </style>
</head>
<body>

  <!-- COVER PAGE -->
  <div class="cover-page">
    <div class="cover-header">
      <span class="brand-badge">Amazon Now / Tez — رصد الأسعار التنافسية</span>
      <h1 class="cover-title">تقرير أسعار المنافسة</h1>
      <p class="cover-subtitle">تحليل مقارن لأسعار وتوفر ومحفظة منتجات البراند مقابل المنافسين</p>
    </div>

    <div class="cover-center">
      <div class="brand-hero">
        <div class="brand-hero-name">${data.brand}</div>
        <div class="brand-hero-desc">تحليل دقيق للأسعار وسعر الوحدة والعروض الترويجية ونفاد المخزون على منصة Amazon Egypt Tez</div>
        
        <div class="cover-meta-grid">
          <div class="cover-meta-item">
            <div class="cover-meta-label">النطاق الزمني للرصد</div>
            <div class="cover-meta-value">${data.minDate} إلى ${data.maxDate} (${data.days} يوماً)</div>
          </div>
          <div class="cover-meta-item">
            <div class="cover-meta-label">تاريخ إنشاء التقرير</div>
            <div class="cover-meta-value">${data.generatedAt.slice(0, 10)} (${data.generatedAt.slice(11, 16)} UTC)</div>
          </div>
          <div class="cover-meta-item">
            <div class="cover-meta-label">إجمالي المنتجات المرصودة</div>
            <div class="cover-meta-value">${data.productCount} منتج (${data.daysObserved} أيام مسجلة)</div>
          </div>
        </div>
      </div>
    </div>

    <div class="cover-footer">
      <span>منصة Amazon Egypt Tez / Quick Commerce — رصد البيانات العامة</span>
      <span>وثيقة تحليل تنافسي مؤتمتة</span>
    </div>
  </div>

  <!-- EXECUTIVE SUMMARY SECTION -->
  <div class="section-container page-break">
    <div class="section-title">
      <span>1. الملخص التنفيذي (Executive Summary)</span>
      <span class="section-badge">أهم 5 مؤشرات</span>
    </div>

    ${warningBannerHtml}

    <div class="kpi-grid">
      ${summaryCardsHtml}
    </div>
  </div>

  <!-- COMPETITOR PRICING TABLE SECTION -->
  <div class="section-container">
    <div class="section-title">
      <span>2. جدول أسعار المنافسين (Competitor Pricing Table)</span>
      <span class="section-badge">${data.competitorTable.length} منتج مسجل</span>
    </div>
    
    <div style="font-size: 8.5pt; color: #64748b; margin-bottom: 10px;">
      * لكل منتج من منتجات البراند، يتم إدراج أقرب 3 منافسين في نفس الفئة بحجم مطابق (±20%) مع نسبة الفرق ومن الأرخص سعراً.
    </div>

    <div class="table-container">
      <table class="report-table">
        <thead>
          <tr>
            <th class="col-num">#</th>
            <th class="col-product">منتج ${data.brand}</th>
            <th class="col-price">السعر الحالي وسعر الوحدة</th>
            <th class="col-comps">أقرب المنافسين (نفس الفئة + الحجم ±20%)</th>
          </tr>
        </thead>
        <tbody>
          ${competitorRowsHtml}
        </tbody>
      </table>
    </div>
  </div>

  <!-- OUT OF STOCK SECTION -->
  <div class="section-container page-break">
    <div class="section-title">
      <span>3. تحليل نفاد المخزون (Out of Stock Analysis)</span>
      <span class="section-badge">آخر ${data.days} يوماً</span>
    </div>

    <div style="font-size: 8.5pt; color: #64748b; margin-bottom: 12px;">
      * تتبع المنتجات التي سُجلت بحالة نفاد المخزون (in_stock = 0) في أي لقطة سعرية خلال الـ ${data.days} يوماً السابقة، ونسبة الوقت الذي كانت فيه غير متاحة.
    </div>

    ${oosSectionHtml}
  </div>

  <!-- PROMOTIONS & DEALS SECTION -->
  <div class="section-container">
    <div class="section-title">
      <span>4. عروض وتخفيضات آخر ${data.days} يوماً (Promotions & Deals)</span>
      <span class="section-badge">مقارنة بـ P30 التاريخي</span>
    </div>

    <div class="promo-grid">
      <div class="promo-card">
        <div class="promo-val">${promo.p30DropCount}</div>
        <div class="promo-label">انخفاضات تحت سعر P30</div>
      </div>
      <div class="promo-card">
        <div class="promo-val">${promo.deepestDiscountPct}%</div>
        <div class="promo-label">أعمق خصم مرصود</div>
      </div>
      <div class="promo-card">
        <div class="promo-val">${promo.avgPromoDurationDays} يوم</div>
        <div class="promo-label">متوسط مدة العرض الترويجي</div>
      </div>
      <div class="promo-card">
        <div class="promo-val">${promo.promoSyncRatePct}%</div>
        <div class="promo-label">نسبة التزامن مع عروض المنافسين</div>
      </div>
    </div>

    <div class="promo-sync-box">
      <strong>تحليل تزامن العروض:</strong> ${promo.promoSyncStatus}. 
      يعكس هذا المؤشر ما إذا كانت العروض والخصومات التي يقدمها البراند تتم بشكل مستقل استجابة لخططه الخاصة، أم تتزامن في نفس الأيام مع عروض المنافسين في نفس الفئات.
    </div>
  </div>

  <!-- PRICE INDEX SECTION -->
  <div class="section-container page-break">
    <div class="section-title">
      <span>5. مؤشر سعر الوحدة للفئة (Price Index)</span>
      <span class="section-badge">سعر الوحدة ÷ وسيط الفئة</span>
    </div>

    <div style="font-size: 8.5pt; color: #64748b; margin-bottom: 12px;">
      * مؤشر السعر (Price Index) يقيس تموضع سعر وحدة المنتج مقارنة بالوسيط السوقي لفئته. (أقل من 1.0x = أقل تكلفة من وسيط السوق، أعلى من 1.0x = سعر بريميوم).
    </div>

    <div class="chart-container">
      ${data.priceIndex.svgChart}
    </div>
  </div>

  <!-- METHODOLOGY & DISCLAIMER -->
  <div class="disclaimer-box">
    <div class="disclaimer-title">المنهجية وإخلاء المسؤولية (Methodology & Legal Disclaimer)</div>
    <p style="margin: 4px 0;">
      <strong>المنهجية:</strong> تم رصد وجمع هذه البيانات آلياً بصورة دورية من صفحات متجر Amazon Egypt Tez / Now العامة المتاحة للجمهور. 
      تعتمد الحسابات على أحدث اللقطات السعرية الموثقة لكل منتج وأسعاره التاريخية المسجلة. 
      يتم حساب سعر الوحدة والمؤشرات الإحصائية (الوسيط و P30) عبر نماذج حسابية محددة وقابلة للتدقيق.
    </p>
    <p style="margin: 4px 0;">
      <strong>إخلاء مسؤولية:</strong> الأسعار والبيانات الواردة في هذا التقرير تمثل الأسعار المعلنة لحظة الرصد، وقد تتغير في أي وقت دون إشعار مسبق. 
      هذا التقرير مُعد لأغراض الرصد والتحليل الداخلي فقط، ولا يمثل بأي حال من الأحوال نصيحة استثمارية أو توصية تسعيرية أو تدخلاً في قرارات التسعير المستقلة للشركات.
    </p>
  </div>

</body>
</html>`;
}

// Main execution function
async function main() {
  const options = parseArgs();
  console.log('===============================================================');
  console.log(`   📊 توليد تقرير أسعار المنافسة — ${options.brand}          `);
  console.log('===============================================================');
  console.log(`🏷️ البراند: ${options.brand}`);
  console.log(`⏱️ النطاق الزمني: آخر ${options.days} يوماً`);
  console.log(`📁 مسار الإخراج: ${options.out}`);

  const startTime = Date.now();

  // 1. Fetch data & calculations from src/report_queries.js
  console.log('[*] جاري استعلام وتحليل بيانات البراند والمنافسين من الداتابيز...');
  const reportData = getBrandReportData(options.brand, { days: options.days });

  if (reportData.productCount === 0) {
    console.warn(`[!] تحذير: لم يتم العثور على أي منتجات لبراند "${options.brand}" في قاعدة البيانات.`);
  } else {
    console.log(`[+] تم العثور على ${reportData.productCount} منتج للبراند (${reportData.daysObserved} أيام مراقبة).`);
  }

  if (reportData.isInsufficientData) {
    console.warn(`[!] تنبيه بيانات غير كافية: ${reportData.warningMessage}`);
  }

  // 2. Load Cairo font
  console.log('[*] جاري تحميل خط Cairo المحلي...');
  const fontBase64 = loadLocalFontBase64();
  if (fontBase64) {
    console.log('[+] تم تضمين خط Cairo بنجاح (Base64).');
  } else {
    console.warn('[-] لم يتم العثور على ملف خط Cairo المحلي في assets/fonts، سيتم الاعتماد على خطوط النظام.');
  }

  // 3. Generate HTML
  console.log('[*] جاري بناء قالب التقرير HTML...');
  const htmlContent = buildHtmlReport(reportData, fontBase64);

  // Write temporary HTML file
  const outDir = path.dirname(path.resolve(options.out));
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const tempHtmlPath = path.join(outDir, `.temp_report_${Date.now()}.html`);
  fs.writeFileSync(tempHtmlPath, htmlContent, 'utf-8');

  // 4. Generate PDF via Playwright
  console.log('[*] جاري تشغيل Playwright Headless Chromium لتوليد الـ PDF...');
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=medium']
  });

  const page = await browser.newPage();
  
  // Navigate to local HTML
  const fileUrl = 'file:///' + tempHtmlPath.replace(/\\/g, '/');
  await page.goto(fileUrl, { waitUntil: 'networkidle' });

  // Generate A4 PDF with background colors
  const pdfBuffer = await page.pdf({
    format: 'A4',
    printBackground: true,
    margin: {
      top: '12mm',
      bottom: '15mm',
      left: '10mm',
      right: '10mm'
    }
  });

  await browser.close();

  // Save PDF
  const resolvedOutPath = path.resolve(options.out);
  fs.writeFileSync(resolvedOutPath, pdfBuffer);

  // Clean up temporary HTML unless --keep-html was requested
  if (!options.keepHtml && fs.existsSync(tempHtmlPath)) {
    try {
      fs.unlinkSync(tempHtmlPath);
    } catch (e) {}
  }

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);
  const sizeKb = (pdfBuffer.length / 1024).toFixed(1);

  console.log('===============================================================');
  console.log(`✅ تم إنشاء التقرير بنجاح!`);
  console.log(`📄 الملف: ${resolvedOutPath}`);
  console.log(`📦 الحجم: ${sizeKb} KB`);
  console.log(`⏱️ الوقت المستغرق: ${durationSec} ثانية`);
  console.log('===============================================================');

  return {
    outPath: resolvedOutPath,
    sizeKb: parseFloat(sizeKb),
    durationSec: parseFloat(durationSec),
    reportData
  };
}

if (require.main === module) {
  main().catch(err => {
    console.error('[-] خطأ أثناء إنشاء التقرير:', err);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
  buildHtmlReport
};
