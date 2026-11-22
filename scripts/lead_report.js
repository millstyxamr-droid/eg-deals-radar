#!/usr/bin/env node

/**
 * scripts/lead_report.js
 * 
 * Generates a tailored B2B Lead PDF Report for a prospective client brand.
 * Includes the full Competitive Intelligence Report (Prompt 8) + a dedicated
 * "Opportunities & Strategic Action Plan" page (صفحة الفرص) with 3 concrete recommendations.
 * 
 * Usage:
 *   node scripts/lead_report.js --brand "Domty" --out reports/lead_domty_2026-11.pdf
 *   node scripts/lead_report.js --brand "Almarai"
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const {
  getBrandReportData,
  getOpportunitiesAndRecommendations
} = require('../src/report_queries');
const { buildHtmlReport } = require('./brand_report');

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
    if ((arg === '--brand' || arg === '-b') && args[i + 1]) {
      options.brand = args[++i];
    } else if (arg === '--days' && args[i + 1]) {
      options.days = parseInt(args[++i], 10) || 30;
    } else if ((arg === '--out' || arg === '-o') && args[i + 1]) {
      options.out = args[++i];
    } else if (arg === '--keep-html') {
      options.keepHtml = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
استخدام تقرير العميل المحتمل (Lead Report):
  node scripts/lead_report.js --brand "Domty" --out reports/lead_domty.pdf

الخيارات:
  --brand, -b <اسم>   اسم البراند (افتراضي: Domty)
  --days <عدد>        نافذة الأيام للتحليل (افتراضي: 30)
  --out, -o <مسار>    مسار ملف الـ PDF الناتج
  --keep-html         الاحتفاظ بملف HTML المؤقت
      `);
      process.exit(0);
    }
  }

  if (!options.out) {
    const now = new Date();
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const safeBrand = options.brand.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    options.out = path.join('reports', `lead_${safeBrand}_${yearMonth}.pdf`);
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

// Builds the Opportunities HTML Section
function buildOpportunitiesHtml(recommendations, brandName) {
  const priorityColors = {
    'قصوى': { bg: '#fee2e2', text: '#991b1b', border: '#fca5a5', icon: '🚨' },
    'عالية': { bg: '#fef3c7', text: '#92400e', border: '#fcd34d', icon: '⚡' },
    'متوسطة': { bg: '#e0f2fe', text: '#075985', border: '#7dd3fc', icon: '📈' },
    'إيجابية': { bg: '#dcfce7', text: '#166534', border: '#86efac', icon: '🛡️' }
  };

  const cardsHtml = recommendations.map(rec => {
    const pStyle = priorityColors[rec.priority] || priorityColors['عالية'];
    return `
      <div style="background: #ffffff; border: 1px solid #e2e8f0; border-right: 5px solid ${pStyle.border}; border-radius: 8px; padding: 18px 20px; margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.04);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 14pt;">${pStyle.icon}</span>
            <span style="font-size: 11pt; font-weight: 800; color: #0f172a;">${rec.num}. ${rec.title}</span>
          </div>
          <span style="background: ${pStyle.bg}; color: ${pStyle.text}; font-size: 8pt; font-weight: 700; padding: 3px 10px; border-radius: 12px; border: 1px solid ${pStyle.border};">
            أولوية ${rec.category}
          </span>
        </div>
        
        <div style="background: #f8fafc; border-radius: 6px; padding: 8px 12px; margin-bottom: 10px; font-size: 8.5pt; color: #475569; display: flex; align-items: center; gap: 6px;">
          <strong style="color: #0f172a;">المؤشر المرصود:</strong>
          <span>${rec.metric}</span>
        </div>

        <p style="font-size: 9.5pt; color: #334155; line-height: 1.6; margin: 0;">
          <strong>التوصية العملية:</strong> ${rec.action}
        </p>
      </div>
    `;
  }).join('');

  return `
    <div class="page-break" style="page-break-before: always; padding-top: 25px;">
      <!-- Page Header -->
      <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #0284c7; padding-bottom: 12px; margin-bottom: 24px;">
        <div>
          <span style="background: #e0f2fe; color: #0284c7; font-size: 8pt; font-weight: 800; padding: 3px 10px; border-radius: 12px; text-transform: uppercase;">
            خريطة الفرص الاستراتيجية
          </span>
          <h2 style="font-size: 16pt; font-weight: 800; color: #0f172a; margin: 6px 0 2px 0;">
            أبرز 3 فرص وتوصيات لزيادة الحصة البيعية لـ ${brandName}
          </h2>
          <p style="font-size: 8.5pt; color: #64748b; margin: 0;">
            توصيات تشغيلية وتسعيرية محددة مبنية على تحليل بيانات المتجر السريع (Amazon Tez/Now)
          </p>
        </div>
        <div style="text-align: left;">
          <span style="font-size: 8pt; color: #94a3b8; font-weight: 600;">تقرير حصري للعميل</span>
        </div>
      </div>

      <!-- Opportunities Cards -->
      <div style="margin-bottom: 25px;">
        ${cardsHtml}
      </div>

      <!-- Commercial B2B Offer Box -->
      <div style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); color: #ffffff; border-radius: 10px; padding: 20px 24px; margin-top: 20px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div>
            <span style="background: #38bdf8; color: #0f172a; font-size: 7.5pt; font-weight: 800; padding: 2px 8px; border-radius: 10px; display: inline-block; margin-bottom: 6px;">
              عرض تجريبي مجاني حصري
            </span>
            <h3 style="font-size: 12pt; font-weight: 800; margin: 0 0 6px 0; color: #ffffff;">
              احصل على تقرير المنافسة الأسبوعي الكامل لـ ${brandName} مجاناً لمدة شهر
            </h3>
            <p style="font-size: 8.5pt; color: #94a3b8; margin: 0; line-height: 1.5; max-width: 500px;">
              نراقب لك يومياً كافة تحركات المنافسين، تغيرات الأسعار الفورية، وتنبيهات نفاد المخزون على مدار الساعة عبر تقارير رقمية ولوحة تحكم مخصصة.
            </p>
          </div>
          <div style="text-align: center; background: rgba(255,255,255,0.08); padding: 12px 18px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.15);">
            <div style="font-size: 8pt; color: #38bdf8; font-weight: 700; margin-bottom: 4px;">للطلب والاستفسار</div>
            <div style="font-size: 10pt; font-weight: 800; color: #ffffff;">رد بـ "تمام"</div>
            <div style="font-size: 7.5pt; color: #94a3b8; margin-top: 2px;">لاستلام تقرير الأسبوع القادم</div>
          </div>
        </div>
      </div>
    </div>
  `;
}

// Injects the Opportunities page into the full Prompt 8 HTML report
function buildLeadHtmlReport(reportData, fontBase64) {
  const baseHtml = buildHtmlReport(reportData, fontBase64);
  const recommendations = getOpportunitiesAndRecommendations(reportData);
  const opportunitiesHtml = buildOpportunitiesHtml(recommendations, reportData.brand);

  // Inject before the Methodology & Disclaimer section
  const disclaimerMarker = '<div class="disclaimer-section">';
  if (baseHtml.includes(disclaimerMarker)) {
    return baseHtml.replace(disclaimerMarker, opportunitiesHtml + '\n' + disclaimerMarker);
  }

  // Fallback: inject before closing body
  return baseHtml.replace('</body>', opportunitiesHtml + '\n</body>');
}

async function main() {
  const startTime = Date.now();
  const options = parseArgs();

  console.log('===============================================================');
  console.log(`   🎯 توليد تقرير العميل المحتمل (Lead Report) لـ "${options.brand}"   `);
  console.log('===============================================================');

  // 1. Fetch data
  console.log(`[*] جاري استعلام بيانات البراند والمنافسين والتوصيات...`);
  const reportData = getBrandReportData(options.brand, { days: options.days });

  if (!reportData || reportData.productCount === 0) {
    console.warn(`[-] لم يتم العثور على منتجات مسجلة للبراند "${options.brand}" في قاعدة البيانات.`);
  } else {
    console.log(`[+] تم العثور على ${reportData.productCount} منتج (${reportData.daysObserved} أيام مراقبة).`);
  }

  // 2. Load Cairo Font
  const fontBase64 = loadLocalFontBase64();

  // 3. Generate HTML with Opportunities Page
  console.log('[*] جاري بناء قالب HTML المتكامل (تقرير المنافسة + صفحة الفرص)...');
  const htmlContent = buildLeadHtmlReport(reportData, fontBase64);

  // Write temporary HTML file
  const resolvedOutPath = path.resolve(options.out);
  const outDir = path.dirname(resolvedOutPath);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const tempHtmlPath = path.join(outDir, `.temp_lead_${Date.now()}.html`);
  fs.writeFileSync(tempHtmlPath, htmlContent, 'utf-8');

  // 4. Generate PDF via Playwright
  console.log('[*] جاري تشغيل Playwright Headless Chromium لإنشاء الـ PDF...');
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=medium']
  });

  const page = await browser.newPage();
  const fileUrl = 'file:///' + tempHtmlPath.replace(/\\/g, '/');
  await page.goto(fileUrl, { waitUntil: 'networkidle' });

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
  fs.writeFileSync(resolvedOutPath, pdfBuffer);

  // Clean up temporary HTML
  if (!options.keepHtml && fs.existsSync(tempHtmlPath)) {
    try {
      fs.unlinkSync(tempHtmlPath);
    } catch (e) {}
  }

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);
  const sizeKb = (pdfBuffer.length / 1024).toFixed(1);

  console.log('===============================================================');
  console.log(`✅ تم إنشاء تقرير العميل المحتمل بنجاح!`);
  console.log(`📄 مسار الملف: ${resolvedOutPath}`);
  console.log(`📦 الحجم: ${sizeKb} KB`);
  console.log(`⏱️ الوقت المستغرق: ${durationSec} ثانية`);
  console.log(`💡 تذكير: يجب مراجعة محتوى التقرير بشرياً قبل إرساله للعميل.`);
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
    console.error('[-] خطأ أثناء إنشاء تقرير العميل المحتمل:', err);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
  buildOpportunitiesHtml,
  buildLeadHtmlReport
};
