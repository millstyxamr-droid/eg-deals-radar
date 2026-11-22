/**
 * Amazon Egypt Tez / Now - Alert Engine & Daily Digest
 * Checks prices after each scraper run and triggers notifications:
 * - price_drop: Price dropped >= 10% vs previous snapshot
 * - target_price: Price <= user target price in watchlist
 * - historical_low: Product hit its all-time lowest price
 * - back_in_stock: in_stock flipped from 0 to 1
 * - Deduplication: Max 1 alert per (asin, rule) in 24 hours
 * - Daily Digest: Top 10 verified deals sent at 9:00 AM Cairo time
 */

const repo = require('./repo');
const db = require('./db');
const pricing = require('./pricing');
const telegram = require('./telegram');
const config = require('./config');

/**
 * Builds affiliate URL with configured tag
 */
function buildAffiliateUrl(productUrl, asin) {
  const base = productUrl || `https://www.amazon.eg/dp/${asin}`;
  const tag = config.AMAZON_AFFILIATE_TAG;
  if (!tag) return base;
  return base.includes('?') ? `${base}&tag=${tag}` : `${base}?tag=${tag}`;
}

/**
 * Check and dispatch all alerts for active products
 */
async function checkAndSendAlerts(options = {}) {
  const targetChats = options.targetChats || config.ALLOWED_CHAT_IDS;
  if (targetChats.length === 0) {
    console.warn('[Alerts] No ALLOWED_CHAT_IDS configured in environment. Skipping alert delivery.');
    return { sent: 0, skipped: 0, checked: 0 };
  }

  console.log(`\n[Alerts] Checking alert rules for active products (Target Chats: ${targetChats.join(', ')})...`);

  const products = repo.getProductsForExport();
  const activeWatchlists = repo.getAllActiveWatchlists();
  const watchlistByAsin = new Map();

  for (const item of activeWatchlists) {
    if (!watchlistByAsin.has(item.asin)) {
      watchlistByAsin.set(item.asin, []);
    }
    watchlistByAsin.get(item.asin).push(item);
  }

  let sentCount = 0;
  let skippedCount = 0;
  let checkedCount = 0;

  for (const p of products) {
    checkedCount++;
    const asin = p.asin;
    const currentPrice = p.currentPriceNum;
    if (currentPrice === null || currentPrice === undefined || currentPrice <= 0) {
      continue;
    }

    // Get current and previous snapshots
    const latestSnap = repo.getLatestSnapshot(asin);
    if (!latestSnap) continue;

    const prevSnap = repo.getPreviousSnapshot(asin, latestSnap.scraped_at);

    // Rule 1: price_drop (>= 10% drop compared to previous snapshot)
    if (prevSnap && prevSnap.price && prevSnap.price > currentPrice) {
      const dropAmount = +(prevSnap.price - currentPrice).toFixed(2);
      const dropPct = Math.round(((prevSnap.price - currentPrice) / prevSnap.price) * 100);

      if (dropPct >= 10) {
        const alreadySent = repo.wasAlertSent(asin, 'price_drop', 24);
        if (!alreadySent) {
          const success = await dispatchAlert({
            rule: 'price_drop',
            badge: `⚡ <b>هبوط كبير في السعر! (-${dropPct}%)</b>`,
            product: p,
            currentPrice,
            prevPrice: prevSnap.price,
            dropAmount,
            dropPct,
            targetChats
          });
          if (success) {
            sentCount++;
            repo.logAlert({
              asin,
              rule: 'price_drop',
              threshold: prevSnap.price,
              price: currentPrice,
              sent_at: new Date().toISOString(),
              channel: 'telegram',
              payload: { dropAmount, dropPct }
            });
          }
        } else {
          skippedCount++;
        }
      }
    }

    // Rule 2: target_price (Price <= user target price in watchlist)
    const watchers = watchlistByAsin.get(asin) || [];
    for (const watcher of watchers) {
      if (watcher.target_price && currentPrice <= watcher.target_price) {
        const alreadySent = repo.wasAlertSent(asin, `target_price_${watcher.chat_id}`, 24);
        if (!alreadySent) {
          const success = await dispatchAlert({
            rule: 'target_price',
            badge: `🎯 <b>وصل للسعر المستهدف! (أقل من EGP ${watcher.target_price})</b>`,
            product: p,
            currentPrice,
            prevPrice: prevSnap ? prevSnap.price : null,
            targetChats: [watcher.chat_id]
          });
          if (success) {
            sentCount++;
            repo.logAlert({
              asin,
              rule: `target_price_${watcher.chat_id}`,
              threshold: watcher.target_price,
              price: currentPrice,
              sent_at: new Date().toISOString(),
              channel: 'telegram',
              payload: { target_price: watcher.target_price }
            });
          }
        } else {
          skippedCount++;
        }
      }
    }

    // Rule 3: historical_low (all_time_low == true with verified history)
    if (p.all_time_low && p.confidence !== 'low') {
      const alreadySent = repo.wasAlertSent(asin, 'historical_low', 24);
      if (!alreadySent) {
        const success = await dispatchAlert({
          rule: 'historical_low',
          badge: `🔥 <b>أقل سعر تاريخي على الإطلاق! (All-Time Low)</b>`,
          product: p,
          currentPrice,
          prevPrice: p.typical_price,
          targetChats
        });
        if (success) {
          sentCount++;
          repo.logAlert({
            asin,
            rule: 'historical_low',
            threshold: p.typical_price,
            price: currentPrice,
            sent_at: new Date().toISOString(),
            channel: 'telegram',
            payload: { typical_price: p.typical_price, discount_pct: p.historical_discount_pct }
          });
        }
      } else {
        skippedCount++;
      }
    }

    // Rule 4: back_in_stock (in_stock flipped from 0 to 1)
    if (prevSnap && prevSnap.in_stock === 0 && latestSnap.in_stock === 1) {
      const alreadySent = repo.wasAlertSent(asin, 'back_in_stock', 24);
      if (!alreadySent) {
        const success = await dispatchAlert({
          rule: 'back_in_stock',
          badge: `📦 <b>عاد للتوفر من جديد! (Back in Stock)</b>`,
          product: p,
          currentPrice,
          targetChats
        });
        if (success) {
          sentCount++;
          repo.logAlert({
            asin,
            rule: 'back_in_stock',
            threshold: 1,
            price: currentPrice,
            sent_at: new Date().toISOString(),
            channel: 'telegram',
            payload: { in_stock: 1 }
          });
        }
      } else {
        skippedCount++;
      }
    }
  }

  console.log(`[Alerts] Evaluation finished. Checked: ${checkedCount}, Sent: ${sentCount}, Skipped (dedup 24h): ${skippedCount}`);
  return { sent: sentCount, skipped: skippedCount, checked: checkedCount };
}

/**
 * Dispatch an individual alert message with photo and HTML caption
 */
async function dispatchAlert({ badge, product, currentPrice, prevPrice, dropAmount, dropPct, targetChats }) {
  const asin = product.asin;
  const affiliateUrl = buildAffiliateUrl(product.productUrl, asin);

  const lines = [
    badge,
    '',
    `🏷️ <b>${telegram.escapeHtml(product.title)}</b>`,
    `📂 القسم: <i>${telegram.escapeHtml(product.category || 'عام')}</i>`,
    '',
    `💰 <b>السعر الآن:</b> <code>EGP ${currentPrice.toFixed(2)}</code>`
  ];

  if (prevPrice && prevPrice > currentPrice) {
    lines.push(`❌ <b>السعر السابق:</b> <strike>EGP ${prevPrice.toFixed(2)}</strike>`);
    if (dropAmount) {
      lines.push(`💵 <b>مقدار الهبوط:</b> EGP ${dropAmount} (${dropPct}%)`);
    }
  }

  if (product.historical_discount_pct && product.historical_discount_pct > 0) {
    lines.push(`📉 <b>الخصم التاريخي:</b> ${product.historical_discount_pct}% (المعتاد: EGP ${product.typical_price})`);
  }

  if (product.unit_price_formatted && product.unit_price_formatted !== '—') {
    lines.push(`⚖️ <b>سعر الوحدة:</b> ${product.unit_price_formatted}`);
  }

  lines.push('');
  lines.push(`🔗 <a href="${affiliateUrl}">عرض المنتج والشراء من أمازون مصر ↗</a>`);
  lines.push(`🆔 كود المنتج: <code>${asin}</code>`);

  const captionHtml = lines.join('\n');
  let anySuccess = false;

  for (const chatId of targetChats) {
    try {
      await telegram.sendPhoto(chatId, product.imgSrc, captionHtml);
      anySuccess = true;
    } catch (err) {
      console.error(`[Alerts] Failed to send alert to chat ${chatId}:`, err.message);
    }
  }

  return anySuccess;
}

/**
 * Send Daily Digest at 9:00 AM Cairo Time (Top 10 real deals)
 */
async function sendDailyDigest(options = {}) {
  const targetChats = options.targetChats || config.ALLOWED_CHAT_IDS;
  if (targetChats.length === 0) {
    console.warn('[Digest] No ALLOWED_CHAT_IDS configured in environment.');
    return false;
  }

  const products = repo.getProductsForExport();
  const realDeals = products
    .filter(p => p.is_real_deal && (p.confidence === 'high' || p.confidence === 'medium'))
    .sort((a, b) => (b.historical_discount_pct || 0) - (a.historical_discount_pct || 0))
    .slice(0, 10);

  const cairoDate = new Date().toLocaleDateString('ar-EG', {
    timeZone: 'Africa/Cairo',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const lines = [
    `☀️ <b>صباح الخير! ملخص أفضل عروض أمازون مصر</b>`,
    `📅 <i>${cairoDate} (بتوقيت القاهرة)</i>`,
    '━━━━━━━━━━━━━━━━━━━━',
    ''
  ];

  if (realDeals.length === 0) {
    lines.push('🎯 <i>لا توجد عروض حقيقية مؤكدة جديدة اليوم تستوفي شروط الخصم التاريخي. سنوافيك فور رصد أي هبوط حقيقي في الأسعار!</i>');
  } else {
    lines.push(`🔥 <b>أفضل ${realDeals.length} عروض مؤكدة تاريخياً اليوم:</b>\n`);

    realDeals.forEach((p, idx) => {
      const url = buildAffiliateUrl(p.productUrl, p.asin);
      const unit = p.unit_price_formatted && p.unit_price_formatted !== '—' ? ` | ⚖️ ${p.unit_price_formatted}` : '';
      lines.push(`${idx + 1}. <a href="${url}"><b>${telegram.escapeHtml(p.title)}</b></a>`);
      lines.push(`   💰 <b>EGP ${p.currentPriceNum}</b> (خصم حقيقي ${p.historical_discount_pct}% | وفر ${p.egpSaved} ج.م)${unit}`);
      lines.push('');
    });
  }

  lines.push('━━━━━━━━━━━━━━━━━━━━');
  lines.push('🤖 رادار كشف العروض الحقيقية | Amazon Egypt Deals Radar');

  const digestHtml = lines.join('\n');

  for (const chatId of targetChats) {
    try {
      await telegram.sendMessage(chatId, digestHtml);
      console.log(`[Digest] Successfully sent daily digest to chat ${chatId}`);
    } catch (err) {
      console.error(`[Digest] Failed to send digest to ${chatId}:`, err.message);
    }
  }

  return true;
}

/**
 * Checks if current time is around 9:00 AM Cairo Time
 */
function isCairo9AM() {
  const cairoTimeStr = new Date().toLocaleString('en-US', {
    timeZone: 'Africa/Cairo',
    hour: 'numeric',
    hour12: false
  });
  const hour = parseInt(cairoTimeStr, 10);
  return hour === 9;
}

// CLI handler
if (require.main === module) {
  (async () => {
    if (process.argv.includes('--digest')) {
      await sendDailyDigest();
    } else {
      await checkAndSendAlerts();
    }
  })();
}

module.exports = {
  checkAndSendAlerts,
  sendDailyDigest,
  buildAffiliateUrl,
  isCairo9AM
};
