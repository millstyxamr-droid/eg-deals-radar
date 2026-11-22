"""
Amazon Egypt Tez / Now - Full Store Catalog Scraper (Python + Playwright)

Crawls all department node categories and search queries to extract
every product available across the entire Amazon Now store.
"""

import asyncio
import json
import re
from pathlib import Path
from playwright.async_api import async_playwright

BRAND_ID = "sAuWWBROaG"
BASE_URL = "https://www.amazon.eg"

DEPARTMENTS = [
    {"name": "Fruits & Vegetables", "nodeId": "215052334031", "url": f"{BASE_URL}/tez/browse/explore/category?qcbrand={BRAND_ID}&nodeId=215052334031&title=Fruits+and+Vegetables"},
    {"name": "Chicken, Meat & Fish", "nodeId": "214841696031", "url": f"{BASE_URL}/tez/browse/explore/category?qcbrand={BRAND_ID}&nodeId=214841696031&title=Chicken+Meat+%26+Fish"},
    {"name": "Dairy, Eggs & Cheese", "nodeId": "223985148031", "url": f"{BASE_URL}/tez/browse/explore/category?qcbrand={BRAND_ID}&nodeId=223985148031&title=Dairy+and+Eggs"},
    {"name": "Bakery & Bread", "nodeId": "215052333031", "url": f"{BASE_URL}/tez/browse/explore/category?qcbrand={BRAND_ID}&nodeId=215052333031&title=Bakery"},
    {"name": "Cooking & Baking", "nodeId": "212925568031", "url": f"{BASE_URL}/tez/browse/explore/category?qcbrand={BRAND_ID}&nodeId=212925568031&title=Cooking+and+Baking"},
    {"name": "Snacks, Chips & Popcorn", "nodeId": "215093298031", "url": f"{BASE_URL}/tez/browse/explore/category?qcbrand={BRAND_ID}&nodeId=215093298031&title=Snacks"},
    {"name": "Beverages, Coffee & Tea", "nodeId": "212925566031", "url": f"{BASE_URL}/tez/browse/explore/category?qcbrand={BRAND_ID}&nodeId=212925566031&title=Beverages"},
    {"name": "Household & Cleaning", "nodeId": "215103357031", "url": f"{BASE_URL}/tez/browse/explore/category?qcbrand={BRAND_ID}&nodeId=215103357031&title=Household"},
    {"name": "Beauty & Personal Care", "nodeId": "215021840031", "url": f"{BASE_URL}/tez/browse/explore/category?qcbrand={BRAND_ID}&nodeId=215021840031&title=Beauty"},
    {"name": "Baby Care", "nodeId": "215021807031", "url": f"{BASE_URL}/tez/browse/explore/category?qcbrand={BRAND_ID}&nodeId=215021807031&title=Baby+Care"},
    {"name": "Health & Wellness", "nodeId": "215032325031", "url": f"{BASE_URL}/tez/browse/explore/category?qcbrand={BRAND_ID}&nodeId=215032325031&title=Health"},
    {"name": "Stationery & Books", "nodeId": "215021827031", "url": f"{BASE_URL}/tez/browse/explore/category?qcbrand={BRAND_ID}&nodeId=215021827031&title=Stationery"}
]

async def scrape_full_store():
    print("[*] Starting Full Store Scraper for Amazon Egypt Now / Tez...")
    out_dir = Path(__file__).parent
    products_file = out_dir / "products.json"
    catalog_map = {}

    if products_file.exists():
        try:
            with open(products_file, "r", encoding="utf-8") as f:
                for item in json.load(f):
                    catalog_map[item["asin"]] = item
            print(f"[i] Loaded {len(catalog_map)} existing products from products.json")
        except Exception:
            pass

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            locale="ar-EG",
            viewport={"width": 1366, "height": 768}
        )
        page = await context.new_page()

        try:
            for dept in DEPARTMENTS:
                print(f"\n[==>] Crawling: {dept['name']}")
                try:
                    await page.goto(dept["url"], wait_until="domcontentloaded", timeout=45000)
                except Exception as err:
                    print(f"[-] Error loading {dept['name']}: {err}")
                    continue

                # Dismiss location modal if present
                try:
                    skip_btn = page.locator('button:has-text("Skip for now"), button:has-text("تخطي"), button[data-testid="bottom-sheet-close-button"]')
                    if await skip_btn.first.is_visible(timeout=3000):
                        await skip_btn.first.click()
                except Exception:
                    pass

                # Scroll down
                prev_count = 0
                retries = 0
                for _ in range(15):
                    await page.mouse.wheel(0, 2500)
                    await asyncio.sleep(1.2)
                    count = await page.locator('button[data-csa-c-slot-id*="AddToCart"]').count()
                    if count == prev_count and count > 0:
                        retries += 1
                        if retries >= 3:
                            break
                    else:
                        retries = 0
                        prev_count = count

                # Extract
                dept_items = await page.evaluate("""(categoryName) => {
                    const items = [];
                    const buttons = document.querySelectorAll('button[data-csa-c-slot-id*="AddToCart"]');

                    buttons.forEach(btn => {
                        const contentId = btn.getAttribute('data-csa-c-content-id') || '';
                        const asinMatch = contentId.match(/AsinFaceout-AddToCart-([A-Z0-9]{10})/);
                        const asin = asinMatch ? asinMatch[1] : '';
                        const titleAttr = btn.getAttribute('data-csa-c-product-title') || '';

                        let card = btn.closest('[role="button"]') || btn.parentElement;
                        while (card && card.tagName !== 'BODY' && !card.querySelector('img')) {
                            card = card.parentElement;
                        }

                        if (!card || !asin) return;

                        const heading = card.querySelector('h2, h3, [role="heading"]');
                        const title = heading ? heading.innerText.trim() : titleAttr;

                        const img = card.querySelector('img');
                        const imgSrc = img ? (img.getAttribute('src') || '') : '';

                        let currentPrice = '';
                        let currentPriceNum = null;
                        let oldPrice = null;
                        let oldPriceNum = null;

                        const priceLabels = Array.from(card.querySelectorAll('[aria-label*="EGP"], [aria-label*="جنيه"]'))
                            .map(el => el.getAttribute('aria-label') || el.innerText || '')
                            .filter(s => s.includes('EGP') || s.includes('جنيه'));

                        if (priceLabels.length > 0) {
                            currentPrice = priceLabels[0].replace(/\\s+/g, ' ').trim();
                            const m = currentPrice.match(/[\\d,.]+/);
                            if (m) currentPriceNum = parseFloat(m[0].replace(/,/g, ''));
                        }
                        if (priceLabels.length > 1) {
                            oldPrice = priceLabels[1].replace(/\\s+/g, ' ').trim();
                            const m = oldPrice.match(/[\\d,.]+/);
                            if (m) oldPriceNum = parseFloat(m[0].replace(/,/g, ''));
                        }

                        let discount = null;
                        const text = card.innerText;
                        const discMatch = text.match(/(\\d+%\\s*OFF)/i);
                        if (discMatch) discount = discMatch[1].trim();

                        if (title && asin) {
                            items.push({
                                asin,
                                title,
                                currentPrice: currentPrice || (currentPriceNum ? `EGP ${currentPriceNum}` : ''),
                                currentPriceNum,
                                oldPrice: oldPrice || (oldPriceNum ? `EGP ${oldPriceNum}` : null),
                                oldPriceNum,
                                currency: 'EGP',
                                discount,
                                category: categoryName,
                                productUrl: `https://www.amazon.eg/dp/${asin}`,
                                imgSrc
                            });
                        }
                    });

                    return items;
                }""", dept["name"])

                for item in dept_items:
                    catalog_map[item["asin"]] = item

                with open(products_file, "w", encoding="utf-8") as f:
                    json.dump(list(catalog_map.values()), f, ensure_ascii=False, indent=2)

                print(f"[+] Saved {len(dept_items)} items from {dept['name']}. Total: {len(catalog_map)}")

            # Export to Excel and CSV
            try:
                import pandas as pd
                df = pd.DataFrame(list(catalog_map.values()))
                df.to_csv(out_dir / "amazon_tez_products.csv", index=False, encoding="utf-8-sig")
                df.to_excel(out_dir / "amazon_tez_products.xlsx", index=False)
                print("[✔] CSV and Excel exports generated successfully.")
            except ImportError:
                pass

        finally:
            await browser.close()

if __name__ == "__main__":
    asyncio.run(scrape_full_store())
