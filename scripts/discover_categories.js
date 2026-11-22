const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BRAND_ID = 'sAuWWBROaG';
const BASE_URL = 'https://www.amazon.eg';

const PARENT_DEPARTMENTS = [
  { id: 'fruits-vegetables', name: 'Fruits & Vegetables', nodeId: '215052334031', url: `${BASE_URL}/tez/browse/explore/category?qcbrand=${BRAND_ID}&nodeId=215052334031` },
  { id: 'meat-chicken-fish', name: 'Chicken, Meat & Fish', nodeId: '214841696031', url: `${BASE_URL}/tez/browse/explore/category?qcbrand=${BRAND_ID}&nodeId=214841696031` },
  { id: 'dairy-eggs', name: 'Dairy, Eggs & Cheese', nodeId: '223985148031', url: `${BASE_URL}/tez/browse/explore/category?qcbrand=${BRAND_ID}&nodeId=223985148031` },
  { id: 'bakery', name: 'Bakery & Bread', nodeId: '215052333031', url: `${BASE_URL}/tez/browse/explore/category?qcbrand=${BRAND_ID}&nodeId=215052333031` },
  { id: 'cooking-baking', name: 'Cooking & Baking', nodeId: '212925568031', url: `${BASE_URL}/tez/browse/explore/category?qcbrand=${BRAND_ID}&nodeId=212925568031` },
  { id: 'snacks-sweets', name: 'Snacks, Chips & Popcorn', nodeId: '215093298031', url: `${BASE_URL}/tez/browse/explore/category?qcbrand=${BRAND_ID}&nodeId=215093298031` },
  { id: 'beverages', name: 'Beverages, Coffee & Tea', nodeId: '212925566031', url: `${BASE_URL}/tez/browse/explore/category?qcbrand=${BRAND_ID}&nodeId=212925566031` },
  { id: 'frozen-food', name: 'Frozen Food', nodeId: '212925567031', url: `${BASE_URL}/tez/browse/explore/category?qcbrand=${BRAND_ID}&nodeId=212925567031` },
  { id: 'household-cleaning', name: 'Household & Cleaning', nodeId: '215103357031', url: `${BASE_URL}/tez/browse/explore/category?qcbrand=${BRAND_ID}&nodeId=215103357031` },
  { id: 'beauty', name: 'Beauty & Personal Care', nodeId: '215021840031', url: `${BASE_URL}/tez/browse/explore/category?qcbrand=${BRAND_ID}&nodeId=215021840031` },
  { id: 'baby-care', name: 'Baby Care', nodeId: '215021807031', url: `${BASE_URL}/tez/browse/explore/category?qcbrand=${BRAND_ID}&nodeId=215021807031` },
  { id: 'personal-care', name: 'Health & Wellness', nodeId: '215032325031', url: `${BASE_URL}/tez/browse/explore/category?qcbrand=${BRAND_ID}&nodeId=215032325031` },
  { id: 'electronics', name: 'Electronics & Accessories', nodeId: '215078183031', url: `${BASE_URL}/tez/browse/explore/category?qcbrand=${BRAND_ID}&nodeId=215078183031` },
  { id: 'home-kitchen', name: 'Home & Kitchen', nodeId: '215021792031', url: `${BASE_URL}/tez/browse/explore/category?qcbrand=${BRAND_ID}&nodeId=215021792031` },
  { id: 'toys-games', name: 'Toys & Games', nodeId: '215137533031', url: `${BASE_URL}/tez/browse/explore/category?qcbrand=${BRAND_ID}&nodeId=215137533031` },
  { id: 'stationery', name: 'Stationery & Books', nodeId: '215021827031', url: `${BASE_URL}/tez/browse/explore/category?qcbrand=${BRAND_ID}&nodeId=215021827031` }
];

async function discover() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'ar-EG',
    viewport: { width: 1366, height: 768 }
  });

  const discovered = new Map();

  // Add parents
  for (const parent of PARENT_DEPARTMENTS) {
    discovered.set(parent.nodeId, {
      id: parent.id,
      parent_id: null,
      name: parent.name,
      nodeId: parent.nodeId,
      url: parent.url,
      depth: 0
    });
  }

  const page = await context.newPage();

  // Check browse homepage first
  console.log('Visiting browse page...');
  try {
    await page.goto(`${BASE_URL}/tez/browse?qcbrand=${BRAND_ID}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const links = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll('a[href*="nodeId"], a[href*="category"]'));
      return anchors.map(a => ({
        href: a.href,
        text: a.innerText.trim()
      }));
    });
    console.log(`Found ${links.length} potential links on browse page.`);
    for (const l of links) {
      const match = l.href.match(/nodeId=([0-9]+)/);
      if (match) {
        const nodeId = match[1];
        if (!discovered.has(nodeId)) {
          const name = l.text || `Category ${nodeId}`;
          const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `node-${nodeId}`;
          discovered.set(nodeId, {
            id: slug,
            parent_id: null,
            name: name,
            nodeId: nodeId,
            url: l.href,
            depth: 1
          });
        }
      }
    }
  } catch (err) {
    console.warn('Error on browse page:', err.message);
  }

  // Visit each parent department to extract subcategories
  for (const parent of PARENT_DEPARTMENTS) {
    console.log(`Checking parent: ${parent.name}...`);
    try {
      await page.goto(parent.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      const subLinks = await page.evaluate(() => {
        const anchors = Array.from(document.querySelectorAll('a[href*="category"], a[href*="nodeId"], [data-csa-c-slot-id*="category"] a'));
        return anchors.map(a => ({
          href: a.href,
          text: a.innerText.trim()
        }));
      });

      console.log(`Parent ${parent.name} returned ${subLinks.length} sub-links.`);
      for (const l of subLinks) {
        const match = l.href.match(/nodeId=([0-9]+)/);
        if (match) {
          const nodeId = match[1];
          if (!discovered.has(nodeId)) {
            const name = l.text || `Category ${nodeId}`;
            const slug = `${parent.id}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}` || `sub-${nodeId}`;
            discovered.set(nodeId, {
              id: slug,
              parent_id: parent.id,
              name: name,
              nodeId: nodeId,
              url: l.href,
              depth: 1
            });
          }
        }
      }
    } catch (err) {
      console.warn(`Failed checking parent ${parent.name}:`, err.message);
    }
  }

  await browser.close();

  console.log(`Total categories discovered: ${discovered.size}`);
  const results = Array.from(discovered.values());
  console.log(JSON.stringify(results.slice(0, 5), null, 2));
}

discover().catch(console.error);
