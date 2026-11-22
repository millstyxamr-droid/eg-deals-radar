"""
Amazon Egypt Tez / Now Scraper (Python + Playwright)

Usage:
    pip install playwright pandas
    playwright install chromium
    python scraper.py
"""

import asyncio
import json
import re
from pathlib import Path
from playwright.async_api import async_playwright

TARGET_URL = "https://www.amazon.eg/tez/browse?qcbrand=sAuWWBROaG"

async def scrape_amazon_tez(url=TARGET_URL):
    print(f"[+] Starting browser to scrape: {url}")
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            locale="ar-EG",
            viewport={"width": 1366, "height": 768}
        )
        page = await context.new_page()

        try:
            print("[+] Navigating to page...")
            await page.goto(url, wait_until="domcontentloaded", timeout=60000)

            # Dismiss location modal if it appears
            try:
                skip_btn = page.locator('button:has-text("Skip for now"), button:has-text("تخطي"), button[data-testid="bottom-sheet-close-button"]')
                if await skip_btn.is_visible(timeout=5000):
                    await skip_btn.click()
                    print("[+] Dismissed location modal.")
            except Exception:
                pass

            # Scroll down to load all items via infinite scroll
            print("[+] Scrolling to load all items...")
            prev_height = 0
            retries = 0

            while retries < 3:
                await page.mouse.wheel(0, 1500)
                await asyncio.sleep(1.5)
                current_height = await page.evaluate("() => document.body.scrollHeight")
                if current_height == prev_height:
                    retries += 1
                else:
                    retries = 0
                    prev_height = current_height

                is_footer = await page.evaluate("() => document.body.innerText.includes('Everything you need, delivered now')")
                if is_footer and retries > 1:
                    break

            print("[+] Extracting products...")
            products = await page.evaluate("""() => {
                const results = [];
                const addButtons = document.querySelectorAll('button[data-csa-c-slot-id="AsinFaceout-AddToCart"]');

                addButtons.forEach(btn => {
                    const contentId = btn.getAttribute('data-csa-c-content-id') || '';
                    const asinMatch = contentId.match(/AsinFaceout-AddToCart-([A-Z0-9]{10})/);
                    const asin = asinMatch ? asinMatch[1] : '';
                    const title = btn.getAttribute('data-csa-c-product-title') || '';
                    const category = btn.getAttribute('data-csa-c-widget') || '';

                    let card = btn.closest('[role="button"]') || btn.parentElement;
                    while (card && card.tagName !== 'BODY' && !card.querySelector('img')) {
                        card = card.parentElement;
                    }

                    let imgSrc = '';
                    let currentPrice = '';
                    let currentPriceNum = null;
                    let oldPrice = null;
                    let oldPriceNum = null;
                    let discount = null;

                    if (card) {
                        const img = card.querySelector('img');
                        if (img) imgSrc = img.getAttribute('src') || '';

                        const priceEls = card.querySelectorAll('[aria-label*="EGP"], [aria-label*="جنيه"]');
                        if (priceEls.length > 0) {
                            currentPrice = priceEls[0].getAttribute('aria-label') || priceEls[0].innerText || '';
                            const match = currentPrice.match(/[\\d,.]+/);
                            if (match) currentPriceNum = parseFloat(match[0].replace(/,/g, ''));
                        }
                        if (priceEls.length > 1) {
                            oldPrice = priceEls[1].getAttribute('aria-label') || priceEls[1].innerText || '';
                            const match = oldPrice.match(/[\\d,.]+/);
                            if (match) oldPriceNum = parseFloat(match[0].replace(/,/g, ''));
                        }

                        const badgeEl = Array.from(card.querySelectorAll('p, span')).find(el => el.innerText && el.innerText.includes('% OFF'));
                        if (badgeEl) discount = badgeEl.innerText.trim();
                    }

                    if (asin && title) {
                        results.push({
                            asin,
                            title,
                            currentPrice: currentPrice or (currentPriceNum ? `EGP ${currentPriceNum}` : ''),
                            currentPriceNum,
                            oldPrice: oldPrice or (oldPriceNum ? `EGP ${oldPriceNum}` : null),
                            oldPriceNum,
                            currency: 'EGP',
                            discount,
                            category,
                            productUrl: `https://www.amazon.eg/dp/${asin}`,
                            imgSrc
                        });
                    }
                });
                return results;
            }""")

            print(f"[+] Successfully extracted {len(products)} products.")

            out_dir = Path(__file__).parent
            with open(out_dir / "products.json", "w", encoding="utf-8") as f:
                json.dump(products, f, ensure_ascii=False, indent=2)

            # Export to CSV with UTF-8 BOM for Excel
            try:
                import pandas as pd
                df = pd.DataFrame(products)
                df.to_csv(out_dir / "amazon_tez_products.csv", index=False, encoding="utf-8-sig")
                df.to_excel(out_dir / "amazon_tez_products.xlsx", index=False)
                print("[+] Saved to CSV and Excel (.xlsx).")
            except ImportError:
                print("[!] pandas not installed; products saved to products.json.")

        finally:
            await browser.close()

if __name__ == "__main__":
    asyncio.run(scrape_amazon_tez())
