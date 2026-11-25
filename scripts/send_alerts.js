#!/usr/bin/env node
/**
 * Price Drop & Watchlist Alerts Runner
 * Invoked after each scraper + deals_tracker run to send instant Telegram alerts
 * to configured ALLOWED_CHAT_IDS when prices drop >= 10%, hit all-time lows,
 * or match user watchlist targets.
 */

require('../src/config');
const { checkAndSendAlerts } = require('../src/alerts');

(async () => {
  try {
    const result = await checkAndSendAlerts();
    console.log(`[send_alerts] Completed: checked=${result.checked}, sent=${result.sent}, skipped=${result.skipped}`);
  } catch (err) {
    console.error('[send_alerts] Error:', err.message);
    process.exitCode = 0; // Never fail the whole CI pipeline due to alert delivery
  }
})();
