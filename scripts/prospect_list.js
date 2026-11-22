/**
 * Amazon Egypt Tez / Now - High-Value Prospect Brands Identifier
 * 
 * Extracts and ranks the top prospective client brands from SQLite database
 * based on product volume, stockout incidents, and price volatility.
 * 
 * Usage:
 *   node scripts/prospect_list.js
 *   node scripts/prospect_list.js --limit 20
 *   node scripts/prospect_list.js --json
 *   node scripts/prospect_list.js --csv
 */

const fs = require('fs');
const path = require('path');
const { getProspectList } = require('../src/report_queries');

function parseArgs() {
  const args = process.argv.slice(2);
  let limit = 20;
  let jsonOutput = false;
  let csvOutput = false;
  let saveFiles = true;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) {
      limit = parseInt(args[i + 1], 10) || 20;
      i++;
    } else if (args[i] === '--json') {
      jsonOutput = true;
    } else if (args[i] === '--csv') {
      csvOutput = true;
    } else if (args[i] === '--no-save') {
      saveFiles = false;
    }
  }

  return { limit, jsonOutput, csvOutput, saveFiles };
}

function formatTable(prospects) {
  const header = `=======================================================================================================================
   🎯 قائمة أهم 20 عميل محتمل (B2B Prospect List) — مرتبة حسب أولوية الاستهداف التجاري
=======================================================================================================================
#   العلامة التجارية      المنتجات    نفاد المخزون   تقلبات السعر   نقاط الأولوية   مستوى الأولوية   الفئات الرئيسية
-----------------------------------------------------------------------------------------------------------------------`;

  const rows = prospects.map((p, idx) => {
    const rank = String(idx + 1).padEnd(3, ' ');
    const brand = p.brand.padEnd(20, ' ');
    const prods = String(p.product_count).padStart(7, ' ');
    const oos = String(p.stockout_count).padStart(12, ' ');
    const changes = String(p.price_changes).padStart(12, ' ');
    const score = String(p.priority_score).padStart(13, ' ');
    const tier = p.priority_tier.padEnd(16, ' ');
    const cats = p.categories.slice(0, 32);

    return `${rank} ${brand} ${prods}   ${oos}   ${changes}   ${score}   ${tier} ${cats}`;
  });

  const footer = `-----------------------------------------------------------------------------------------------------------------------
معادلة الترتيب: (عدد المنتجات × 3) + (حالات نفاد المخزون × 10) + (تقلبات السعر × 5)
💡 البيانات جاهزة لتوليد تقارير الفرص: node scripts/lead_report.js --brand "اسم_البراند"
=======================================================================================================================`;

  return [header, ...rows, footer].join('\n');
}

function exportCsv(prospects, filePath) {
  const headers = ['الترتيب', 'العلامة التجارية', 'عدد المنتجات', 'المنتجات المسعرة', 'حالات نفاد المخزون', 'التقلبات السعرية', 'نقاط الأولوية', 'مستوى الأولوية', 'الفئات الرئيسية'];
  const escapeCsv = (val) => `"${String(val !== null && val !== undefined ? val : '').replace(/"/g, '""')}"`;

  const rows = prospects.map((p, idx) => [
    idx + 1,
    p.brand,
    p.product_count,
    p.priced_count,
    p.stockout_count,
    p.price_changes,
    p.priority_score,
    p.priority_tier,
    p.categories
  ].map(escapeCsv).join(','));

  const content = '\uFEFF' + [headers.map(escapeCsv).join(','), ...rows].join('\r\n');
  fs.writeFileSync(filePath, content, 'utf-8');
}

function main() {
  const { limit, jsonOutput, csvOutput, saveFiles } = parseArgs();

  const prospects = getProspectList(limit);

  if (prospects.length === 0) {
    console.log('[-] لم يتم العثور على براندات مؤهلة في قاعدة البيانات.');
    return;
  }

  // Ensure reports directory exists
  const reportsDir = path.join(__dirname, '..', 'reports');
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  if (saveFiles) {
    const jsonPath = path.join(reportsDir, 'prospects.json');
    const csvPath = path.join(reportsDir, 'prospects.csv');
    fs.writeFileSync(jsonPath, JSON.stringify(prospects, null, 2), 'utf-8');
    exportCsv(prospects, csvPath);
  }

  if (jsonOutput) {
    console.log(JSON.stringify(prospects, null, 2));
    return;
  }

  if (csvOutput) {
    const csvPath = path.join(reportsDir, 'prospects.csv');
    console.log(fs.readFileSync(csvPath, 'utf-8'));
    return;
  }

  console.log(formatTable(prospects));
  if (saveFiles) {
    console.log(`[✔] تم حفظ القائمة بصيغة JSON: reports/prospects.json`);
    console.log(`[✔] تم حفظ القائمة بصيغة CSV:  reports/prospects.csv`);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  formatTable,
  exportCsv,
  main
};
