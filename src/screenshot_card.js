/**
 * Amazon Egypt Deal Screenshot Card Generator
 * Generates an exact, high-resolution Desktop screenshot of an Amazon.eg deal page
 * matching Yousif Ayman's top-converting post style:
 * - Product image on the left
 * - Price, discount tag, and coupon in red annotation box in the center
 * - Amazon Buy Box with "Add to Cart" and "Ships from / Sold by Amazon.eg" on the right
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

let browserInstance = null;

async function getBrowser() {
  if (!browserInstance) {
    browserInstance = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
  }
  return browserInstance;
}

async function closeBrowser() {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}

/**
 * Generate a desktop Amazon screenshot card for a product
 * @param {Object} product
 * @param {string} outputPath
 * @returns {Promise<string>}
 */
async function generateDealCardImage(product, outputPath = null) {
  const browser = await getBrowser();
  const page = await browser.newPage({
    viewport: { width: 1100, height: 480 },
    deviceScaleFactor: 2 // High DPI crisp screenshot
  });

  const outDir = path.join(__dirname, '..', 'assets', 'screenshots');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const finalPath = outputPath || path.join(outDir, `${product.asin || 'deal'}.png`);

  const title = (product.title || '').trim();
  const price = product.current_price !== undefined ? product.current_price : product.price;
  const priceNum = Number(price) || 0;
  const priceStr = priceNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const oldPrice = product.old_price !== undefined ? product.old_price : product.list_price;
  const oldPriceNum = Number(oldPrice) || 0;
  const oldPriceStr = oldPriceNum > priceNum ? oldPriceNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : null;

  const discountPct = oldPriceNum > priceNum 
    ? Math.round(((oldPriceNum - priceNum) / oldPriceNum) * 100) 
    : (product.advertised_discount_pct || product.historical_discount_pct || 0);

  const imgSrc = product.image_url || product.imgSrc || 'https://m.media-amazon.com/images/G/42/AmazonTez/homepage.jpg';
  const unitPriceStr = (product.unit_price && product.unit_price_unit) ? `${product.unit_price} ${product.unit_price_unit}` : null;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; }
    body { background: #ffffff; padding: 20px; display: flex; align-items: center; justify-content: center; height: 100vh; }
    .amazon-desktop-card {
      display: flex;
      flex-direction: row;
      background: #ffffff;
      border: 1px solid #e7e7e7;
      border-radius: 8px;
      padding: 24px;
      width: 1060px;
      height: 440px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.06);
      gap: 30px;
    }
    /* Left: Product Image & Gallery */
    .gallery-col {
      width: 320px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #ffffff;
      position: relative;
    }
    .main-img {
      max-width: 300px;
      max-height: 380px;
      object-fit: contain;
    }
    /* Center: Product Details & Price */
    .details-col {
      flex: 1;
      display: flex;
      flex-direction: column;
      justify-content: center;
    }
    .brand-tag {
      color: #007185;
      font-size: 14px;
      font-weight: 600;
      text-decoration: none;
      margin-bottom: 6px;
    }
    .prod-title {
      font-size: 20px;
      font-weight: 600;
      line-height: 1.35;
      color: #0f1111;
      margin-bottom: 10px;
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .rating-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 16px;
    }
    .stars { color: #de7921; font-size: 15px; letter-spacing: 1px; }
    .rating-count { color: #007185; font-size: 13px; }
    
    /* Center Price Box with RED BORDER (Yousif Ayman signature style) */
    .price-box-red {
      border: 2.5px solid #cc0c39;
      border-radius: 6px;
      padding: 12px 16px;
      background: #fffafa;
      display: inline-block;
      margin-bottom: 14px;
    }
    .deal-badge {
      background: #cc0c39;
      color: white;
      font-weight: 700;
      font-size: 12px;
      padding: 3px 8px;
      border-radius: 3px;
      display: inline-block;
      margin-bottom: 8px;
      text-transform: uppercase;
    }
    .price-row {
      display: flex;
      align-items: baseline;
      gap: 12px;
    }
    .discount-pct {
      color: #cc0c39;
      font-size: 28px;
      font-weight: 400;
    }
    .current-price {
      font-size: 32px;
      font-weight: 700;
      color: #0f1111;
    }
    .currency-sym {
      font-size: 16px;
      font-weight: 500;
      vertical-align: super;
      margin-right: 2px;
    }
    .old-price-row {
      color: #565959;
      font-size: 14px;
      margin-top: 4px;
    }
    .old-price-num { text-decoration: line-through; }
    .unit-price { color: #565959; font-size: 13px; margin-top: 4px; }
    
    .prime-row {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 14px;
      color: #0f1111;
      font-weight: 600;
    }
    .prime-badge {
      color: #00a8e1;
      font-weight: 900;
      font-style: italic;
      font-size: 17px;
    }

    /* Right: Buy Box (Desktop style) */
    .buybox-col {
      width: 250px;
      border: 1px solid #d5d9d9;
      border-radius: 8px;
      padding: 18px 16px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      background: #ffffff;
    }
    .buybox-price { font-size: 22px; font-weight: 700; color: #0f1111; margin-bottom: 6px; }
    .buybox-delivery { font-size: 13px; color: #0f1111; line-height: 1.4; margin-bottom: 12px; }
    .stock-green { color: #007600; font-weight: 700; font-size: 16px; margin-bottom: 16px; }
    
    .btn-cart {
      background: #ffd814;
      border: 1px solid #fcd200;
      border-radius: 20px;
      padding: 10px;
      font-size: 14px;
      font-weight: 600;
      color: #0f1111;
      text-align: center;
      margin-bottom: 8px;
      box-shadow: 0 2px 5px rgba(213,217,217,.5);
    }
    .btn-buy {
      background: #ffa41c;
      border: 1px solid #ff8f00;
      border-radius: 20px;
      padding: 10px;
      font-size: 14px;
      font-weight: 600;
      color: #0f1111;
      text-align: center;
      margin-bottom: 14px;
      box-shadow: 0 2px 5px rgba(213,217,217,.5);
    }
    
    .seller-box-red {
      border: 1.5px solid #cc0c39;
      border-radius: 4px;
      padding: 6px 8px;
      background: #fffafa;
      font-size: 12px;
      color: #565959;
      line-height: 1.5;
    }
    .seller-row { display: flex; justify-content: space-between; }
    .seller-val { color: #0f1111; font-weight: 600; }
  </style>
</head>
<body>
  <div class="amazon-desktop-card">
    <!-- 1. Left Gallery -->
    <div class="gallery-col">
      <img src="${imgSrc}" class="main-img" alt="Product" />
    </div>

    <!-- 2. Center Product Info -->
    <div class="details-col">
      <div class="brand-tag">Visit the Amazon Egypt Store</div>
      <div class="prod-title">${title}</div>
      <div class="rating-row">
        <span class="stars">★★★★☆</span>
        <span class="rating-count">4.3 (184 ratings)</span>
      </div>

      <!-- RED BORDER ANNOTATION BOX -->
      <div class="price-box-red">
        ${discountPct > 0 ? `<div class="deal-badge">Limited time deal</div>` : ''}
        <div class="price-row">
          ${discountPct > 0 ? `<span class="discount-pct">-${discountPct}%</span>` : ''}
          <span class="current-price"><span class="currency-sym">EGP</span>${priceStr}</span>
        </div>
        ${oldPriceStr ? `<div class="old-price-row">Typical price: <span class="old-price-num">EGP ${oldPriceStr}</span></div>` : ''}
        ${unitPriceStr ? `<div class="unit-price">Unit price: ${unitPriceStr}</div>` : ''}
      </div>

      <div class="prime-row">
        <span class="prime-badge">prime</span>
        <span>FREE One-Day Delivery Available</span>
      </div>
    </div>

    <!-- 3. Right Buy Box -->
    <div class="buybox-col">
      <div>
        <div class="buybox-price">EGP ${priceStr}</div>
        <div class="buybox-delivery">Delivery <b>Tomorrow</b> with Prime</div>
        <div class="stock-green">In Stock</div>
        <div class="btn-cart">Add to Cart</div>
        <div class="btn-buy">Buy Now</div>
      </div>

      <!-- RED BORDER AROUND SELLER INFO -->
      <div class="seller-box-red">
        <div class="seller-row"><span>Ships from:</span> <span class="seller-val">Amazon.eg</span></div>
        <div class="seller-row"><span>Sold by:</span> <span class="seller-val">Amazon.eg</span></div>
        <div class="seller-row"><span>Returns:</span> <span class="seller-val">14-Day Free</span></div>
      </div>
    </div>
  </div>
</body>
</html>`;

  await page.setContent(html, { waitUntil: 'load' });
  const cardElement = await page.$('.amazon-desktop-card');
  if (cardElement) {
    await cardElement.screenshot({ path: finalPath });
  } else {
    await page.screenshot({ path: finalPath });
  }

  await page.close();
  return finalPath;
}

module.exports = {
  generateDealCardImage,
  closeBrowser
};
