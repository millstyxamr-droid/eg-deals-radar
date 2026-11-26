#!/usr/bin/env node
/**
 * Telegram Channel Auto-Publisher
 * Invoked by hourly cron to process pending posts where scheduled_at <= now.
 * Respects Telegram's 20 messages/min rate limit with exponential backoff retries.
 * Supports --dry-run and --preview for inspection.
 */

const path = require('path');
require('../src/config');
const db = require('../src/db');
const repo = require('../src/repo');
const { buildPostContent, buildInlineKeyboard, generateDailySchedule, getCairoDateString, isPublishableDeal } = require('../src/channel_post');
const { sendPostToChannel, sleep, RATE_LIMIT_DELAY_MS } = require('../src/telegram');

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run') || args.includes('--preview');
  const forceNow = args.includes('--force-now') || args.includes('--preview');
  const autoSchedule = args.includes('--schedule') || args.includes('--preview');

  // Parse --limit N (defaults to posts_per_slot from config.json or 4)
  const config = require('../src/config');
  const userSettings = config.userSettings || {};
  let limit = null;
  const limitIdx = args.indexOf('--limit');
  if (limitIdx !== -1 && args[limitIdx + 1]) {
    limit = parseInt(args[limitIdx + 1], 10);
  } else if (args.includes('--preview')) {
    limit = 5;
  } else if (userSettings.telegram && typeof userSettings.telegram.posts_per_slot === 'number') {
    limit = userSettings.telegram.posts_per_slot;
  }

  console.log(`[post_channel] Starting publisher run at ${new Date().toISOString()}`);
  console.log(`[post_channel] Mode: ${isDryRun ? 'DRY-RUN (Simulated)' : 'PRODUCTION'}`);
  console.log(`[post_channel] Publishing limit per run: ${limit ? limit : 'unlimited'}`);

  // 1. Purge stale pending/failed queue items older than 6 hours so outdated prices are never posted
  if (!isDryRun) {
    try {
      const purged = db.prepare(`
        DELETE FROM channel_queue
        WHERE status IN ('pending', 'failed')
          AND datetime(scheduled_at) < datetime('now', '-6 hours')
      `).run();
      if (purged.changes > 0) {
        console.log(`[post_channel] Purged ${purged.changes} stale queue item(s) older than 6 hours.`);
      }
    } catch (e) {
      console.warn(`[post_channel] Stale queue purge skipped: ${e.message}`);
    }
  }

  // 2. Auto-schedule daily posts if requested or if queue is empty for today
  if (autoSchedule) {
    const today = getCairoDateString();
    const scheduledToday = repo.getScheduledAsinsForDate(today);
    if (scheduledToday.size === 0) {
      console.log(`[post_channel] Queue empty for today (${today}). Generating daily schedule...`);
      generateDailySchedule({ dateStr: today, allowFallback: false });
    }
  }

  // 2. Fetch pending posts scheduled_at <= now (or all pending if --force-now)
  const nowIso = new Date().toISOString();
  let pendingPosts = repo.getPendingChannelQueue(forceNow ? '9999-12-31' : nowIso);

  if (pendingPosts.length === 0) {
    console.log(`[post_channel] No pending posts ready to publish at this time.`);
    return;
  }

  console.log(`[post_channel] Found ${pendingPosts.length} post(s) ready to process.`);

  let postedCount = 0;
  let failedCount = 0;
  let skippedCount = 0;

  for (let i = 0; i < pendingPosts.length; i++) {
    const item = pendingPosts[i];

    // Hard gate: never publish an unverified deal. The queue may contain items
    // generated before the 7-day / 5-snapshot threshold was met (or a fallback
    // schedule); those must be skipped, not posted.
    if (!isPublishableDeal(item)) {
      skippedCount++;
      console.log(`[post_channel] SKIP ${item.asin}: not a verified deal (is_real_deal=${item.is_real_deal}, confidence=${item.confidence}, historical_discount=${item.historical_discount_pct}).`);
      if (!isDryRun) {
        repo.updateChannelQueueItem(item.id, {
          status: 'skipped',
          error: 'unverified deal: requires is_real_deal=1, high/medium confidence and real historical discount'
        });
      }
      continue;
    }

    if (limit && limit > 0 && postedCount >= limit) {
      console.log(`[post_channel] Reached publish limit (${limit}); stopping this run.`);
      break;
    }

    console.log(`\n[post_channel] Processing [${i + 1}/${pendingPosts.length}] ASIN: ${item.asin} (Slot: ${item.slot}, Scheduled: ${item.scheduled_at})...`);

    // Build post content in Egyptian Arabic with clean HTML hyperlink + inline keyboard
    const text = buildPostContent(item, item.slot);
    const replyMarkup = buildInlineKeyboard(item, item.slot);

    // Generate Desktop Amazon Screenshot Card (Yousif Ayman style)
    let imageUrl = item.image_url;
    const { validateProductImage } = require('../src/telegram');
    if (validateProductImage(imageUrl).valid) {
      try {
        const { generateDealCardImage } = require('../src/screenshot_card');
        const cardPath = await generateDealCardImage(item);
        if (cardPath && require('fs').existsSync(cardPath)) {
          imageUrl = cardPath;
        }
      } catch (err) {
        console.warn(`[post_channel] Screenshot card generation failed (${err.message}), fallback to image_url`);
      }
    } else {
      imageUrl = null;
    }

    try {
      const res = await sendPostToChannel({
        text,
        imageUrl,
        asin: item.asin,
        slot: item.slot,
        replyMarkup,
        dryRun: isDryRun
      });

      if (!isDryRun) {
        repo.updateChannelQueueItem(item.id, {
          status: 'posted',
          posted_at: new Date().toISOString(),
          message_id: res.message_id,
          error: null
        });
      }

      postedCount++;
      console.log(`[post_channel] Post completed for ASIN ${item.asin}. Status: ${isDryRun ? 'dry-run simulated' : 'posted'}`);
    } catch (err) {
      console.error(`[post_channel] Failed to publish ASIN ${item.asin}: ${err.message}`);
      if (!isDryRun) {
        repo.updateChannelQueueItem(item.id, {
          status: 'failed',
          error: err.message
        });
      }
      failedCount++;
    }

    // Rate-limiting delay between posts (20 messages/min -> ~3000ms)
    if (i < pendingPosts.length - 1) {
      const delayMs = isDryRun ? 100 : RATE_LIMIT_DELAY_MS;
      await sleep(delayMs);
    }
  }

  console.log(`\n[post_channel] Run completed! Posted/Simulated: ${postedCount}, Failed: ${failedCount}, Skipped (unverified): ${skippedCount}.`);
}

if (require.main === module) {
  main()
    .catch(err => {
      console.error(`[post_channel] Fatal error: ${err.message}`, err);
      process.exitCode = 1;
    })
    .finally(async () => {
      try {
        const { closeBrowser } = require('../src/screenshot_card');
        await closeBrowser();
      } catch (e) {}
      process.exit(process.exitCode || 0);
    });
}

module.exports = { main };
