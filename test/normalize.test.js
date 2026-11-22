const { test, describe } = require('node:test');
const assert = require('node:assert');
const {
  normalizeTitle,
  extractBrand,
  parseSize,
  normalizeUnit,
  createDuplicateKey
} = require('../src/normalize');

describe('Normalize & Deduplication Tests', () => {

  // 1. Arabic Title Normalization: letters & diacritics
  test('Case 1: Arabic diacritics & letter normalization (أ/إ/آ -> ا, ى -> ي, ة -> ه)', () => {
    const raw = 'حَلِيبٌ طَازَجٌ أَبْيَضْ مُعَقَّمْ مِنْ جُهَيْنَةَ';
    const norm = normalizeTitle(raw);
    assert.strictEqual(norm.includes('حليب'), true);
    assert.strictEqual(norm.includes('طازج'), true);
    assert.strictEqual(norm.includes('ابيض'), true);
    assert.strictEqual(norm.includes('جهينه'), true);
    // Diacritics should be completely removed
    assert.strictEqual(/[\u064B-\u065F\u0670]/.test(norm), false);
  });

  // 2. Arabic Promotional Words Stripping
  test('Case 2: Strip Arabic promotional words (عرض خاص، خصم، جديد، توصيل مجاني)', () => {
    const raw = 'جبنة دومتي فيتا 500 جم - عرض خاص خصم 20% جديد توصيل مجاني';
    const norm = normalizeTitle(raw);
    assert.strictEqual(norm.includes('عرض خاص'), false);
    assert.strictEqual(norm.includes('خصم'), false);
    assert.strictEqual(norm.includes('جديد'), false);
    assert.strictEqual(norm.includes('توصيل مجاني'), false);
    assert.strictEqual(norm.includes('دومتي') || norm.includes('دومتي'), true);
  });

  // 3. English Promotional Words & Lowercase
  test('Case 3: English title lowercasing and promo word removal (Special Offer, New, Discount)', () => {
    const raw = 'Persil Deep Clean Liquid Gel 3 Liters - SPECIAL OFFER Free Delivery & Discount';
    const norm = normalizeTitle(raw);
    assert.strictEqual(norm.includes('special offer'), false);
    assert.strictEqual(norm.includes('free delivery'), false);
    assert.strictEqual(norm.includes('discount'), false);
    assert.strictEqual(norm.includes('persil'), true);
  });

  // 4. Mixed Arabic & English Title Normalization
  test('Case 4: Mixed Arabic-English Title with Symbols', () => {
    const raw = 'شاي Lipton ناعم أحمر (Red Tea) - علبة 100 فتلة / عبوة توفير!!';
    const norm = normalizeTitle(raw);
    assert.strictEqual(norm.includes('توفير'), false);
    assert.strictEqual(norm.includes('('), false);
    assert.strictEqual(norm.includes('!'), false);
    assert.strictEqual(norm.includes('lipton'), true);
    assert.strictEqual(norm.includes('شاى') || norm.includes('شاي'), true);
  });

  // 5. Size Parsing: 1 كجم
  test('Case 5: Size Parsing - 1 كجم', () => {
    const size = parseSize('أرز مصري الضحى فاخر 1 كجم');
    assert.strictEqual(size.weight_value, 1);
    assert.strictEqual(size.weight_unit, 'كجم');
    assert.strictEqual(size.pack_count, 1);
    assert.strictEqual(size.size_text, '1 كجم');
  });

  // 6. Size Parsing: 500 جم
  test('Case 6: Size Parsing - 500 جم', () => {
    const size = parseSize('مكرونة ريجينا فرن 500 جم');
    assert.strictEqual(size.weight_value, 500);
    assert.strictEqual(size.weight_unit, 'جم');
    assert.strictEqual(size.pack_count, 1);
    assert.strictEqual(size.size_text, '500 جم');
  });

  // 7. Size Parsing: 1.5 لتر
  test('Case 7: Size Parsing - 1.5 لتر', () => {
    const size = parseSize('عصير جهينة بيور تفاح 1.5 لتر بدون سكر');
    assert.strictEqual(size.weight_value, 1.5);
    assert.strictEqual(size.weight_unit, 'لتر');
    assert.strictEqual(size.pack_count, 1);
    assert.strictEqual(size.size_text, '1.5 لتر');
  });

  // 8. Size Parsing: 750 مل
  test('Case 8: Size Parsing - 750 مل', () => {
    const size = parseSize('زيت زيتون وادي فود بكر ممتاز 750 مل');
    assert.strictEqual(size.weight_value, 750);
    assert.strictEqual(size.weight_unit, 'مل');
    assert.strictEqual(size.pack_count, 1);
    assert.strictEqual(size.size_text, '750 مل');
  });

  // 9. Size Parsing: Multipack 6 × 100 جم
  test('Case 9: Size Parsing - Multipack (6 × 100 جم)', () => {
    const size = parseSize('تونة صن شاين قطع 6 × 100 جم في الزيت');
    assert.strictEqual(size.weight_value, 100);
    assert.strictEqual(size.weight_unit, 'جم');
    assert.strictEqual(size.pack_count, 6);
    assert.strictEqual(size.size_text, '6 × 100 جم');
  });

  // 10. Size Parsing: Reverse Multipack 100g x 6
  test('Case 10: Size Parsing - Reverse Multipack (100g x 6)', () => {
    const size = parseSize('Bake Rolz Salt 100g x 6 packs');
    assert.strictEqual(size.weight_value, 100);
    assert.strictEqual(size.weight_unit, 'جم');
    assert.strictEqual(size.pack_count, 6);
  });

  // 11. Size Parsing: 12 قطعة
  test('Case 11: Size Parsing - Pieces (12 قطعة)', () => {
    const size = parseSize('جبنة لافاش كيري مثلثات 12 قطعة');
    assert.strictEqual(size.weight_value, 12);
    assert.strictEqual(size.weight_unit, 'قطعة');
    assert.strictEqual(size.pack_count, 12);
    assert.strictEqual(size.size_text, '12 قطعة');
  });

  // 12. Size Parsing: Pack Multiplier ×2
  test('Case 12: Size Parsing - Multiplier (×2)', () => {
    const size = parseSize('كلوركس مبيض أبيض ×2 عبوة');
    assert.strictEqual(size.weight_unit, 'قطعة');
    assert.strictEqual(size.pack_count, 2);
  });

  // 13. Brand Extraction: Domty (دومتي)
  test('Case 13: Brand Extraction - Domty', () => {
    assert.strictEqual(extractBrand('جبنة بيضاء فيتا من دومتي 500 جم'), 'Domty');
    assert.strictEqual(extractBrand('Domty Plus Feta Cheese 1kg'), 'Domty');
  });

  // 14. Brand Extraction: Juhayna (جهينة)
  test('Case 14: Brand Extraction - Juhayna', () => {
    assert.strictEqual(extractBrand('حليب جهينة كامل الدسم 1 لتر'), 'Juhayna');
    assert.strictEqual(extractBrand('Juhayna Pure Orange Juice 1L'), 'Juhayna');
  });

  // 15. Brand Extraction: Edita (Molto / Todo)
  test('Case 15: Brand Extraction - Edita / Molto / Todo', () => {
    assert.strictEqual(extractBrand('كرواسون مولتو سبريد شوكولاتة كروكيه 6 قطع'), 'Edita');
    assert.strictEqual(extractBrand('كيك تودو ميني شوكولاتة 12 قطعة'), 'Edita');
    assert.strictEqual(extractBrand('Bake Rolz Pizza Flavor 70g'), 'Edita');
  });

  // 16. Brand Extraction: P&G Brands (Ariel / Fairy / Pampers)
  test('Case 16: Brand Extraction - P&G (Ariel, Fairy, Pampers)', () => {
    assert.strictEqual(extractBrand('مسحوق غسيل اوتوماتيك اريال لافندر 4 كجم'), 'Ariel');
    assert.strictEqual(extractBrand('سائل غسيل الأطباق فيري ليمون 650 مل'), 'Fairy');
    assert.strictEqual(extractBrand('بامبرز عناية مميزة مقاس 3 عبوة جامبو 64 حفاضة'), 'Pampers');
  });

  // 17. Brand Extraction: Beverage Brands (Pepsi, Coca-Cola, Spiro Spathis)
  test('Case 17: Brand Extraction - Beverages (Pepsi, Coca-Cola, Spiro Spathis)', () => {
    assert.strictEqual(extractBrand('مشروب غازي بيبسي كانز 330 مل'), 'Pepsi');
    assert.strictEqual(extractBrand('Coca-Cola Original Taste Can 330ml'), 'Coca-Cola');
    assert.strictEqual(extractBrand('سبيرو سباتس ليمون صودا 330 مل'), 'Spiro Spathis');
  });

  // 18. Unit Normalization: English and Arabic variations
  test('Case 18: Unit normalization (kg, g, ltr, ml, pcs)', () => {
    assert.strictEqual(normalizeUnit('kg'), 'كجم');
    assert.strictEqual(normalizeUnit('كيلوغرام'), 'كجم');
    assert.strictEqual(normalizeUnit('g'), 'جم');
    assert.strictEqual(normalizeUnit('جرام'), 'جم');
    assert.strictEqual(normalizeUnit('liter'), 'لتر');
    assert.strictEqual(normalizeUnit('l'), 'لتر');
    assert.strictEqual(normalizeUnit('ml'), 'مل');
    assert.strictEqual(normalizeUnit('ميليلتر'), 'مل');
    assert.strictEqual(normalizeUnit('pcs'), 'قطعة');
    assert.strictEqual(normalizeUnit('حبات'), 'قطعة');
  });

  // 19. Duplicate Key Generation: Same Product Different ASIN
  test('Case 19: Duplicate Key Matching - Same Product, Different ASIN & Promo Text', () => {
    const item1 = {
      asin: 'B01AAAAAA1',
      title: 'حليب جهينة كامل الدسم 1 لتر - عرض خاص',
      title_norm: normalizeTitle('حليب جهينة كامل الدسم 1 لتر - عرض خاص'),
      brand: extractBrand('حليب جهينة كامل الدسم 1 لتر - عرض خاص'),
      ...parseSize('حليب جهينة كامل الدسم 1 لتر - عرض خاص')
    };

    const item2 = {
      asin: 'B01BBBBBB2',
      title: 'حليب جهينة كامل الدسم 1 لتر - جديد توصيل مجاني!!',
      title_norm: normalizeTitle('حليب جهينة كامل الدسم 1 لتر - جديد توصيل مجاني!!'),
      brand: extractBrand('حليب جهينة كامل الدسم 1 لتر - جديد توصيل مجاني!!'),
      ...parseSize('حليب جهينة كامل الدسم 1 لتر - جديد توصيل مجاني!!')
    };

    const key1 = createDuplicateKey(item1);
    const key2 = createDuplicateKey(item2);

    assert.strictEqual(key1, key2);
  });

  // 20. Different Products do NOT trigger duplicate key match
  test('Case 20: Different Products Produce Unique Keys', () => {
    const item1 = {
      asin: 'B01AAAAAA1',
      title: 'حليب جهينة كامل الدسم 1 لتر',
      title_norm: normalizeTitle('حليب جهينة كامل الدسم 1 لتر'),
      brand: 'Juhayna',
      weight_value: 1,
      weight_unit: 'لتر'
    };

    const item2 = {
      asin: 'B01AAAAAA2',
      title: 'حليب جهينة خالي الدسم 1 لتر',
      title_norm: normalizeTitle('حليب جهينة خالي الدسم 1 لتر'),
      brand: 'Juhayna',
      weight_value: 1,
      weight_unit: 'لتر'
    };

    const item3 = {
      asin: 'B01AAAAAA3',
      title: 'حليب جهينة كامل الدسم 500 مل',
      title_norm: normalizeTitle('حليب جهينة كامل الدسم 500 مل'),
      brand: 'Juhayna',
      weight_value: 500,
      weight_unit: 'مل'
    };

    const key1 = createDuplicateKey(item1);
    const key2 = createDuplicateKey(item2);
    const key3 = createDuplicateKey(item3);

    assert.notStrictEqual(key1, key2);
    assert.notStrictEqual(key1, key3);
  });
});
