/**
 * Amazon Egypt - Specific Product Price & Discount Tracker & Watchlist
 * 
 * Usage:
 *   node track_product.js --asin B0D4B1S9G3 --target 400
 *   node track_product.js --asin B0D4B1S9G3 --discount 25
 *   node track_product.js --asin B0D4B1S9G3 --target 400 --discount 30
 *   node track_product.js --url https://www.amazon.eg/dp/B0D4B1S9G3 -t 450
 *   node track_product.js --list
 *   node track_product.js --check
 */

const fs = require('fs');
const path = require('path');

const WATCHLIST_FILE = path.join(__dirname, 'watchlist.json');
const PRODUCTS_FILE = path.join(__dirname, 'products.json');

function loadWatchlist() {
  if (fs.existsSync(WATCHLIST_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(WATCHLIST_FILE, 'utf-8'));
    } catch (e) {
      return [];
    }
  }
  return [];
}

function saveWatchlist(list) {
  fs.writeFileSync(WATCHLIST_FILE, JSON.stringify(list, null, 2), 'utf-8');
}

function extractAsin(input) {
  if (!input) return null;
  const bareMatch = input.trim().match(/^[A-Z0-9]{10}$/i);
  if (bareMatch) return bareMatch[0].toUpperCase();

  const urlMatch = input.match(/\/(?:dp|gp\/product|product)\/([A-Z0-9]{10})/i);
  if (urlMatch) return urlMatch[1].toUpperCase();

  const tezMatch = input.match(/asin=([A-Z0-9]{10})/i);
  if (tezMatch) return tezMatch[1].toUpperCase();

  return null;
}

/**
 * Fetch live data for a specific ASIN directly from Amazon Egypt
 */
async function fetchProductLive(asin) {
  let playwright;
  try {
    playwright = require('playwright');
  } catch (e) {
    return null;
  }

  const url = `https://www.amazon.eg/dp/${asin}`;
  console.log(`[+] جاري فحص المنتج مباشرة من أمازون مصر: ${url}`);

  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'ar-EG'
  });
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });

    const data = await page.evaluate((productAsin) => {
      const titleEl = document.querySelector('#productTitle, #title, h1');
      const title = titleEl ? titleEl.innerText.trim() : 'Unknown Product';

      let currentPriceNum = null;
      let currentPriceText = '';
      const priceWhole = document.querySelector('.a-price .a-price-whole');
      const priceFraction = document.querySelector('.a-price .a-price-fraction');
      if (priceWhole) {
        const whole = priceWhole.innerText.replace(/[^\d]/g, '');
        const fraction = priceFraction ? priceFraction.innerText.replace(/[^\d]/g, '') : '00';
        currentPriceNum = parseFloat(`${whole}.${fraction}`);
        currentPriceText = `EGP ${currentPriceNum}`;
      } else {
        const priceOffscreen = document.querySelector('.a-price .a-offscreen');
        if (priceOffscreen) {
          currentPriceText = priceOffscreen.innerText.trim();
          const m = currentPriceText.match(/[\d,.]+/);
          if (m) currentPriceNum = parseFloat(m[0].replace(/,/g, ''));
        }
      }

      let oldPriceNum = null;
      let oldPriceText = null;
      const strikePrice = document.querySelector('.a-price[data-a-strike="true"] .a-offscreen, .basisPrice .a-offscreen');
      if (strikePrice) {
        oldPriceText = strikePrice.innerText.trim();
        const m = oldPriceText.match(/[\d,.]+/);
        if (m) oldPriceNum = parseFloat(m[0].replace(/,/g, ''));
      }

      let discount = null;
      const savingEl = document.querySelector('.savingsPercentage, .reinventPriceSavingsPercentageMargin');
      if (savingEl) {
        discount = savingEl.innerText.trim();
      }

      const imgEl = document.querySelector('#landingImage, #main-image, #imgBlkFront');
      const imgSrc = imgEl ? (imgEl.getAttribute('src') || '') : '';

      const availEl = document.querySelector('#availability');
      const availability = availEl ? availEl.innerText.trim() : 'متوفر';

      return {
        asin: productAsin,
        title,
        currentPrice: currentPriceText,
        currentPriceNum,
        oldPrice: oldPriceText,
        oldPriceNum,
        discount,
        availability,
        imgSrc,
        productUrl: `https://www.amazon.eg/dp/${productAsin}`
      };
    }, asin);

    return data;
  } catch (err) {
    console.error(`[-] خطأ أثناء جلب بيانات المنتج ${asin}:`, err.message);
    return null;
  } finally {
    await browser.close();
  }
}

/**
 * Add or update a product in the Watchlist with target price and/or target discount %
 */
async function trackProduct(input, targetPrice = null, targetDiscountPct = null) {
  const asin = extractAsin(input);
  if (!asin) {
    console.error('[-] كود ASIN أو الرابط غير صالح:', input);
    return;
  }

  const watchlist = loadWatchlist();
  let existingIndex = watchlist.findIndex(item => item.asin === asin);

  // Check if product exists in local products.json first
  let localData = null;
  if (fs.existsSync(PRODUCTS_FILE)) {
    try {
      const all = JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf-8'));
      localData = all.find(p => p.asin === asin);
    } catch (e) {}
  }

  // Fetch live or fallback to local database
  let itemData = await fetchProductLive(asin);
  if (!itemData && localData) {
    itemData = {
      asin: localData.asin,
      title: localData.title,
      currentPrice: localData.currentPrice,
      currentPriceNum: localData.currentPriceNum,
      oldPrice: localData.oldPrice || (localData.referencePrice ? `EGP ${localData.referencePrice}` : null),
      oldPriceNum: localData.oldPriceNum || localData.referencePrice,
      realDiscountPct: localData.realDiscountPct,
      discount: localData.discount,
      availability: 'متوفر',
      productUrl: localData.productUrl,
      imgSrc: localData.imgSrc
    };
  }

  if (!itemData) {
    console.error(`[-] لم يتم العثور على المنتج ${asin} في قاعدة البيانات المحلية. قم بتثبيت playwright أو تشغيل الكاشف أولاً.`);
    return;
  }

  const now = new Date().toISOString();
  const currentPrice = itemData.currentPriceNum;

  // Calculate discount percentage
  let realDiscountPct = itemData.realDiscountPct;
  if (realDiscountPct === undefined || realDiscountPct === null) {
    if (itemData.oldPriceNum && currentPrice && itemData.oldPriceNum > currentPrice) {
      realDiscountPct = Math.round(((itemData.oldPriceNum - currentPrice) / itemData.oldPriceNum) * 100);
    } else {
      realDiscountPct = 0;
    }
  }

  const targetP = targetPrice !== null && targetPrice !== undefined && targetPrice !== ''
    ? parseFloat(targetPrice) 
    : (existingIndex >= 0 ? watchlist[existingIndex].targetPrice : null);

  const targetD = targetDiscountPct !== null && targetDiscountPct !== undefined && targetDiscountPct !== ''
    ? parseFloat(targetDiscountPct) 
    : (existingIndex >= 0 ? watchlist[existingIndex].targetDiscountPct : null);

  const priceReached = Boolean(targetP && currentPrice && currentPrice <= targetP);
  const discountReached = Boolean(targetD && realDiscountPct && realDiscountPct >= targetD);
  const targetReached = Boolean(priceReached || discountReached);

  const trackerRecord = {
    asin,
    title: itemData.title,
    currentPrice: itemData.currentPrice || `EGP ${currentPrice}`,
    currentPriceNum: currentPrice,
    oldPrice: itemData.oldPrice,
    oldPriceNum: itemData.oldPriceNum,
    realDiscountPct: realDiscountPct,
    targetPrice: targetP,
    targetDiscountPct: targetD,
    lowestPriceObserved: existingIndex >= 0 
      ? Math.min(watchlist[existingIndex].lowestPriceObserved || currentPrice, currentPrice || 999999) 
      : currentPrice,
    highestPriceObserved: existingIndex >= 0 
      ? Math.max(watchlist[existingIndex].highestPriceObserved || currentPrice, currentPrice || 0) 
      : currentPrice,
    availability: itemData.availability || 'متوفر',
    productUrl: itemData.productUrl || `https://www.amazon.eg/dp/${asin}`,
    imgSrc: itemData.imgSrc,
    lastChecked: now,
    targetReached: targetReached,
    history: existingIndex >= 0 ? (watchlist[existingIndex].history || []) : []
  };

  trackerRecord.history.push({
    date: now,
    price: currentPrice,
    discountPct: realDiscountPct
  });

  if (existingIndex >= 0) {
    watchlist[existingIndex] = trackerRecord;
    console.log(`[✔] تم تحديث المنتج في قائمة التتبع: ${itemData.title}`);
  } else {
    watchlist.push(trackerRecord);
    console.log(`[✔] تم إضافة المنتج بنجاح إلى قائمة التتبع: ${itemData.title}`);
  }

  saveWatchlist(watchlist);
  printProductCard(trackerRecord);
  return trackerRecord;
}

/**
 * Check all products in watchlist for price drops and target fulfillment
 */
async function checkWatchlist() {
  const watchlist = loadWatchlist();
  if (watchlist.length === 0) {
    console.log('[i] قائمة المراقبة فارغة حالياً. استخدم: node track_product.js --asin <ASIN> لإضافة منتجات.');
    return;
  }

  console.log(`\n[*] بدء فحص ${watchlist.length} منتج في قائمة المراقبة...`);
  const alerts = [];

  for (let i = 0; i < watchlist.length; i++) {
    const item = watchlist[i];
    console.log(`(${i + 1}/${watchlist.length}) فحص: ${item.title.slice(0, 40)}...`);
    
    // Live or local check
    let live = await fetchProductLive(item.asin);
    if (!live && fs.existsSync(PRODUCTS_FILE)) {
      try {
        const all = JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf-8'));
        const found = all.find(p => p.asin === item.asin);
        if (found) live = found;
      } catch (e) {}
    }

    if (live && live.currentPriceNum) {
      const prevPrice = item.currentPriceNum;
      item.currentPriceNum = live.currentPriceNum;
      item.currentPrice = live.currentPrice || `EGP ${live.currentPriceNum}`;
      item.oldPrice = live.oldPrice;
      item.oldPriceNum = live.oldPriceNum;
      item.lastChecked = new Date().toISOString();

      let discPct = live.realDiscountPct;
      if (discPct === undefined || discPct === null) {
        if (item.oldPriceNum && item.currentPriceNum && item.oldPriceNum > item.currentPriceNum) {
          discPct = Math.round(((item.oldPriceNum - item.currentPriceNum) / item.oldPriceNum) * 100);
        } else {
          discPct = 0;
        }
      }
      item.realDiscountPct = discPct;

      if (!item.lowestPriceObserved || item.currentPriceNum < item.lowestPriceObserved) {
        item.lowestPriceObserved = item.currentPriceNum;
      }
      if (!item.highestPriceObserved || item.currentPriceNum > item.highestPriceObserved) {
        item.highestPriceObserved = item.currentPriceNum;
      }

      if (!item.history) item.history = [];
      item.history.push({
        date: item.lastChecked,
        price: live.currentPriceNum,
        discountPct: discPct
      });

      // Check Target Reached (Price OR Discount %)
      const priceReached = Boolean(item.targetPrice && item.currentPriceNum && item.currentPriceNum <= item.targetPrice);
      const discountReached = Boolean(item.targetDiscountPct && discPct && discPct >= item.targetDiscountPct);

      if (priceReached && discountReached) {
        item.targetReached = true;
        alerts.push({
          type: 'TARGET_ALL_REACHED',
          item,
          message: `🎯 وصل للهدفين معاً! السعر: EGP ${item.currentPriceNum} (المستهدف: ${item.targetPrice}) والخصم: ${discPct}% (المستهدف: ${item.targetDiscountPct}%)`
        });
      } else if (priceReached) {
        item.targetReached = true;
        alerts.push({
          type: 'TARGET_PRICE_REACHED',
          item,
          message: `🎯 وصل للسعر المستهدف! السعر الآن: EGP ${item.currentPriceNum} (المستهدف: EGP ${item.targetPrice})`
        });
      } else if (discountReached) {
        item.targetReached = true;
        alerts.push({
          type: 'TARGET_DISCOUNT_REACHED',
          item,
          message: `🎯 وصل لنسبة الخصم المستهدفة! الخصم الآن: ${discPct}% (المستهدف: ${item.targetDiscountPct}%) - السعر: EGP ${item.currentPriceNum}`
        });
      } else {
        item.targetReached = false;
      }

      // Price drop alert
      if (prevPrice && item.currentPriceNum < prevPrice) {
        alerts.push({
          type: 'PRICE_DROP',
          item,
          message: `⚡ هبوط سعر! نزل من EGP ${prevPrice} إلى EGP ${item.currentPriceNum} (وفر ${(prevPrice - item.currentPriceNum).toFixed(2)} ج.م)`
        });
      }
    }
  }

  saveWatchlist(watchlist);

  console.log('\n===============================================================');
  console.log('       🔔 تقرير فحص قائمة المراقبة (Watchlist Report)          ');
  console.log('===============================================================');
  if (alerts.length > 0) {
    console.log(`🔥 تم رصد ${alerts.length} تنبيه(ات):`);
    alerts.forEach((alt, idx) => {
      console.log(`\n[تنبيه #${idx + 1}] ${alt.message}`);
      console.log(`📦 المنتج: ${alt.item.title}`);
      console.log(`🔗 الرابط: ${alt.item.productUrl}`);
    });
  } else {
    console.log('✅ تم الفحص: الأسعار مستقرة أو مسجلة في قائمة المتابعة.');
  }
  console.log('===============================================================\n');
}

function listWatchlist() {
  const watchlist = loadWatchlist();
  console.log('\n===============================================================');
  console.log(`   📋 قائمة المنتجات المراقبة (${watchlist.length} منتج)   `);
  console.log('===============================================================');
  if (watchlist.length === 0) {
    console.log('لا توجد منتجات مضافة بعد.');
    return;
  }
  watchlist.forEach((p, idx) => {
    printProductCard(p, idx + 1);
  });
}

function printProductCard(p, num = 1) {
  console.log(`-----------------------------------------------------------`);
  console.log(`#${num} [${p.asin}] ${p.title}`);
  console.log(`💵 السعر الحالي: ${p.currentPrice}`);
  if (p.oldPrice) console.log(`🏷️ السعر السابق: ${p.oldPrice}`);
  if (p.realDiscountPct) console.log(`🔥 نسبة الخصم الحالية: ${p.realDiscountPct}%`);
  
  if (p.targetPrice || p.targetDiscountPct) {
    const goals = [];
    if (p.targetPrice) goals.push(`سعر <= ${p.targetPrice} ج.م`);
    if (p.targetDiscountPct) goals.push(`خصم >= ${p.targetDiscountPct}%`);
    const status = p.targetReached ? '🎯 تحقق الهدف!' : `⏳ بانتظار الهدف`;
    console.log(`🎯 المستهدف: ${goals.join(' أو ')} -> ${status}`);
  }
  console.log(`📉 أقل سعر: EGP ${p.lowestPriceObserved} | 📈 أعلى سعر: EGP ${p.highestPriceObserved}`);
  console.log(`🔗 الرابط: ${p.productUrl}`);
  console.log(`🕒 آخر فحص: ${p.lastChecked}\n`);
}

// CLI Argument Handling
async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--list') || args.includes('-l')) {
    listWatchlist();
    return;
  }

  if (args.includes('--check') || args.includes('-c')) {
    await checkWatchlist();
    return;
  }

  let asinOrUrl = null;
  let targetPrice = null;
  let targetDiscount = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--asin' || args[i] === '-a' || args[i] === '--url' || args[i] === '-u' || args[i] === '--add') {
      asinOrUrl = args[i + 1];
    }
    if (args[i] === '--target' || args[i] === '-t') {
      const val = args[i + 1];
      if (val && val.includes('%')) {
        targetDiscount = val.replace('%', '');
      } else {
        targetPrice = val;
      }
    }
    if (args[i] === '--discount' || args[i] === '-d') {
      const val = args[i + 1];
      if (val) targetDiscount = val.replace('%', '');
    }
  }

  if (!asinOrUrl && args.length > 0 && !args[0].startsWith('-')) {
    asinOrUrl = args[0];
    if (args[1]) {
      if (args[1].includes('%')) {
        targetDiscount = args[1].replace('%', '');
      } else if (!isNaN(args[1])) {
        targetPrice = args[1];
      }
    }
  }

  if (asinOrUrl) {
    await trackProduct(asinOrUrl, targetPrice, targetDiscount);
  } else {
    console.log(`
استخدام متعقب المنتج (Product Price & Discount Tracker):

  1. تتبع منتج مع تحديد سعر مستهدف (Target Price):
     node track_product.js --asin B0D4B1S9G3 --target 400
     node track_product.js --url https://www.amazon.eg/dp/B0D4B1S9G3 -t 420

  2. تتبع منتج مع تحديد نسبة خصم مستهدفة (Target Discount %):
     node track_product.js --asin B0D4B1S9G3 --discount 25
     node track_product.js --asin B0D4B1S9G3 -t 30%

  3. تتبع منتج بالسعر ونسبة الخصم معاً:
     node track_product.js --asin B0D4B1S9G3 --target 400 --discount 25

  4. عرض قائمة المنتجات المراقبة:
     node track_product.js --list

  5. فحص المنتجات والتنبيه بوصول السعر أو الخصم المستهدف:
     node track_product.js --check
    `);
  }
}

if (require.main === module) {
  main();
}

module.exports = { trackProduct, checkWatchlist, loadWatchlist, listWatchlist };
