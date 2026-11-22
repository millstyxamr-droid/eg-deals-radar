/**
 * Amazon Egypt Tez / Now - Telegram Bot Daemon (Long Polling)
 * Direct Telegram Bot API via native fetch.
 * Runs locally or on VPS.
 */

const config = require('./src/config');
const telegram = require('./src/telegram');
const repo = require('./src/repo');
const db = require('./src/db');
const pricing = require('./src/pricing');
const alerts = require('./src/alerts');

console.log('===============================================================');
console.log('   🤖 بوت تنبيهات ورادار عروض أمازون مصر (Amazon Egypt Deals)  ');
console.log('===============================================================');

/**
 * Check if incoming chat_id is permitted by whitelist
 */
function isChatAllowed(chatId) {
  const allowed = config.ALLOWED_CHAT_IDS;
  if (allowed.length === 0) return true; // if no whitelist configured, allow
  return allowed.includes(String(chatId));
}

/**
 * Helper to extract ASIN and target price from text
 */
function extractAsinAndTarget(text) {
  const parts = text.split(/\s+/).slice(1);
  if (parts.length === 0) return { asin: null, targetPrice: null };

  let asin = null;
  let targetPrice = null;

  for (const part of parts) {
    const urlMatch = part.match(/(?:dp|product|gp\/product)\/([A-Z0-9]{10})/i);
    if (urlMatch) {
      asin = urlMatch[1].toUpperCase();
      continue;
    }
    if (/^[A-Z0-9]{10}$/i.test(part)) {
      asin = part.toUpperCase();
      continue;
    }
    const num = parseFloat(part);
    if (!isNaN(num) && num > 0) {
      targetPrice = num;
    }
  }

  return { asin, targetPrice };
}

/**
 * Handle incoming message command
 */
async function handleMessage(msg) {
  if (!msg || !msg.chat || !msg.text) return;

  const chatId = msg.chat.id;
  const rawText = msg.text.trim();

  // Security check: Whitelist
  if (!isChatAllowed(chatId)) {
    console.warn(`[Security] Blocked unauthorized request from chat ID: ${chatId}`);
    try {
      await telegram.sendMessage(
        chatId,
        `⛔ <b>عذراً! هذا البوت خاص وغير مصرح لهذا الحساب بالوصول.</b>\nمعرف حسابك: <code>${chatId}</code>`
      );
    } catch (e) {}
    return;
  }

  const lowerText = rawText.toLowerCase();

  // 1. /start or /help
  if (lowerText.startsWith('/start') || lowerText.startsWith('/help')) {
    const helpHtml = [
      '👋 <b>أهلاً بك في رادار عروض وتنبيهات أمازون مصر!</b> 🛒🇪🇬',
      '',
      'أنا بوت متخصص في كشف العروض الحقيقية من المضللة، ومراقبة حركة الأسعار وسعر الوحدة لحظياً.',
      '',
      '📌 <b>الأوامر المتاحة:</b>',
      '• <code>/watch &lt;رابط أو ASIN&gt; [سعر_مستهدف]</code> — إضافة منتج للمراقبة',
      '• <code>/unwatch &lt;ASIN&gt;</code> — إزالة منتج من المراقبة',
      '• <code>/list</code> — عرض قائمة منتجاتك المراقبة بأسعارها الحالية',
      '• <code>/deals [عدد]</code> — أفضل العروض الحقيقية المؤكدة حالياً (افتراضي: 5)',
      '• <code>/stop</code> — إيقاف التنبيهات لحسابك',
      '• <code>/help</code> — عرض رسالة المساعدة هذه',
      '',
      '💡 <i>مثال:</i> <code>/watch B0D4B1S9G3 400</code>'
    ].join('\n');

    await telegram.sendMessage(chatId, helpHtml);
    return;
  }

  // 2. /watch <ASIN or URL> [targetPrice]
  if (lowerText.startsWith('/watch')) {
    const { asin, targetPrice } = extractAsinAndTarget(rawText);
    if (!asin) {
      await telegram.sendMessage(
        chatId,
        '⚠️ <b>يرجى إدخال كود ASIN أو رابط المنتج بأمازون.</b>\nمثال:\n<code>/watch B0D4B1S9G3 400</code>'
      );
      return;
    }

    // Add to DB watchlist
    repo.addToWatchlist({ chatId, asin, targetPrice });

    // Lookup product in DB
    const product = db.prepare('SELECT * FROM products WHERE asin = ?').get(asin);
    const snap = repo.getLatestSnapshot(asin);
    const currentPrice = snap ? snap.price : (product ? product.unit_price : null);

    const title = product ? product.title : `منتج أمازون (${asin})`;
    const unitPriceFormatted = product ? pricing.formatUnitPrice(product.unit_price, product.unit_price_unit) : '—';
    const affiliateUrl = alerts.buildAffiliateUrl(product ? product.product_url : null, asin);

    const lines = [
      '✅ <b>تمت إضافة المنتج إلى قائمة المراقبة بنجاح!</b>',
      '',
      `📦 <b>المنتج:</b> ${telegram.escapeHtml(title)}`,
      `💰 <b>السعر الحالي:</b> ${currentPrice ? `<code>EGP ${currentPrice.toFixed(2)}</code>` : '<i>جاري الكشط...</i>'}`,
      `⚖️ <b>سعر الوحدة:</b> ${unitPriceFormatted}`,
      `🎯 <b>السعر المستهدف:</b> ${targetPrice ? `<code>EGP ${targetPrice}</code>` : 'أي انخفاض بالأسعار'}`,
      '',
      `🔗 <a href="${affiliateUrl}">عرض المنتج على أمازون مصر ↗</a>`
    ];

    await telegram.sendMessage(chatId, lines.join('\n'));
    return;
  }

  // 3. /unwatch <ASIN>
  if (lowerText.startsWith('/unwatch')) {
    const { asin } = extractAsinAndTarget(rawText);
    if (!asin) {
      await telegram.sendMessage(chatId, '⚠️ <b>يرجى كتابة كود ASIN المراد حذفه.</b>\nمثال: <code>/unwatch B0D4B1S9G3</code>');
      return;
    }

    repo.removeFromWatchlist(chatId, asin);
    await telegram.sendMessage(chatId, `🗑️ <b>تم حذف المنتج <code>${asin}</code> من قائمة المراقبة بنجاح.</b>`);
    return;
  }

  // 4. /list
  if (lowerText.startsWith('/list')) {
    const items = repo.getWatchlist(chatId);
    if (!items || items.length === 0) {
      await telegram.sendMessage(
        chatId,
        '📋 <b>قائمة المراقبة الخاصة بك فارغة حالياً.</b>\nاستخدم <code>/watch &lt;ASIN&gt;</code> لإضافة منتجات جديدة.'
      );
      return;
    }

    const lines = [
      `📋 <b>قائمة منتجاتك المراقبة (${items.length}):</b>`,
      '━━━━━━━━━━━━━━━━━━━━',
      ''
    ];

    items.forEach((item, idx) => {
      const unitStr = item.unit_price ? pricing.formatUnitPrice(item.unit_price, item.unit_price_unit) : '—';
      const url = alerts.buildAffiliateUrl(item.product_url, item.asin);
      const title = item.title ? telegram.escapeHtml(item.title.slice(0, 50)) : item.asin;

      lines.push(`${idx + 1}. <a href="${url}"><b>${title}</b></a>`);
      lines.push(`   💰 السعر: <code>EGP ${item.current_price || '—'}</code> | ⚖️ ${unitStr}`);
      if (item.target_price) {
        lines.push(`   🎯 المستهدف: <code>EGP ${item.target_price}</code>`);
      }
      lines.push(`   ❌ إلغاء: <code>/unwatch ${item.asin}</code>`);
      lines.push('');
    });

    lines.push('━━━━━━━━━━━━━━━━━━━━');
    await telegram.sendMessage(chatId, lines.join('\n'));
    return;
  }

  // 5. /deals [count]
  if (lowerText.startsWith('/deals')) {
    const parts = rawText.split(/\s+/);
    let count = 5;
    if (parts.length > 1 && !isNaN(parseInt(parts[1], 10))) {
      count = Math.min(15, Math.max(1, parseInt(parts[1], 10)));
    }

    const products = repo.getProductsForExport();
    const realDeals = products
      .filter(p => p.is_real_deal && (p.confidence === 'high' || p.confidence === 'medium'))
      .sort((a, b) => (b.historical_discount_pct || 0) - (a.historical_discount_pct || 0))
      .slice(0, count);

    if (realDeals.length === 0) {
      await telegram.sendMessage(
        chatId,
        '🎯 <b>لا توجد عروض حقيقية مؤكدة حالياً.</b>\n\nنحن نستبعد العروض الوهمية والتخفيضات الشكلية، ونعتمد فقط على مقارنة السعر بالوسيط التاريخي (Typical Price) ومئوية p30 لفترة 90 يوماً.'
      );
      return;
    }

    const lines = [
      `🔥 <b>أفضل ${realDeals.length} عروض حقيقية مؤكدة حالياً:</b>`,
      '━━━━━━━━━━━━━━━━━━━━',
      ''
    ];

    realDeals.forEach((p, idx) => {
      const url = alerts.buildAffiliateUrl(p.productUrl, p.asin);
      const unit = p.unit_price_formatted && p.unit_price_formatted !== '—' ? ` | ⚖️ ${p.unit_price_formatted}` : '';
      lines.push(`${idx + 1}. <a href="${url}"><b>${telegram.escapeHtml(p.title)}</b></a>`);
      lines.push(`   💰 <b>EGP ${p.currentPriceNum}</b> (خصم حقيقي ${p.historical_discount_pct}% | وفر ${p.egpSaved} ج.م)`);
      lines.push(`   📊 المعتاد: EGP ${p.typical_price} | السعر العادل: EGP ${p.fair_price}${unit}`);
      lines.push('');
    });

    lines.push('━━━━━━━━━━━━━━━━━━━━');
    lines.push('🛒 للشراء اضغط على اسم المنتج أعلاه');
    await telegram.sendMessage(chatId, lines.join('\n'));
    return;
  }

  // 6. /stop
  if (lowerText.startsWith('/stop')) {
    repo.stopWatchlist(chatId);
    await telegram.sendMessage(
      chatId,
      '🛑 <b>تم إيقاف التنبيهات لحسابك بنجاح.</b>\nيمكنك إعادة تفعيل المراقبة في أي وقت بإضافة منتج عبر <code>/watch</code>.'
    );
    return;
  }

  // Unknown command
  await telegram.sendMessage(
    chatId,
    '❓ <b>أمر غير معروف.</b>\nاكتب <code>/help</code> لعرض قائمة الأوامر المتاحة.'
  );
}

/**
 * Handle incoming update object
 */
async function handleUpdate(update) {
  if (update.message) {
    await handleMessage(update.message);
  }
}

/**
 * Main long polling loop
 */
async function startBot() {
  if (!config.TELEGRAM_BOT_TOKEN) {
    console.error('[-] Error: TELEGRAM_BOT_TOKEN is not defined in .env! Bot cannot start.');
    process.exit(1);
  }

  console.log(`[Bot] Bot starting with Token: ${config.TELEGRAM_BOT_TOKEN.slice(0, 8)}...`);
  console.log(`[Bot] Whitelist filter: ${config.ALLOWED_CHAT_IDS.length > 0 ? config.ALLOWED_CHAT_IDS.join(', ') : 'None (open to all)'}`);

  let isRunning = true;
  let offset = 0;

  process.on('SIGINT', () => {
    console.log('\n[Bot] Stopping gracefully (SIGINT)...');
    isRunning = false;
  });
  process.on('SIGTERM', () => {
    console.log('\n[Bot] Stopping gracefully (SIGTERM)...');
    isRunning = false;
  });

  console.log('[Bot] Listening for Telegram updates (Long polling)...');

  while (isRunning) {
    try {
      const updates = await telegram.getUpdates(offset, 25);
      if (updates && updates.ok && Array.isArray(updates.result)) {
        for (const u of updates.result) {
          offset = u.update_id + 1;
          await handleUpdate(u);
        }
      }
    } catch (err) {
      if (!isRunning) break;
      console.error('[Bot] Polling loop error:', err.message);
      await new Promise(r => setTimeout(r, 4000));
    }
  }

  console.log('[Bot] Bot daemon stopped.');
}

if (require.main === module) {
  startBot();
}

module.exports = {
  handleMessage,
  handleUpdate,
  extractAsinAndTarget,
  isChatAllowed
};
