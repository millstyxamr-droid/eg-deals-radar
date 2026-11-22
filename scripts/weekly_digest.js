#!/usr/bin/env node

/**
 * scripts/weekly_digest.js
 * 
 * Weekly B2B Outreach Digest Generator
 * 
 * Prepares 3 customized PDF Lead Reports each week for 3 target brands,
 * and maintains an outreach follow-up tracker in reports/outreach_tracker.csv
 * with status workflow (لم يُرسل / اتبعث / اتقرأ / رد).
 * 
 * STRICT HUMAN-IN-THE-LOOP RULE:
 * Automated sending is prohibited. Files are generated, and a human reviews,
 * personalizes the message, and sends manually.
 * 
 * Usage:
 *   node scripts/weekly_digest.js
 *   node scripts/weekly_digest.js --brands "Domty,Juhayna,Almarai"
 *   node scripts/weekly_digest.js --week 47
 */

const fs = require('fs');
const path = require('path');
const { getProspectList, getBrandReportData } = require('../src/report_queries');
const { buildLeadHtmlReport } = require('./lead_report');
const { chromium } = require('playwright');

// Parse CLI options
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    brands: null,
    week: null,
    year: new Date().getFullYear(),
    days: 30
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--brands' && args[i + 1]) {
      options.brands = args[++i].split(',').map(s => s.trim()).filter(Boolean);
    } else if (arg === '--week' && args[i + 1]) {
      options.week = parseInt(args[++i], 10);
    } else if (arg === '--days' && args[i + 1]) {
      options.days = parseInt(args[++i], 10) || 30;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
استخدام مُعد التقارير الأسبوعية (Weekly Digest):
  node scripts/weekly_digest.js
  node scripts/weekly_digest.js --brands "Domty,Juhayna,Almarai"

الخيارات:
  --brands <b1,b2,b3>  قائمة 3 براندات مستهدفة (افتراضي: أعلى 3 من قائمة العملاء المحتملين)
  --week <رقم>         رقم الأسبوع المستهدف
  --days <عدد>         نافذة الرصد بالأيام (افتراضي: 30)
      `);
      process.exit(0);
    }
  }

  // Calculate ISO week if not specified
  if (!options.week) {
    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const pastDaysOfYear = (now - startOfYear) / 86400000;
    options.week = Math.ceil((pastDaysOfYear + startOfYear.getDay() + 1) / 7);
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

// Generate single Lead PDF using Playwright
async function generateLeadPdf(browser, brandName, outPath, fontBase64, days = 30) {
  const reportData = getBrandReportData(brandName, { days });
  const htmlContent = buildLeadHtmlReport(reportData, fontBase64);

  const outDir = path.dirname(path.resolve(outPath));
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const tempHtmlPath = path.join(outDir, `.temp_digest_${Date.now()}_${Math.random().toString(36).substring(7)}.html`);
  fs.writeFileSync(tempHtmlPath, htmlContent, 'utf-8');

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

  await page.close();

  // Save PDF
  const resolvedOutPath = path.resolve(outPath);
  fs.writeFileSync(resolvedOutPath, pdfBuffer);

  // Clean temp HTML
  if (fs.existsSync(tempHtmlPath)) {
    try { fs.unlinkSync(tempHtmlPath); } catch (e) {}
  }

  return {
    path: resolvedOutPath,
    sizeKb: +(pdfBuffer.length / 1024).toFixed(1),
    productCount: reportData.productCount,
    isInsufficientData: reportData.isInsufficientData
  };
}

// Read existing tracking CSV into an array of objects
function readTrackerCsv(csvPath) {
  if (!fs.existsSync(csvPath)) return [];

  const raw = fs.readFileSync(csvPath, 'utf-8').replace(/^\uFEFF/, '');
  const lines = raw.split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length < 2) return [];

  // Parse CSV header
  const parseLine = (text) => {
    const result = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (char === '"') {
        if (inQuotes && text[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(cur);
        cur = '';
      } else {
        cur += char;
      }
    }
    result.push(cur);
    return result;
  };

  const headers = parseLine(lines[0]);
  const records = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseLine(lines[i]);
    if (cols.length >= 2) {
      const item = {};
      headers.forEach((h, idx) => {
        item[h] = cols[idx] !== undefined ? cols[idx] : '';
      });
      records.push(item);
    }
  }

  return records;
}

// Save tracking CSV
function writeTrackerCsv(csvPath, records) {
  const headers = [
    'العلامة التجارية',
    'الأسبوع',
    'اسم المسؤول',
    'قناة التواصل',
    'ملف التقرير',
    'الحالة',
    'تاريخ التجهيز',
    'تاريخ الإرسال',
    'تاريخ المتابعة',
    'ملاحظات'
  ];

  const escapeCsv = (val) => `"${String(val !== null && val !== undefined ? val : '').replace(/"/g, '""')}"`;

  const rows = records.map(r => [
    r['العلامة التجارية'] || r.brand || '',
    r['الأسبوع'] || r.week || '',
    r['اسم المسؤول'] || r.contact_name || '',
    r['قناة التواصل'] || r.contact_channel || 'WhatsApp / Email',
    r['ملف التقرير'] || r.pdf_path || '',
    r['الحالة'] || r.status || 'لم يُرسل',
    r['تاريخ التجهيز'] || r.created_at || new Date().toISOString().slice(0, 10),
    r['تاريخ الإرسال'] || r.sent_at || '',
    r['تاريخ المتابعة'] || r.follow_up_date || '',
    r['ملاحظات'] || r.notes || ''
  ].map(escapeCsv).join(','));

  const content = '\uFEFF' + [headers.map(escapeCsv).join(','), ...rows].join('\r\n');
  fs.writeFileSync(csvPath, content, 'utf-8');
}

async function main() {
  const startTime = Date.now();
  const options = parseArgs();

  console.log('========================================================================================');
  console.log(`   📅 مُعد التقارير والتواصل الأسبوعي (Weekly B2B Outreach Digest) — أسبوع ${options.year}-W${options.week}   `);
  console.log('========================================================================================');

  // 1. Determine target 3 brands
  let targetBrands = options.brands;
  if (!targetBrands || targetBrands.length === 0) {
    const prospects = getProspectList(10);
    // Prefer top 3 distinct brands
    targetBrands = prospects.slice(0, 3).map(p => p.brand);
  }

  // Ensure exactly 3 brands (or top available)
  targetBrands = targetBrands.slice(0, 3);
  console.log(`[*] البراندات المستهدفة لهذا الأسبوع: ${targetBrands.join('، ')}`);

  // Ensure reports directory exists
  const reportsDir = path.join(__dirname, '..', 'reports');
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  // 2. Load Cairo Font
  const fontBase64 = loadLocalFontBase64();

  // 3. Launch Playwright
  console.log('[*] جاري تشغيل Playwright Headless Chromium لإنشاء ملفات الـ PDF...');
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=medium']
  });

  const generatedFiles = [];
  const weekLabel = `${options.year}_w${options.week}`;

  for (const brand of targetBrands) {
    console.log(`\n⏳ جاري تجهيز تقرير "${brand}"...`);
    const safeBrand = brand.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    const relativePdfName = `lead_${safeBrand}_${weekLabel}.pdf`;
    const fullPdfPath = path.join(reportsDir, relativePdfName);

    try {
      const res = await generateLeadPdf(browser, brand, fullPdfPath, fontBase64, options.days);
      generatedFiles.push({
        brand,
        pdfPath: path.relative(path.join(__dirname, '..'), fullPdfPath).replace(/\\/g, '/'),
        sizeKb: res.sizeKb,
        productCount: res.productCount,
        warning: res.isInsufficientData
      });
      console.log(`  [✔] تم التوليد بنجاح: ${relativePdfName} (${res.sizeKb} KB)`);
    } catch (err) {
      console.error(`  [-] فشل توليد تقرير "${brand}":`, err.message);
    }
  }

  await browser.close();

  // 4. Update reports/outreach_tracker.csv
  const trackerPath = path.join(reportsDir, 'outreach_tracker.csv');
  const existingRecords = readTrackerCsv(trackerPath);

  const today = new Date().toISOString().slice(0, 10);
  const nextWeekDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10); // follow up after 3 days

  for (const item of generatedFiles) {
    const existingIndex = existingRecords.findIndex(
      r => (r['العلامة التجارية'] === item.brand || r.brand === item.brand) &&
           (r['الأسبوع'] === weekLabel || r.week === weekLabel)
    );

    const recordData = {
      'العلامة التجارية': item.brand,
      'الأسبوع': weekLabel,
      'اسم المسؤول': '',
      'قناة التواصل': 'WhatsApp / Email',
      'ملف التقرير': item.pdfPath,
      'الحالة': 'لم يُرسل',
      'تاريخ التجهيز': today,
      'تاريخ الإرسال': '',
      'تاريخ المتابعة': nextWeekDate,
      'ملاحظات': `تم الرصد آلياً (${item.productCount} منتج) — مراجعة وتخصيص قبل الإرسال`
    };

    if (existingIndex >= 0) {
      // Keep existing status/contact info, just update file path
      existingRecords[existingIndex]['ملف التقرير'] = item.pdfPath;
    } else {
      existingRecords.push(recordData);
    }
  }

  writeTrackerCsv(trackerPath, existingRecords);

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log('\n========================================================================================');
  console.log(`✅ اكتمل تجهيز التقارير الأسبوعية بنجاح (${durationSec} ثانية)`);
  console.log('========================================================================================');
  console.log('📄 ملفات الـ PDF الجاهزة:');
  generatedFiles.forEach((f, idx) => {
    console.log(`   ${idx + 1}. [${f.brand}] -> ${f.pdfPath} (${f.sizeKb} KB)`);
  });
  console.log(`\n📊 تم تحديث جدول المتابعة: reports/outreach_tracker.csv`);
  console.log('----------------------------------------------------------------------------------------');
  console.log('🚨 تنبيه تشغيلي ملزم (Human-in-the-Loop):');
  console.log('   1. ممنوع الإرسال التلقائي للعملاء دون مراجعة بشرية.');
  console.log('   2. قم بفتح ملف الـ PDF والتأكد من ملاءمة الأرقام للبراند.');
  console.log('   3. استخدم قالب reports/outreach.md لتجهيز نص الرسالة وتخصيص اسم المسؤول.');
  console.log('   4. أرسل الرسالة والملف يدوياً عبر البريد أو الواتساب.');
  console.log('   5. حدّث عمود "الحالة" في reports/outreach_tracker.csv إلى (اتبعث / اتقرأ / رد).');
  console.log('========================================================================================\n');

  return {
    week: weekLabel,
    generatedFiles,
    trackerPath
  };
}

if (require.main === module) {
  main().catch(err => {
    console.error('[-] خطأ أثناء تشغيل المُعد الأسبوعي:', err);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
  readTrackerCsv,
  writeTrackerCsv
};
