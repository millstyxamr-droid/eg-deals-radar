/**
 * Removes synthetic demo snapshots (source = 'seed_history') from the catalog DB
 * and clears derived caches that may have been computed from them.
 *
 * Usage:
 *   node scripts/purge_seed_history.js --dry-run   # preview only
 *   node scripts/purge_seed_history.js             # apply
 */

const db = require('../src/db');
const { UNTRUSTED_SNAPSHOT_SOURCES } = require('../src/pricing');

const DRY_RUN = process.argv.includes('--dry-run');
const placeholders = UNTRUSTED_SNAPSHOT_SOURCES.map(() => '?').join(', ');
const inClause = `source IN (${placeholders})`;

function countSnapshots() {
  return db.prepare(`SELECT COUNT(*) AS n FROM price_snapshots WHERE ${inClause}`)
    .get(...UNTRUSTED_SNAPSHOT_SOURCES).n;
}

function countAffectedProducts() {
  return db.prepare(
    `SELECT COUNT(DISTINCT asin) AS n FROM price_snapshots WHERE ${inClause}`
  ).get(...UNTRUSTED_SNAPSHOT_SOURCES).n;
}

function countPendingPosts() {
  return db.prepare(`SELECT COUNT(*) AS n FROM channel_queue WHERE status = 'pending'`).get().n;
}

function countScores() {
  return db.prepare(`SELECT COUNT(*) AS n FROM deals_scores`).get().n;
}

function main() {
  const before = {
    snapshots: countSnapshots(),
    products: countAffectedProducts(),
    pendingPosts: countPendingPosts(),
    dealScores: countScores()
  };

  console.log('=====================================================');
  console.log('   🧹 Purge Synthetic Demo Data (seed_history)');
  console.log('=====================================================');
  console.log(`Untrusted sources        : ${UNTRUSTED_SNAPSHOT_SOURCES.join(', ')}`);
  console.log(`Snapshots to delete      : ${before.snapshots}`);
  console.log(`Products affected        : ${before.products}`);
  console.log(`Pending channel posts    : ${before.pendingPosts} (will be cleared)`);
  console.log(`Cached deal scores       : ${before.dealScores} (will be recomputed)`);
  console.log('-----------------------------------------------------');

  if (before.snapshots === 0 && before.dealScores === 0 && before.pendingPosts === 0) {
    console.log('✅ Nothing to purge. Database is already clean.');
    return;
  }

  if (DRY_RUN) {
    console.log('🔍 DRY-RUN: no changes were written.');
    return;
  }

  const run = db.transaction(() => {
    const deletedSnapshots = db.prepare(`DELETE FROM price_snapshots WHERE ${inClause}`)
      .run(...UNTRUSTED_SNAPSHOT_SOURCES).changes;
    // Cached scores were derived from the old (possibly synthetic) history.
    const deletedScores = db.prepare(`DELETE FROM deals_scores`).run().changes;
    // Queued posts were selected from those stale scores.
    const deletedPosts = db.prepare(`DELETE FROM channel_queue WHERE status = 'pending'`).run().changes;
    return { deletedSnapshots, deletedScores, deletedPosts };
  });

  const result = run();

  const after = {
    snapshots: countSnapshots(),
    products: countAffectedProducts(),
    pendingPosts: countPendingPosts(),
    dealScores: countScores()
  };

  console.log(`🗑️  Deleted snapshots     : ${result.deletedSnapshots}`);
  console.log(`🗑️  Cleared deal scores   : ${result.deletedScores}`);
  console.log(`🗑️  Cleared pending posts : ${result.deletedPosts}`);
  console.log('-----------------------------------------------------');
  console.log(`Remaining untrusted rows : ${after.snapshots}`);
  console.log(`Remaining deal scores    : ${after.dealScores}`);
  console.log(`Remaining pending posts  : ${after.pendingPosts}`);
  console.log('');
  console.log('Next: rebuild derived files with');
  console.log('  node deals_tracker.js && node export_data.js && node src/build_deals_page.js && node src/build_brand_pages.js');
  console.log('=====================================================');
}

main();
