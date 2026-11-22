/**
 * Seeds realistic 30-day price history snapshots for selected products
 * so that confidence is 'high' or 'medium' and realistic historical discounts are calculated.
 */

const db = require('../src/db');
const { extractBrand, parseSize } = require('../src/normalize');
const { updateProductUnitPrice } = require('../src/repo');

function seedDemoHistory() {
  console.log('[*] Seeding realistic 30-day historical snapshots for sample products...');

  // Select active products that have a current price and valid image
  const products = db.prepare(`
    SELECT p.asin, p.title, p.category_id, p.image_url, s.price as current_price
    FROM products p
    JOIN price_snapshots s ON s.asin = p.asin
    WHERE p.is_active = 1
      AND s.price IS NOT NULL AND s.price > 0
      AND p.image_url IS NOT NULL AND p.image_url != ''
    ORDER BY p.asin ASC
  `).all();

  console.log(`Found ${products.length} candidate products in catalog.`);

  const insertSnap = db.prepare(`
    INSERT INTO price_snapshots (asin, run_id, scraped_at, price, list_price, in_stock, discount_badge, source)
    SELECT @asin, @run_id, @scraped_at, @price, @list_price, 1, @discount_badge, 'seed_history'
    WHERE NOT EXISTS (
      SELECT 1 FROM price_snapshots WHERE asin = @asin AND scraped_at = @scraped_at
    )
  `);

  // Target ~35 products across different categories to give them 30 days of history
  const targetProducts = products.slice(0, 40);

  const tx = db.transaction(() => {
    let seededSnapshots = 0;

    for (let i = 0; i < targetProducts.length; i++) {
      const prod = targetProducts[i];
      const currentPrice = prod.current_price;

      // Enrich brand and size if missing
      const brand = extractBrand(prod.title);
      const size = parseSize(prod.title);
      if (brand || size) {
        db.prepare(`
          UPDATE products
          SET brand = coalesce(?, brand)
          WHERE asin = ?
        `).run(brand, prod.asin);

        if (size && currentPrice) {
          updateProductUnitPrice(prod.asin, {
            weight_value: size.weight_value,
            weight_unit: size.weight_unit,
            pack_count: size.pack_count,
            size_text: size.size_text
          });
        }
      }

      // Determine typical historical price for this product
      // Group 1 (index % 3 === 0): Strong deal (dropped 20% - 35% from typical)
      // Group 2 (index % 3 === 1): Moderate deal (dropped 10% - 19% from typical)
      // Group 3 (index % 3 === 2): Normal price (typical price is current price)
      let typicalPrice = currentPrice;
      let discountBadge = null;

      if (i % 3 === 0) {
        // Dropped 25% from 1.33x price
        typicalPrice = +(currentPrice * 1.33).toFixed(2);
        discountBadge = 'خصم 25%';
      } else if (i % 3 === 1) {
        // Dropped 15% from 1.18x price
        typicalPrice = +(currentPrice * 1.18).toFixed(2);
        discountBadge = 'خصم 15%';
      }

      // Generate snapshots for days 1 to 30
      for (let day = 30; day >= 1; day--) {
        const dateStr = new Date(Date.now() - day * 24 * 60 * 60 * 1000).toISOString();
        insertSnap.run({
          asin: prod.asin,
          run_id: 'seed_run_30d',
          scraped_at: dateStr,
          price: typicalPrice,
          list_price: typicalPrice,
          discount_badge: discountBadge
        });
        seededSnapshots++;
      }
    }

    console.log(`[✔] Successfully seeded ${seededSnapshots} price snapshots across ${targetProducts.length} products.`);
  });

  tx();
}

if (require.main === module) {
  const confirmed = process.argv.includes('--confirm-demo-data');
  if (!confirmed) {
    console.error('');
    console.error('=====================================================================');
    console.error('  ⚠️  DANGER: هذا السكربت يضيف تاريخ أسعار وهمي (synthetic) للتجربة فقط.');
    console.error('  ⚠️  DANGER: This script injects FAKE price history for UI demos only.');
    console.error('');
    console.error('  البيانات دي بتتحفظ بـ source = "seed_history" ومحرك التسعير');
    console.error('  بيرفضها تلقائياً، لكنها مش لازم تتكتب في قاعدة بيانات الإنتاج.');
    console.error('');
    console.error('  لو متأكد إنك على نسخة تجريبية، شغّله كده:');
    console.error('    node scripts/seed_demo_history.js --confirm-demo-data');
    console.error('=====================================================================');
    console.error('');
    process.exit(1);
  }
  seedDemoHistory();
}

module.exports = { seedDemoHistory };
