#!/usr/bin/env node
/**
 * Telegram Channel Auto-Publisher
 * Invoked by hourly cron to process pending posts where scheduled_at <= now.
 * Respects Telegram's 20 messages/min rate limit with exponential backoff retries.
 * Supports --dry-run and --preview for inspection.
 */

const path = require('path');
const db = require('../src/db');
const repo = require('../src/repo');
const { buildPostContent, generateDailySchedule, getCairoDateString } = require('../src/channel_post');
const { sendPostToChannel, sleep, RATE_LIMIT_DELAY_MS } = require('../src/telegram');

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run') || args.includes('--preview');
  const forceNow = args.includes('--force-now') || args.includes('--preview');
  const autoSchedule = args.includes('--schedule') || args.includes('--preview');

  // Parse --limit N
  let limit = null;
  const limitIdx = args.indexOf('--limit');
  if (limitIdx !== -1 && args[limitIdx + 1]) {
    limit = parseInt(args[limitIdx + 1], 10);
  } else if (args.includes('--preview')) {
    limit = 5;
  }

  console.log(`[post_channel] Starting publisher run at ${new Date().toISOString()}`);
  console.log(`[post_channel] Mode: ${isDryRun ? 'DRY-RUN (Simulated)' : 'PRODUCTION'}`);

  // 1. Auto-schedule daily posts if requested or if queue is empty for today
  if (autoSchedule) {
    const today = getCairoDateString();
    const scheduledToday = repo.getScheduledAsinsForDate(today);
    if (scheduledToday.size === 0) {
      console.log(`[post_channel] Queue empty for today (${today}). Generating daily schedule...`);
      generateDailySchedule({ dateStr: today, allowFallback: isDryRun });
    }
  }

  // 2. Fetch pending posts scheduled_at <= now (or all pending if --force-now)
  const nowIso = new Date().toISOString();
  let pendingPosts = repo.getPendingChannelQueue(forceNow ? '9999-12-31' : nowIso);

  if (pendingPosts.length === 0) {
    console.log(`[post_channel] No pending posts ready to publish at this time.`);
    return;
  }

  if (limit && limit > 0) {
    pendingPosts = pendingPosts.slice(0, limit);
  }

  console.log(`[post_channel] Found ${pendingPosts.length} post(s) ready to process.`);

  let postedCount = 0;
  let failedCount = 0;

  for (let i = 0; i < pendingPosts.length; i++) {
    const item = pendingPosts[i];
    console.log(`\n[post_channel] Processing [${i + 1}/${pendingPosts.length}] ASIN: ${item.asin} (Slot: ${item.slot}, Scheduled: ${item.scheduled_at})...`);

    // Build post content in Egyptian Arabic with affiliate link
    const text = buildPostContent(item, item.slot);

    try {
      const res = await sendPostToChannel({
        text,
        imageUrl: item.image_url,
        asin: item.asin,
        slot: item.slot,
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

  console.log(`\n[post_channel] Run completed! Posted/Simulated: ${postedCount}, Failed: ${failedCount}.`);
}

if (require.main === module) {
  main().catch(err => {
    console.error(`[post_channel] Fatal error: ${err.message}`, err);
    process.exit(1);
  });
}

module.exports = { main };
