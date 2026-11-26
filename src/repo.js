const db = require('./db');
const pricing = require('./pricing');
const {
  normalizeTitle,
  extractBrand,
  parseSize,
  createDuplicateKey
} = require('./normalize');

/**
 * Upsert a category
 */
function upsertCategory(cat) {
  const stmt = db.prepare(`
    INSERT INTO categories (
      id, store, parent_id, name, name_ar, node_id, url, depth, is_active, last_scraped_at
    ) VALUES (
      @id, @store, @parent_id, @name, @name_ar, @node_id, @url, @depth, @is_active, @last_scraped_at
    )
    ON CONFLICT(id) DO UPDATE SET
      store = coalesce(excluded.store, categories.store),
      parent_id = coalesce(excluded.parent_id, categories.parent_id),
      name = excluded.name,
      name_ar = coalesce(excluded.name_ar, categories.name_ar),
      node_id = coalesce(excluded.node_id, categories.node_id),
      url = coalesce(excluded.url, categories.url),
      depth = coalesce(excluded.depth, categories.depth),
      is_active = coalesce(excluded.is_active, categories.is_active),
      last_scraped_at = coalesce(excluded.last_scraped_at, categories.last_scraped_at)
  `);

  const info = stmt.run({
    id: cat.id,
    store: cat.store || 'amazon',
    parent_id: cat.parent_id || null,
    name: cat.name,
    name_ar: cat.name_ar || null,
    node_id: cat.node_id || cat.nodeId || null,
    url: cat.url || null,
    depth: cat.depth !== undefined ? cat.depth : 0,
    is_active: cat.is_active !== undefined ? cat.is_active : 1,
    last_scraped_at: cat.last_scraped_at || null
  });

  return info;
}

/**
 * Upsert a product
 */
function upsertProduct(prod) {
  const stmt = db.prepare(`
    INSERT INTO products (
      asin, store, store_sku, canonical_id, title, title_norm, brand, category_id, image_url, product_url,
      weight_value, weight_unit, pack_count, size_text, unit_price, unit_price_unit,
      first_seen_at, last_seen_at, is_active
    ) VALUES (
      @asin, @store, @store_sku, @canonical_id, @title, @title_norm, @brand, @category_id, @image_url, @product_url,
      @weight_value, @weight_unit, @pack_count, @size_text, @unit_price, @unit_price_unit,
      @first_seen_at, @last_seen_at, @is_active
    )
    ON CONFLICT(asin) DO UPDATE SET
      store = coalesce(excluded.store, products.store),
      store_sku = coalesce(excluded.store_sku, products.store_sku),
      canonical_id = coalesce(excluded.canonical_id, products.canonical_id),
      title = excluded.title,
      title_norm = coalesce(excluded.title_norm, products.title_norm),
      brand = coalesce(excluded.brand, products.brand),
      category_id = coalesce(excluded.category_id, products.category_id),
      image_url = coalesce(excluded.image_url, products.image_url),
      product_url = coalesce(excluded.product_url, products.product_url),
      weight_value = coalesce(excluded.weight_value, products.weight_value),
      weight_unit = coalesce(excluded.weight_unit, products.weight_unit),
      pack_count = coalesce(excluded.pack_count, products.pack_count),
      size_text = coalesce(excluded.size_text, products.size_text),
      unit_price = coalesce(excluded.unit_price, products.unit_price),
      unit_price_unit = coalesce(excluded.unit_price_unit, products.unit_price_unit),
      first_seen_at = coalesce(products.first_seen_at, excluded.first_seen_at),
      last_seen_at = coalesce(excluded.last_seen_at, products.last_seen_at),
      is_active = coalesce(excluded.is_active, products.is_active)
  `);

  const titleNorm = prod.title_norm || normalizeTitle(prod.title);
  const brand = prod.brand || extractBrand(prod.title);
  const size = (prod.weight_value !== undefined && prod.weight_value !== null) ? {
    weight_value: prod.weight_value,
    weight_unit: prod.weight_unit,
    pack_count: prod.pack_count,
    size_text: prod.size_text
  } : parseSize(prod.title);

  return stmt.run({
    asin: prod.asin,
    store: prod.store || 'amazon',
    store_sku: prod.store_sku || prod.storeSku || null,
    canonical_id: prod.canonical_id || prod.canonicalId || null,
    title: prod.title,
    title_norm: titleNorm,
    brand: brand || null,
    category_id: prod.category_id || prod.categoryId || null,
    image_url: prod.image_url || prod.imgSrc || null,
    product_url: prod.product_url || prod.productUrl || null,
    weight_value: size.weight_value !== undefined ? size.weight_value : null,
    weight_unit: size.weight_unit || null,
    pack_count: size.pack_count !== undefined ? size.pack_count : 1,
    size_text: size.size_text || null,
    unit_price: prod.unit_price !== undefined ? prod.unit_price : null,
    unit_price_unit: prod.unit_price_unit || null,
    first_seen_at: prod.first_seen_at || prod.firstSeen || new Date().toISOString(),
    last_seen_at: prod.last_seen_at || prod.lastSeen || new Date().toISOString(),
    is_active: prod.is_active !== undefined ? prod.is_active : 1
  });
}

/**
 * Insert a price snapshot (idempotent - skips if asin + scraped_at already exists)
 */
function insertSnapshot(snap) {
  const stmt = db.prepare(`
    INSERT INTO price_snapshots (
      asin, store, run_id, scraped_at, price, list_price, in_stock, discount_badge, stock_note, source
    )
    SELECT @asin, @store, @run_id, @scraped_at, @price, @list_price, @in_stock, @discount_badge, @stock_note, @source
    WHERE NOT EXISTS (
      SELECT 1 FROM price_snapshots WHERE asin = @asin AND scraped_at = @scraped_at
    )
  `);

  return stmt.run({
    asin: snap.asin,
    store: snap.store || 'amazon',
    run_id: snap.run_id || null,
    scraped_at: snap.scraped_at || snap.date || new Date().toISOString(),
    price: snap.price !== undefined ? snap.price : snap.currentPriceNum,
    list_price: snap.list_price !== undefined ? snap.list_price : (snap.listedOldPrice || snap.oldPriceNum || null),
    in_stock: snap.in_stock !== undefined ? snap.in_stock : 1,
    discount_badge: snap.discount_badge || snap.discount || null,
    stock_note: snap.stock_note || snap.stockNote || null,
    source: snap.source || 'scraper'
  });
}

/**
 * Get latest price snapshot for an ASIN
 */
function getLatestSnapshot(asin) {
  const stmt = db.prepare(`
    SELECT * FROM price_snapshots
    WHERE asin = ?
    ORDER BY scraped_at DESC, id DESC
    LIMIT 1
  `);
  return stmt.get(asin);
}

/**
 * Get previous snapshot (before latest) for drop detection
 */
function getPreviousSnapshot(asin, beforeDate) {
  const stmt = db.prepare(`
    SELECT * FROM price_snapshots
    WHERE asin = ? AND scraped_at < ?
    ORDER BY scraped_at DESC, id DESC
    LIMIT 1
  `);
  return stmt.get(asin, beforeDate);
}

/**
 * Get price statistics for an ASIN (percentiles, lowest, highest, typical, days observed)
 * Optional: within last N days (e.g. 30 or 90 days)
 */
function getPriceStats(asin, days) {
  const stats = pricing.getPriceStats(asin, days, db);
  return {
    lowestPrice: stats.min,
    highestPrice: stats.max,
    avgPrice: stats.median,
    totalSnapshots: stats.count,
    count: stats.count,
    min: stats.min,
    max: stats.max,
    p10: stats.p10,
    p30: stats.p30,
    median: stats.median,
    p50: stats.p50,
    p90: stats.p90,
    last_price: stats.last_price,
    days_observed: stats.days_observed
  };
}

/**
 * Record a new scraper run
 */
function recordRun(run) {
  const stmt = db.prepare(`
    INSERT INTO runs (
      id, started_at, finished_at, status, pages_total, pages_ok, pages_failed, items_upserted, error
    ) VALUES (
      @id, @started_at, @finished_at, @status, @pages_total, @pages_ok, @pages_failed, @items_upserted, @error
    )
    ON CONFLICT(id) DO UPDATE SET
      started_at = coalesce(excluded.started_at, runs.started_at),
      finished_at = coalesce(excluded.finished_at, runs.finished_at),
      status = coalesce(excluded.status, runs.status),
      pages_total = coalesce(excluded.pages_total, runs.pages_total),
      pages_ok = coalesce(excluded.pages_ok, runs.pages_ok),
      pages_failed = coalesce(excluded.pages_failed, runs.pages_failed),
      items_upserted = coalesce(excluded.items_upserted, runs.items_upserted),
      error = coalesce(excluded.error, runs.error)
  `);

  return stmt.run({
    id: run.id,
    started_at: run.started_at || new Date().toISOString(),
    finished_at: run.finished_at || null,
    status: run.status || 'running',
    pages_total: run.pages_total !== undefined ? run.pages_total : 0,
    pages_ok: run.pages_ok !== undefined ? run.pages_ok : 0,
    pages_failed: run.pages_failed !== undefined ? run.pages_failed : 0,
    items_upserted: run.items_upserted !== undefined ? run.items_upserted : 0,
    error: run.error || null
  });
}

/**
 * Update an existing run
 */
function updateRun(runId, updates) {
  const fields = [];
  const params = { id: runId };

  for (const [key, val] of Object.entries(updates)) {
    if (['finished_at', 'status', 'pages_total', 'pages_ok', 'pages_failed', 'items_upserted', 'error', 'last_page'].includes(key)) {
      fields.push(`${key} = @${key}`);
      params[key] = val;
    }
  }

  if (fields.length === 0) return { changes: 0 };

  const stmt = db.prepare(`UPDATE runs SET ${fields.join(', ')} WHERE id = @id`);
  return stmt.run(params);
}

/**
 * Log an alert
 */
function logAlert(alert) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO alerts (
      asin, rule, threshold, price, triggered_at, sent_at, channel, payload
    ) VALUES (
      @asin, @rule, @threshold, @price, @triggered_at, @sent_at, @channel, @payload
    )
  `);

  return stmt.run({
    asin: alert.asin,
    rule: alert.rule,
    threshold: alert.threshold !== undefined ? alert.threshold : null,
    price: alert.price !== undefined ? alert.price : null,
    triggered_at: alert.triggered_at || new Date().toISOString(),
    sent_at: alert.sent_at || null,
    channel: alert.channel || null,
    payload: alert.payload ? (typeof alert.payload === 'object' ? JSON.stringify(alert.payload) : String(alert.payload)) : null
  });
}

/**
 * Check if alert was already sent within given hours
 */
function wasAlertSent(asin, rule, withinHours) {
  const hours = withinHours || 24;
  const stmt = db.prepare(`
    SELECT 1 FROM alerts
    WHERE asin = ? AND rule = ? AND sent_at IS NOT NULL
      AND sent_at >= datetime('now', '-' || ? || ' hours')
    LIMIT 1
  `);
  const row = stmt.get(asin, rule, hours);
  return !!row;
}

/**
 * Save a computed deal score into deals_scores
 */
function saveDealScore(score) {
  const stmt = db.prepare(`
    INSERT INTO deals_scores (
      asin, run_id, fair_price, typical_price, historical_discount_pct,
      advertised_discount_pct, is_real_deal, confidence, all_time_low, price_index, computed_at
    ) VALUES (
      @asin, @run_id, @fair_price, @typical_price, @historical_discount_pct,
      @advertised_discount_pct, @is_real_deal, @confidence, @all_time_low, @price_index, @computed_at
    )
  `);

  return stmt.run({
    asin: score.asin,
    run_id: score.run_id || null,
    fair_price: score.fair_price !== undefined ? score.fair_price : null,
    typical_price: score.typical_price !== undefined ? score.typical_price : null,
    historical_discount_pct: score.historical_discount_pct !== undefined ? score.historical_discount_pct : null,
    advertised_discount_pct: score.advertised_discount_pct !== undefined ? score.advertised_discount_pct : 0,
    is_real_deal: score.is_real_deal ? 1 : 0,
    confidence: score.confidence || 'low',
    all_time_low: score.all_time_low ? 1 : 0,
    price_index: score.price_index !== undefined ? score.price_index : null,
    computed_at: score.computed_at || new Date().toISOString()
  });
}

/**
 * Get latest deal score for an ASIN
 */
function getLatestDealScore(asin) {
  const stmt = db.prepare(`
    SELECT * FROM deals_scores
    WHERE asin = ?
    ORDER BY computed_at DESC, id DESC
    LIMIT 1
  `);
  return stmt.get(asin);
}

/**
 * Update unit price and size details for a product
 */
function updateProductUnitPrice(asin, details) {
  const stmt = db.prepare(`
    UPDATE products SET
      unit_price = coalesce(@unit_price, unit_price),
      unit_price_unit = coalesce(@unit_price_unit, unit_price_unit),
      weight_value = coalesce(@weight_value, weight_value),
      weight_unit = coalesce(@weight_unit, weight_unit),
      pack_count = coalesce(@pack_count, pack_count),
      size_text = coalesce(@size_text, size_text)
    WHERE asin = @asin
  `);

  return stmt.run({
    asin,
    unit_price: details.unit_price !== undefined ? details.unit_price : null,
    unit_price_unit: details.unit_price_unit || null,
    weight_value: details.weight_value !== undefined ? details.weight_value : null,
    weight_unit: details.weight_unit || null,
    pack_count: details.pack_count !== undefined ? details.pack_count : null,
    size_text: details.size_text || null
  });
}

/**
 * Get all active products with enriched price and deal stats for exports
 */
function getProductsForExport() {
  const stmt = db.prepare(`
    SELECT
      p.asin,
      p.store,
      p.store_sku,
      p.canonical_id,
      p.title,
      coalesce(c.name, p.category_id, 'Other') AS category,
      p.category_id,
      p.brand,
      p.weight_value,
      p.weight_unit,
      p.pack_count,
      p.size_text,
      p.unit_price,
      p.unit_price_unit,
      p.image_url AS imgSrc,
      p.product_url AS productUrl,
      s.price AS currentPriceNum,
      s.list_price AS oldPriceNum,
      s.discount_badge AS discount,
      s.scraped_at AS lastScrapedAt
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN price_snapshots s ON s.id = (
      SELECT ps.id FROM price_snapshots ps
      WHERE ps.asin = p.asin
      ORDER BY ps.scraped_at DESC, ps.id DESC
      LIMIT 1
    )
    WHERE p.is_active = 1
    ORDER BY p.title ASC
  `);

  const rows = stmt.all();

  const enriched = rows.map(p => {
    const currentPriceNum = p.currentPriceNum;
    const oldPriceNum = p.oldPriceNum;

    // 1. Calculate Unit Price if not already stored
    let unitPrice = p.unit_price;
    let unitPriceUnit = p.unit_price_unit;
    let weightVal = p.weight_value;
    let weightUnit = p.weight_unit;
    let packCount = p.pack_count || 1;
    let sizeText = p.size_text;

    if (unitPrice === null || unitPriceUnit === null) {
      const parsed = pricing.parseSize(p.title);
      if (parsed) {
        weightVal = parsed.weight_value;
        weightUnit = parsed.weight_unit;
        packCount = parsed.pack_count;
        sizeText = parsed.size_text;
        const calc = pricing.calculateUnitPrice(currentPriceNum, parsed);
        if (calc) {
          unitPrice = calc.unit_price;
          unitPriceUnit = calc.unit_price_unit;
          // Persist unit price in DB
          try {
            updateProductUnitPrice(p.asin, {
              unit_price: unitPrice,
              unit_price_unit: unitPriceUnit,
              weight_value: weightVal,
              weight_unit: weightUnit,
              pack_count: packCount,
              size_text: sizeText
            });
          } catch (e) {}
        }
      }
    }

    const unitPriceFormatted = pricing.formatUnitPrice(unitPrice, unitPriceUnit);

    // 2. Historical Statistics: 90 days and all-time
    const stats90 = pricing.getPriceStats(p.asin, 90, db);
    const statsAllTime = pricing.getPriceStats(p.asin, null, db);

    // 3. Classify Deal using strict historical rules (oldPriceNum is context only)
    const deal = pricing.classifyDeal({
      price: currentPriceNum,
      oldPriceNum,
      stats90,
      statsAllTime
    });

    // Reference typical price and egp saved
    const referencePrice = deal.typical_price || oldPriceNum || currentPriceNum;
    const egpSaved = (deal.typical_price && currentPriceNum && deal.typical_price > currentPriceNum)
      ? +(deal.typical_price - currentPriceNum).toFixed(2)
      : 0;

    return {
      asin: p.asin,
      store: p.store || 'amazon',
      store_sku: p.store_sku || null,
      canonical_id: p.canonical_id || null,
      title: p.title,
      category: p.category,
      category_id: p.category_id,
      brand: p.brand || null,
      currentPrice: currentPriceNum !== null ? `EGP ${currentPriceNum.toFixed(2)}` : '',
      currentPriceNum: currentPriceNum,
      oldPrice: oldPriceNum !== null ? `EGP ${oldPriceNum.toFixed(2)}` : null,
      oldPriceNum: oldPriceNum,
      currency: 'EGP',
      discount: deal.display_discount,
      productUrl: p.productUrl,
      imgSrc: p.imgSrc,
      fair_price: deal.fair_price,
      typical_price: deal.typical_price,
      historical_discount_pct: deal.historical_discount_pct,
      advertised_discount_pct: deal.advertised_discount_pct,
      is_real_deal: deal.is_real_deal,
      confidence: deal.confidence,
      all_time_low: deal.all_time_low,
      display_discount: deal.display_discount,
      weight_value: weightVal,
      weight_unit: weightUnit,
      pack_count: packCount,
      size_text: sizeText,
      unit_price: unitPrice,
      unit_price_unit: unitPriceUnit,
      unit_price_formatted: unitPriceFormatted,
      // Backwards-compatibility fields:
      referencePrice: referencePrice,
      egpSaved: egpSaved,
      realDiscountPct: deal.historical_discount_pct || 0,
      isRealDeal: deal.is_real_deal,
      isDrop: false,
      dropAmount: 0,
      lowestPrice: statsAllTime.min || currentPriceNum,
      highestPrice: statsAllTime.max || referencePrice || currentPriceNum
    };
  });

  // 4. Calculate internal price indices (category median unit price comparison)
  return pricing.calculatePriceIndices(enriched);
}

/**
 * Save a department batch atomically in a transaction:
 * - Upserts products with normalized titles, brands, and parsed sizes
 * - Inserts a price snapshot for each item
 * - Updates runs.pages_ok or runs.pages_failed, runs.items_upserted, and runs.last_page
 * - Updates categories.consecutive_zero_count and is_active flag (0 after 2 consecutive 0 results)
 */
function saveDepartmentBatch({ items, runId, categoryId, categoryName, pageIdentifier, isSuccess }) {
  const now = new Date().toISOString();

  const runTx = db.transaction(() => {
    let upsertedCount = 0;

    if (isSuccess && items && items.length > 0) {
      for (const item of items) {
        upsertProduct({
          asin: item.asin,
          store: item.store || 'amazon',
          store_sku: item.store_sku || null,
          canonical_id: item.canonical_id || null,
          title: item.title,
          category_id: categoryId,
          image_url: item.imgSrc,
          product_url: item.productUrl,
          last_seen_at: now
        });

        // Data integrity: never persist a snapshot without a real price.
        // Null-price rows used to dominate price_snapshots and made coverage
        // look healthy while no actual price had been captured.
        const numericPrice = Number(item.currentPriceNum);
        // Anything at or below 1 EGP is almost certainly a parsing artifact
        // (e.g. "1 لتر" or "6 × 1 لتر" promo text), never a real Amazon EG price.
        if (Number.isFinite(numericPrice) && numericPrice > 1) {
          insertSnapshot({
            asin: item.asin,
            store: item.store || 'amazon',
            run_id: runId,
            scraped_at: now,
            price: numericPrice,
            list_price: item.oldPriceNum,
            discount_badge: item.discount,
            stock_note: item.stock_note || item.stockNote || null,
            source: 'full_store_scraper'
          });
        }

        upsertedCount++;
      }

      // Reset zero counter and update category
      db.prepare(`
        UPDATE categories SET
          last_scraped_at = ?,
          consecutive_zero_count = 0,
          is_active = 1
        WHERE id = ?
      `).run(now, categoryId);

      // Update run progress
      db.prepare(`
        UPDATE runs SET
          pages_ok = pages_ok + 1,
          items_upserted = items_upserted + ?,
          last_page = ?
        WHERE id = ?
      `).run(upsertedCount, pageIdentifier || categoryId, runId);

    } else {
      // Category returned 0 products or failed
      const cat = db.prepare(`SELECT consecutive_zero_count FROM categories WHERE id = ?`).get(categoryId);
      const newZeroCount = ((cat && cat.consecutive_zero_count) || 0) + 1;
      const isActive = newZeroCount >= 2 ? 0 : 1;

      db.prepare(`
        UPDATE categories SET
          consecutive_zero_count = ?,
          is_active = ?,
          last_scraped_at = ?
        WHERE id = ?
      `).run(newZeroCount, isActive, now, categoryId);

      db.prepare(`
        UPDATE runs SET
          pages_failed = pages_failed + 1,
          last_page = ?
        WHERE id = ?
      `).run(pageIdentifier || categoryId, runId);
    }

    return upsertedCount;
  });

  return runTx();
}

/**
 * Get last checkpoint run for resume (--resume)
 */
function getLastCheckpointRun() {
  const stmt = db.prepare(`
    SELECT * FROM runs
    WHERE last_page IS NOT NULL AND status IN ('running', 'interrupted', 'failed')
    ORDER BY started_at DESC
    LIMIT 1
  `);
  return stmt.get();
}

/**
 * Get the latest run (regardless of status)
 */
function getLastRun() {
  const stmt = db.prepare(`
    SELECT * FROM runs
    ORDER BY started_at DESC
    LIMIT 1
  `);
  return stmt.get();
}

/**
 * Deduplicate active products in catalog:
 * Groups by (title_norm + brand + weight_value + weight_unit).
 * Retains the cheapest current item as canonical.
 * Inserts duplicates into product_duplicates table and sets is_active = 0.
 */
function deduplicateCatalog() {
  const activeProducts = db.prepare(`
    SELECT
      p.asin,
      p.title,
      p.title_norm,
      p.brand,
      p.weight_value,
      p.weight_unit,
      p.category_id,
      s.price AS current_price
    FROM products p
    LEFT JOIN price_snapshots s ON s.id = (
      SELECT ps.id FROM price_snapshots ps
      WHERE ps.asin = p.asin
      ORDER BY ps.scraped_at DESC, ps.id DESC
      LIMIT 1
    )
    WHERE p.is_active = 1
  `).all();

  const groups = new Map();
  for (const prod of activeProducts) {
    const key = createDuplicateKey(prod);
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(prod);
  }

  let totalDuplicatesDetected = 0;
  const duplicateRecords = [];
  const now = new Date().toISOString();

  const tx = db.transaction(() => {
    for (const [key, items] of groups.entries()) {
      if (items.length > 1) {
        // Sort items by price ascending (cheapest first), then by ASIN
        items.sort((a, b) => {
          const priceA = a.current_price !== null && a.current_price !== undefined ? a.current_price : 999999;
          const priceB = b.current_price !== null && b.current_price !== undefined ? b.current_price : 999999;
          if (priceA !== priceB) return priceA - priceB;
          return a.asin.localeCompare(b.asin);
        });

        const canonical = items[0];
        const duplicates = items.slice(1);

        for (const dup of duplicates) {
          totalDuplicatesDetected++;
          duplicateRecords.push({
            canonical_asin: canonical.asin,
            duplicate_asin: dup.asin,
            reason: `duplicate of ${canonical.asin} (${key})`,
            detected_at: now
          });

          // Insert into product_duplicates
          db.prepare(`
            INSERT INTO product_duplicates (canonical_asin, duplicate_asin, reason, detected_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(duplicate_asin) DO UPDATE SET
              canonical_asin = excluded.canonical_asin,
              reason = excluded.reason,
              detected_at = excluded.detected_at
          `).run(canonical.asin, dup.asin, `duplicate of ${canonical.asin}`, now);

          // Mark duplicate product as inactive
          db.prepare(`UPDATE products SET is_active = 0 WHERE asin = ?`).run(dup.asin);
        }
      }
    }
  });

  tx();

  return {
    totalChecked: activeProducts.length,
    duplicatesDetected: totalDuplicatesDetected,
    canonicalCount: activeProducts.length - totalDuplicatesDetected,
    duplicateRecords
  };
}

/**
 * Returns comprehensive before/after deduplication and normalization report
 */
function getDeduplicationReport() {
  const total = db.prepare(`SELECT COUNT(*) AS c FROM products`).get().c;
  const active = db.prepare(`SELECT COUNT(*) AS c FROM products WHERE is_active = 1`).get().c;
  const duplicates = db.prepare(`SELECT COUNT(*) AS c FROM product_duplicates`).get().c;
  const withBrand = db.prepare(`SELECT COUNT(*) AS c FROM products WHERE brand IS NOT NULL AND TRIM(brand) != ''`).get().c;
  const withWeight = db.prepare(`SELECT COUNT(*) AS c FROM products WHERE weight_value IS NOT NULL`).get().c;
  const inactiveCats = db.prepare(`SELECT id, name, consecutive_zero_count FROM categories WHERE is_active = 0`).all();

  return {
    totalProducts: total,
    activeCanonicalProducts: active,
    duplicateProducts: duplicates,
    withBrandCount: withBrand,
    withBrandPct: total > 0 ? +((withBrand / total) * 100).toFixed(1) : 0,
    withWeightCount: withWeight,
    withWeightPct: total > 0 ? +((withWeight / total) * 100).toFixed(1) : 0,
    inactiveCategories: inactiveCats
  };
}

/**
 * Helper to get all products raw from database
 */
function getAllProducts() {
  return db.prepare(`SELECT * FROM products`).all();
}

/**
 * Add or update item in watchlist
 */
function addToWatchlist({ chatId, asin, targetPrice, targetDiscountPct }) {
  const stmt = db.prepare(`
    INSERT INTO watchlist (chat_id, asin, target_price, target_discount_pct, is_active, created_at)
    VALUES (@chatId, @asin, @targetPrice, @targetDiscountPct, 1, @createdAt)
    ON CONFLICT(chat_id, asin) DO UPDATE SET
      target_price = coalesce(excluded.target_price, watchlist.target_price),
      target_discount_pct = coalesce(excluded.target_discount_pct, watchlist.target_discount_pct),
      is_active = 1
  `);

  return stmt.run({
    chatId: String(chatId),
    asin: asin.toUpperCase(),
    targetPrice: targetPrice !== undefined && targetPrice !== null ? targetPrice : null,
    targetDiscountPct: targetDiscountPct !== undefined && targetDiscountPct !== null ? targetDiscountPct : null,
    createdAt: new Date().toISOString()
  });
}

/**
 * Remove an item from watchlist for a chat
 */
function removeFromWatchlist(chatId, asin) {
  const stmt = db.prepare(`DELETE FROM watchlist WHERE chat_id = ? AND asin = ?`);
  return stmt.run(String(chatId), asin.toUpperCase());
}

/**
 * Get active watchlist items for a specific chat
 */
function getWatchlist(chatId) {
  const stmt = db.prepare(`
    SELECT w.*, p.title, p.image_url, p.product_url, p.unit_price, p.unit_price_unit,
      s.price AS current_price, s.list_price AS old_price, s.scraped_at AS last_scraped_at
    FROM watchlist w
    LEFT JOIN products p ON w.asin = p.asin
    LEFT JOIN price_snapshots s ON s.id = (
      SELECT id FROM price_snapshots ps WHERE ps.asin = w.asin ORDER BY scraped_at DESC, id DESC LIMIT 1
    )
    WHERE w.chat_id = ? AND w.is_active = 1
    ORDER BY w.created_at DESC
  `);
  return stmt.all(String(chatId));
}

/**
 * Stop/disable watchlist for a chat
 */
function stopWatchlist(chatId) {
  const stmt = db.prepare(`UPDATE watchlist SET is_active = 0 WHERE chat_id = ?`);
  return stmt.run(String(chatId));
}

/**
 * Get all active watchlists across all chats
 */
function getAllActiveWatchlists() {
  const stmt = db.prepare(`
    SELECT w.*, p.title, p.image_url, p.product_url, p.unit_price, p.unit_price_unit,
      s.price AS current_price, s.list_price AS old_price, s.scraped_at AS last_scraped_at
    FROM watchlist w
    LEFT JOIN products p ON w.asin = p.asin
    LEFT JOIN price_snapshots s ON s.id = (
      SELECT id FROM price_snapshots ps WHERE ps.asin = w.asin ORDER BY scraped_at DESC, id DESC LIMIT 1
    )
    WHERE w.is_active = 1
  `);
  return stmt.all();
}

/**
 * Add an item to the Telegram channel publishing queue
 */
function addToChannelQueue(item) {
  const stmt = db.prepare(`
    INSERT INTO channel_queue (
      asin, slot, scheduled_at, status, posted_at, message_id, error
    ) VALUES (
      @asin, @slot, @scheduled_at, @status, @posted_at, @message_id, @error
    )
  `);

  return stmt.run({
    asin: item.asin,
    slot: item.slot,
    scheduled_at: item.scheduled_at,
    status: item.status || 'pending',
    posted_at: item.posted_at || null,
    message_id: item.message_id !== undefined && item.message_id !== null ? String(item.message_id) : null,
    error: item.error || null
  });
}

/**
 * Update status, message_id, error and timestamp of a channel queue item
 */
function updateChannelQueueItem(id, updates) {
  const stmt = db.prepare(`
    UPDATE channel_queue SET
      status = coalesce(@status, status),
      posted_at = coalesce(@posted_at, posted_at),
      message_id = coalesce(@message_id, message_id),
      error = @error
    WHERE id = @id
  `);

  return stmt.run({
    id,
    status: updates.status !== undefined ? updates.status : null,
    posted_at: updates.posted_at !== undefined ? updates.posted_at : null,
    message_id: updates.message_id !== undefined && updates.message_id !== null ? String(updates.message_id) : null,
    error: updates.error !== undefined ? updates.error : null
  });
}

/**
 * Get pending posts in channel_queue scheduled at or before maxScheduledTime
 */
function getPendingChannelQueue(maxScheduledTime = new Date().toISOString()) {
  const stmt = db.prepare(`
    SELECT
      q.*,
      p.title,
      p.brand,
      p.category_id,
      coalesce(c.name_ar, c.name, p.category_id, 'عروض') AS category_name,
      p.image_url,
      p.product_url,
      p.unit_price,
      p.unit_price_unit,
      s.price AS current_price,
      s.list_price AS old_price,
      s.stock_note,
      ds.fair_price,
      ds.typical_price,
      ds.historical_discount_pct,
      ds.advertised_discount_pct,
      ds.is_real_deal,
      ds.confidence,
      ds.all_time_low
    FROM channel_queue q
    JOIN products p ON q.asin = p.asin
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN price_snapshots s ON s.id = (
      SELECT ps.id FROM price_snapshots ps
      WHERE ps.asin = p.asin
      ORDER BY ps.scraped_at DESC, ps.id DESC
      LIMIT 1
    )
    LEFT JOIN deals_scores ds ON ds.id = (
      SELECT d.id FROM deals_scores d
      WHERE d.asin = p.asin
      ORDER BY d.computed_at DESC, d.id DESC
      LIMIT 1
    )
    WHERE q.status = 'pending'
      AND datetime(q.scheduled_at) <= datetime(?)
    ORDER BY datetime(q.scheduled_at) ASC, q.id ASC
  `);

  return stmt.all(maxScheduledTime);
}

/**
 * Get ASINs posted in the last N days (status = 'posted')
 */
function getRecentPostedAsins(days = 7) {
  const rows = db.prepare(`
    SELECT DISTINCT asin
    FROM channel_queue
    WHERE status = 'posted'
      AND datetime(posted_at) >= datetime('now', '-' || ? || ' days')
  `).all(days);

  return new Set(rows.map(r => r.asin));
}

/**
 * Get ASINs already scheduled or posted for a given date
 */
function getScheduledAsinsForDate(dateStr) {
  const rows = db.prepare(`
    SELECT DISTINCT asin
    FROM channel_queue
    WHERE substr(scheduled_at, 1, 10) = ? OR slot LIKE ?
  `).all(dateStr, `${dateStr}%`);

  return new Set(rows.map(r => r.asin));
}

/**
 * Get statistics of channel_queue
 */
function getChannelQueueStats() {
  const stats = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status = 'posted' THEN 1 ELSE 0 END) AS posted,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) AS skipped
    FROM channel_queue
  `).get();

  return stats;
}

/**
 * Helper to get all categories
 */
function getAllCategories() {
  return db.prepare(`SELECT * FROM categories`).all();
}

/**
 * Cross-store comparison helper
 * Groups active products with matching canonical_id or normalized title across different stores.
 */
function getCrossStoreComparisons() {
  const products = getProductsForExport();
  const groups = new Map();

  for (const p of products) {
    if (!p.currentPriceNum) continue;
    const key = p.canonical_id || (p.title_norm ? p.title_norm.toLowerCase().trim() : p.title.toLowerCase().trim());
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(p);
  }

  const multiStoreDeals = [];
  for (const [key, items] of groups.entries()) {
    const stores = new Set(items.map(i => i.store));
    if (stores.size > 1) {
      items.sort((a, b) => a.currentPriceNum - b.currentPriceNum);
      const cheapest = items[0];
      const expensive = items[items.length - 1];
      const priceDiff = +(expensive.currentPriceNum - cheapest.currentPriceNum).toFixed(2);
      const savingsPct = expensive.currentPriceNum > 0
        ? Math.round((priceDiff / expensive.currentPriceNum) * 100)
        : 0;

      multiStoreDeals.push({
        canonical_key: key,
        title: cheapest.title,
        brand: cheapest.brand,
        cheapest_store: cheapest.store,
        cheapest_price: cheapest.currentPriceNum,
        cheapest_url: cheapest.productUrl,
        expensive_store: expensive.store,
        expensive_price: expensive.currentPriceNum,
        price_difference: priceDiff,
        savings_pct: savingsPct,
        items
      });
    }
  }

  return multiStoreDeals.sort((a, b) => b.savings_pct - a.savings_pct);
}

module.exports = {
  db,
  upsertCategory,
  upsertProduct,
  insertSnapshot,
  getLatestSnapshot,
  getPreviousSnapshot,
  getPriceStats,
  recordRun,
  updateRun,
  logAlert,
  wasAlertSent,
  saveDealScore,
  getLatestDealScore,
  updateProductUnitPrice,
  getProductsForExport,
  getCrossStoreComparisons,
  saveDepartmentBatch,
  getLastCheckpointRun,
  getLastRun,
  deduplicateCatalog,
  getDeduplicationReport,
  addToWatchlist,
  removeFromWatchlist,
  getWatchlist,
  stopWatchlist,
  getAllActiveWatchlists,
  getAllProducts,
  getAllCategories,
  addToChannelQueue,
  updateChannelQueueItem,
  getPendingChannelQueue,
  getRecentPostedAsins,
  getScheduledAsinsForDate,
  getChannelQueueStats
};
