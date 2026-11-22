/**
 * Amazon Egypt Catalog Normalization & Duplicate Detection
 * 
 * Normalizes product titles, extracts brands and weight/size specifications,
 * and identifies duplicate products across differing ASINs.
 */

// Comprehensive Egyptian FMCG / Supermarket Brand Dictionary
const BRAND_DICTIONARY = [
  // Dairy & Juices
  { canonical: 'Juhayna', aliases: ['juhayna', 'جهينة', 'جهينه'] },
  { canonical: 'Domty', aliases: ['domty', 'دومتي', 'دومتي'] },
  { canonical: 'Almarai', aliases: ['almarai', 'al marai', 'المراعي'] },
  { canonical: 'Lamar', aliases: ['lamar', 'لمار'] },
  { canonical: 'Danone', aliases: ['danone', 'دانون', 'activia', 'اكتيفيا'] },
  { canonical: 'President', aliases: ['president', 'président', 'بريزيدون', 'بريزيدنت', 'برزيدون'] },
  { canonical: 'Teama', aliases: ['teama', 'طعمة', 'طعمه'] },
  { canonical: 'Panda', aliases: ['panda', 'باندا'] },
  { canonical: 'Kiri', aliases: ['kiri', 'كيري'] },
  { canonical: 'La Vache qui rit', aliases: ['la vache qui rit', 'لافاش كيري', 'البقرة الضاحكة', 'لا فاش كي ري'] },
  { canonical: 'Katilo', aliases: ['katilo', 'قتيلو', 'كتيلو'] },
  { canonical: 'Dina Farms', aliases: ['dina farms', 'مزارع دينا', 'دينا فارمز'] },
  { canonical: 'Abu El Walad', aliases: ['abu el walad', 'abou el walad', 'ابو الولد', 'أبو الولد'] },
  { canonical: 'Green Land', aliases: ['green land', 'جرين لاند', 'جرينلاند'] },
  { canonical: 'Al Maraa', aliases: ['al maraa', 'المراعى'] },

  // Bakery & Confectionery (Edita & others)
  { canonical: 'Edita', aliases: ['edita', 'ايديتا', 'إيديتا', 'molto', 'مولتو', 'todo', 'تودو', 'bake rolz', 'بيك رولز', 'bake stix', 'freska', 'فريسكا', 'twinkies', 'توينكيز', 'hohos', 'هوهوز', 'tiger tail'] },
  { canonical: 'Cadbury', aliases: ['cadbury', 'كادبوري', 'كادبورى', 'dairy milk', 'flake', 'moro', 'مورو', 'bubbly'] },
  { canonical: 'Galaxy', aliases: ['galaxy', 'جالكسي', 'جلاكسي', 'flutes', 'فلوتس'] },
  { canonical: 'Nestlé', aliases: ['nestle', 'nestlé', 'نستله', 'نستلة', 'nescafe', 'نسكافيه', 'nesquik', 'نسكويك', 'nido', 'نيدو', 'kitkat', 'kit kat', 'كيت كات', 'cerelac', 'سيريلاك', 'pure life', 'بيور لايف', 'maggi', 'ماجي', 'crunch', 'كرانش'] },
  { canonical: 'Kinder', aliases: ['kinder', 'كيندر', 'كيندر بوينو'] },
  { canonical: 'Ferrero', aliases: ['ferrero', 'فيريرو', 'nutella', 'نوتيلا', 'rocher'] },
  { canonical: 'Bisco Misr', aliases: ['bisco misr', 'بسكو مصر', 'بسكويت لوكس'] },
  { canonical: 'Ulker', aliases: ['ulker', 'أولكر', 'اولكر'] },
  { canonical: 'Corona', aliases: ['corona', 'كورونا'] },
  { canonical: 'Bimbo', aliases: ['bimbo', 'بيمبو'] },
  { canonical: 'Covertina', aliases: ['covertina', 'كوفرتينا', 'كفرتينا'] },

  // Beverages & Soft Drinks
  { canonical: 'Pepsi', aliases: ['pepsi', 'بيبسي', 'بيبسى', '7up', 'seven up', 'سفن اب', 'mirinda', 'ميرندا', 'mountain dew', 'ماونتن ديو', 'aquafina', 'اكوافينا', 'أكوافينا', 'sting', 'ستينج'] },
  { canonical: 'Coca-Cola', aliases: ['coca-cola', 'coca cola', 'كوكاكولا', 'كوكا كولا', 'coke', 'sprite', 'سبرايت', 'fanta', 'فانتا', 'schweppes', 'شويبس', 'dasani', 'داساني'] },
  { canonical: 'Spiro Spathis', aliases: ['spiro spathis', 'سبيرو سباتس', 'سبيرو سباتيس'] },
  { canonical: 'V7', aliases: ['v7', 'في 7', 'في سبعة', 'في سفن'] },
  { canonical: 'Fayrouz', aliases: ['fayrouz', 'فيروز'] },
  { canonical: 'Birell', aliases: ['birell', 'بيريل'] },
  { canonical: 'Red Bull', aliases: ['red bull', 'ريد بول'] },
  { canonical: 'Baraka', aliases: ['baraka', 'بركة'] },
  { canonical: 'Siwa', aliases: ['siwa', 'سيوة'] },
  { canonical: 'Safi', aliases: ['safi', 'صافي', 'صافى'] },
  { canonical: 'Flo', aliases: ['flo', 'فلو'] },
  { canonical: 'Nestle Pure Life', aliases: ['pure life', 'نستله بيور لايف'] },

  // Hot Drinks & Snacks
  { canonical: 'El Arosa', aliases: ['el arosa', 'el arousa', 'العروسة', 'شاي العروسة', 'شاى العروسة'] },
  { canonical: 'Lipton', aliases: ['lipton', 'ليبتون'] },
  { canonical: 'Ahmed Tea', aliases: ['ahmad tea', 'ahmed tea', 'شاي احمد', 'شاى احمد'] },
  { canonical: 'ISIS', aliases: ['isis', 'ايزيس', 'إيزيس'] },
  { canonical: 'Abu Auf', aliases: ['abu auf', 'abuauf', 'ابو عوف', 'أبو عوف'] },
  { canonical: 'Chipsy', aliases: ['chipsy', 'شيبسي', 'شيبسى', 'lays', 'ليز', 'doritos', 'دوريتوس', 'cheetos', 'شيتوس', 'sunbites', 'صن بايتس'] },
  { canonical: 'Tiger', aliases: ['tiger', 'تايجرز', 'تايجر'] },
  { canonical: 'Fox', aliases: ['fox', 'فوكس'] },
  { canonical: 'Jaguar', aliases: ['jaguar', 'جاجوار', 'جاكوار'] },

  // Cooking, Baking & Pantry
  { canonical: 'Crystal', aliases: ['crystal', 'كريستال'] },
  { canonical: 'Afia', aliases: ['afia', 'عافية', 'عافيه'] },
  { canonical: 'Al-Doha', aliases: ['al-doha', 'el doha', 'eldoha', 'الضحى', 'الضحى'] },
  { canonical: 'Al-Saada', aliases: ['al-saada', 'al saada', 'السعادة'] },
  { canonical: 'Regina', aliases: ['regina', 'ريجينا'] },
  { canonical: 'Italiano', aliases: ['italiano', 'ايطاليانو'] },
  { canonical: 'Al-Maleka', aliases: ['al maleka', 'الملكة', 'الملكه'] },
  { canonical: 'Knorr', aliases: ['knorr', 'كنور', 'فاين فودز'] },
  { canonical: 'Heinz', aliases: ['heinz', 'هاينز'] },
  { canonical: 'Harvest', aliases: ['harvest', 'هارفست'] },
  { canonical: 'Wadi Food', aliases: ['wadi food', 'وادي فود'] },
  { canonical: 'Hero', aliases: ['hero', 'هيرو'] },
  { canonical: 'Vitrac', aliases: ['vitrac', 'فيتراك'] },
  { canonical: 'Halwani', aliases: ['halwani', 'halwani bros', 'حلواني', 'حلوانى', 'حلواني اخوان'] },
  { canonical: 'Faragalla', aliases: ['faragalla', 'فرج الله'] },
  { canonical: 'Americana', aliases: ['americana', 'امريكانا', 'أمريكانا'] },
  { canonical: 'Koki', aliases: ['koki', 'كوكي'] },
  { canonical: 'Atyab', aliases: ['atyab', 'أطياب', 'اطياب'] },
  { canonical: 'Al-Bawadi', aliases: ['al bawadi', 'al-bawadi', 'البوادي'] },
  { canonical: 'Rashidi El Mizan', aliases: ['rashidi el mizan', 'el rashidi', 'الرشيدي الميزان'] },
  { canonical: 'Oki', aliases: ['oki', 'اوكي'] },
  { canonical: 'Rawabi', aliases: ['rawabi', 'روابي'] },
  { canonical: 'Gannat', aliases: ['gannat', 'جنة'] },
  { canonical: 'Fern', aliases: ['fern', 'فيرن'] },
  { canonical: 'Golden Chef', aliases: ['golden chef', 'جولدن شيف'] },
  { canonical: 'Five Stars', aliases: ['five stars', 'خمس نجوم'] },
  { canonical: 'El Helw', aliases: ['el helw', 'الحلو'] },

  // Household & Cleaning
  { canonical: 'Ariel', aliases: ['ariel', 'اريال', 'أريال'] },
  { canonical: 'Tide', aliases: ['tide', 'تايد'] },
  { canonical: 'Persil', aliases: ['persil', 'برسيل'] },
  { canonical: 'Fairy', aliases: ['fairy', 'فيري', 'فيرى'] },
  { canonical: 'Pril', aliases: ['pril', 'بريل'] },
  { canonical: 'Clorox', aliases: ['clorox', 'كلوركس', 'كلوركس'] },
  { canonical: 'Downy', aliases: ['downy', 'داوني', 'داونى'] },
  { canonical: 'Harpic', aliases: ['harpic', 'هاربيك', 'هاربك'] },
  { canonical: 'Dettol', aliases: ['dettol', 'ديتول'] },
  { canonical: 'General', aliases: ['general', 'الجنرال'] },
  { canonical: 'Fine', aliases: ['fine', 'فاين'] },
  { canonical: 'Zeina', aliases: ['zeina', 'زينة', 'زينه'] },
  { canonical: 'Papia', aliases: ['papia', 'بابيا'] },
  { canonical: 'Familia', aliases: ['familia', 'فاميليا'] },
  { canonical: 'Oxi', aliases: ['oxi', 'اوكسي', 'أوكسي'] },
  { canonical: 'Flash', aliases: ['flash', 'فلاش'] },
  { canonical: 'Vanish', aliases: ['vanish', 'فانيش'] },
  { canonical: 'Finish', aliases: ['finish', 'فينيش'] },

  // Personal & Baby Care
  { canonical: 'Pampers', aliases: ['pampers', 'بامبرز'] },
  { canonical: 'Molfix', aliases: ['molfix', 'مولفيكس'] },
  { canonical: 'Bebem', aliases: ['bebem', 'بيبيم'] },
  { canonical: 'BabyJoy', aliases: ['babyjoy', 'baby joy', 'بيبي جوي'] },
  { canonical: 'Johnson\'s', aliases: ['johnson', 'johnson\'s', 'johnsons', 'جونسون'] },
  { canonical: 'Dove', aliases: ['dove', 'دوف'] },
  { canonical: 'Lux', aliases: ['lux', 'لوكس'] },
  { canonical: 'Nivea', aliases: ['nivea', 'نيفيا'] },
  { canonical: 'Pantene', aliases: ['pantene', 'بانتين'] },
  { canonical: 'Head & Shoulders', aliases: ['head & shoulders', 'head and shoulders', 'هيد اند شولدرز', 'هيد آند شولدرز'] },
  { canonical: 'Sunsilk', aliases: ['sunsilk', 'صانسيلك'] },
  { canonical: 'Clear', aliases: ['clear', 'كلير'] },
  { canonical: 'Rexona', aliases: ['rexona', 'ريكسونا'] },
  { canonical: 'Axe', aliases: ['axe', 'اكس'] },
  { canonical: 'Gillette', aliases: ['gillette', 'جيليت'] },
  { canonical: 'Signal', aliases: ['signal', 'سيجنال'] },
  { canonical: 'Colgate', aliases: ['colgate', 'كولجيت'] },
  { canonical: 'Sensodyne', aliases: ['sensodyne', 'سنسوداين'] },
  { canonical: 'Always', aliases: ['always', 'اولويز', 'أولويز'] },
  { canonical: 'Carefree', aliases: ['carefree', 'كيرفري'] }
];

/**
 * Normalizes title text:
 * - Lowercase
 * - Normalize Arabic chars (أ/إ/آ -> ا, ى -> ي, ة -> ه)
 * - Remove diacritics / tashkeel & tatweel
 * - Remove promotional words (عرض خاص, خصم, جديد, توصيل مجاني, x2, pack, etc.)
 * - Remove symbols, punctuation, and collapse whitespace
 */
function normalizeTitle(t) {
  if (!t || typeof t !== 'string') return '';

  let s = t.toLowerCase();

  // Remove Arabic diacritics / tashkeel
  s = s.replace(/[\u064B-\u065F\u0670]/g, '');

  // Remove tatweel
  s = s.replace(/\u0640/g, '');

  // Unify Arabic letters: أ/إ/آ/ٱ -> ا, ى -> ي, ة -> ه
  s = s.replace(/[أإآٱ]/g, 'ا');
  s = s.replace(/ى/g, 'ي');
  s = s.replace(/ة/g, 'ه');

  // Remove promotional phrases (Arabic & English)
  const promoPhrases = [
    /عرض\s*خاص/gi,
    /توصيل\s*مجاني/gi,
    /توصيل\s*مجانى/gi,
    /شحن\s*مجاني/gi,
    /شحن\s*مجانى/gi,
    /سعر\s*خاص/gi,
    /سوبر\s*توفير/gi,
    /توفير/gi,
    /وفر/gi,
    /خصم/gi,
    /جديد/gi,
    /وصل\s*حديثا/gi,
    /بافضل\s*سعر/gi,
    /special\s*offer/gi,
    /free\s*delivery/gi,
    /free\s*shipping/gi,
    /discount/gi,
    /new\s*arrival/gi,
    /promo/gi,
    /save/gi,
    /multipack/gi,
    /multi-pack/gi,
    /pack/gi,
    /[×x\*]\s*\d+\b/gi,
    /\b\d+\s*[×x\*]\b/gi
  ];

  for (const regex of promoPhrases) {
    s = s.replace(regex, ' ');
  }

  // Remove special symbols, brackets, punctuation
  s = s.replace(/[\(\)\[\]\{\}\/\\,;:\!\?@#\$%\^&\*\-_=\+\|~`"']/g, ' ');

  // Collapse multiple spaces and trim
  s = s.replace(/\s+/g, ' ').trim();

  return s;
}

/**
 * Extracts brand name using Egyptian brand dictionary + fallback from first words
 */
function extractBrand(t) {
  if (!t || typeof t !== 'string') return null;

  const titleLower = t.toLowerCase();
  const normalizedTitle = normalizeTitle(t);

  // 1. Search brand dictionary for exact alias match
  for (const entry of BRAND_DICTIONARY) {
    for (const alias of entry.aliases) {
      const aliasNorm = normalizeTitle(alias);
      // Word boundary match in title
      const wordMatch = new RegExp(`(^|[\\s\\-_/])${escapeRegExp(aliasNorm)}([\\s\\-_/]|$)`, 'i');
      if (wordMatch.test(normalizedTitle) || titleLower.includes(alias.toLowerCase())) {
        return entry.canonical;
      }
    }
  }

  // 2. Fallback: inspect the first 1-2 words if they form a plausible brand
  const words = t.trim().split(/\s+/);
  if (words.length > 0) {
    const firstWord = words[0].replace(/[^\w\u0600-\u06FF]/g, '');
    // If first word is not a common generic product descriptor
    const genericWords = new Set([
      'حليب', 'لبن', 'جبن', 'جبنة', 'زبادي', 'شاي', 'قهوة', 'مكرونة', 'ارز', 'زيت',
      'سمن', 'صلصة', 'عصير', 'ماء', 'مياه', 'مسحوق', 'صابون', 'شامبو', 'مناديل',
      'milk', 'cheese', 'tea', 'coffee', 'pasta', 'rice', 'oil', 'water', 'juice'
    ]);
    if (firstWord && !genericWords.has(firstWord.toLowerCase()) && firstWord.length >= 3) {
      // Capitalize first letter
      return firstWord.charAt(0).toUpperCase() + firstWord.slice(1);
    }
  }

  return null;
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Parses weight, volume, or pack size from product title.
 * Supports:
 * - "1 كجم", "500 جم", "1.5 لتر", "750 مل", "6 × 100 جم", "12 قطعة", "×2"
 * Returns: { weight_value, weight_unit, pack_count, size_text }
 * Units normalized to: 'كجم', 'جم', 'لتر', 'مل', 'قطعة'
 */
function parseSize(t) {
  if (!t || typeof t !== 'string') {
    return { weight_value: null, weight_unit: null, pack_count: 1, size_text: null };
  }

  let text = t.trim();

  // Pattern 1: Multipack with weight/volume: e.g. "6 × 100 جم", "6x100g", "6 * 100 مل", "100 جم × 6"
  const multiWeightRegex = /(\d+)\s*[×x\*]\s*([\d\.,]+)\s*(كجم|كغ|كيلو|كيلوجرام|كيلوغرام|kg|kgs|kilo|kilogram|جم|جرام|غرام|غ|g|gm|g\.|grams|gram|لتر|لترا|ليتر|l|lt|ltr|liter|litre|liters|مل|ملل|مليلتر|ميليلتر|ml|mll)(?=[^\p{L}\p{N}]|$)/iu;
  let match = text.match(multiWeightRegex);
  if (match) {
    const packCount = parseInt(match[1], 10);
    const val = parseFloat(match[2].replace(',', '.'));
    const unit = normalizeUnit(match[3]);
    return {
      weight_value: val,
      weight_unit: unit,
      pack_count: packCount,
      size_text: `${packCount} × ${val} ${unit}`
    };
  }

  // Reverse multipack: "100 جم × 6" or "100g x 6"
  const reverseMultiRegex = /([\d\.,]+)\s*(كجم|كغ|كيلو|كيلوجرام|كيلوغرام|kg|kgs|kilo|kilogram|جم|جرام|غرام|غ|g|gm|g\.|grams|gram|لتر|لترا|ليتر|l|lt|ltr|liter|litre|liters|مل|ملل|مليلتر|ميليلتر|ml|mll)\s*[×x\*]\s*(\d+)(?=[^\p{L}\p{N}]|$)/iu;
  match = text.match(reverseMultiRegex);
  if (match) {
    const val = parseFloat(match[1].replace(',', '.'));
    const unit = normalizeUnit(match[2]);
    const packCount = parseInt(match[3], 10);
    return {
      weight_value: val,
      weight_unit: unit,
      pack_count: packCount,
      size_text: `${packCount} × ${val} ${unit}`
    };
  }

  // Pattern 2: Single weight / volume: e.g. "1.5 لتر", "1 كجم", "500 جم", "750 مل", "250 ml", "1.5L"
  const singleWeightRegex = /([\d\.,]+)\s*(كجم|كغ|كيلو|كيلوجرام|كيلوغرام|kg|kgs|kilo|kilogram|جم|جرام|غرام|غ|g|gm|g\.|grams|gram|لتر|لترا|ليتر|l|lt|ltr|liter|litre|liters|مل|ملل|مليلتر|ميليلتر|ml|mll)(?=[^\p{L}\p{N}]|$)/iu;
  match = text.match(singleWeightRegex);
  if (match) {
    const val = parseFloat(match[1].replace(',', '.'));
    const unit = normalizeUnit(match[2]);
    return {
      weight_value: val,
      weight_unit: unit,
      pack_count: 1,
      size_text: `${val} ${unit}`
    };
  }

  // Pattern 3: Piece count: "12 قطعة", "12 قطع", "12 حبة", "12 pcs", "12 pieces", "12 count"
  const pieceRegex = /([\d\.,]+)\s*(قطعة|قطعه|قطع|حبة|حبه|حبات|رول|باكت|ظرف|كيس|حفاضة|حفاضه|منديل|فتلة|فتله|pcs|pieces|piece|count|ct)(?=[^\p{L}\p{N}]|$)/iu;
  match = text.match(pieceRegex);
  if (match) {
    const count = parseInt(match[1], 10);
    return {
      weight_value: count,
      weight_unit: 'قطعة',
      pack_count: count,
      size_text: `${count} قطعة`
    };
  }

  // Pattern 4: Standalone pack multiplier: "×2", "x2", "2x", "عبوة من 2", "2 pack", "pack of 2"
  const multiplierRegex = /(?:[×x\*]\s*(\d+)|\b(\d+)\s*[×x\*]|\bعبوة\s*من\s*(\d+)|\bpack\s*of\s*(\d+)|\b(\d+)\s*pack\b)/i;
  match = text.match(multiplierRegex);
  if (match) {
    const count = parseInt(match[1] || match[2] || match[3] || match[4] || match[5], 10);
    return {
      weight_value: count,
      weight_unit: 'قطعة',
      pack_count: count,
      size_text: `${count} قطعة`
    };
  }

  return {
    weight_value: null,
    weight_unit: null,
    pack_count: 1,
    size_text: null
  };
}

/**
 * Normalizes unit strings into standard set: 'كجم', 'جم', 'لتر', 'مل', 'قطعة'
 */
function normalizeUnit(unitStr) {
  if (!unitStr) return null;
  const u = unitStr.toLowerCase().trim();

  // Kilograms
  if (['كجم', 'كغ', 'كيلو', 'كيلوجرام', 'كيلوغرام', 'kg', 'kgs', 'kilo', 'kilogram'].includes(u)) {
    return 'كجم';
  }
  // Grams
  if (['جم', 'جرام', 'غرام', 'غ', 'g', 'gm', 'g.', 'grams', 'gram'].includes(u)) {
    return 'جم';
  }
  // Liters
  if (['لتر', 'لترا', 'ليتر', 'l', 'lt', 'ltr', 'liter', 'litre', 'liters'].includes(u)) {
    return 'لتر';
  }
  // Milliliters
  if (['مل', 'ملل', 'مليلتر', 'ميليلتر', 'ml', 'mll'].includes(u)) {
    return 'مل';
  }
  // Pieces / items
  if (['قطعة', 'قطعه', 'قطع', 'حبة', 'حبه', 'حبات', 'رول', 'باكت', 'ظرف', 'كيس', 'pcs', 'pieces', 'piece', 'count', 'ct'].includes(u)) {
    return 'قطعة';
  }

  return u;
}

/**
 * Creates a unique signature for duplicate detection:
 * (title_norm + brand + weight_value + weight_unit)
 */
function createDuplicateKey(item) {
  const titleNorm = item.title_norm || normalizeTitle(item.title);
  const brand = (item.brand || '').toLowerCase().trim();
  const weightVal = item.weight_value !== null && item.weight_value !== undefined ? item.weight_value : '';
  const weightUnit = item.weight_unit || '';
  return `${titleNorm}:::${brand}:::${weightVal}:::${weightUnit}`;
}

module.exports = {
  normalizeTitle,
  extractBrand,
  parseSize,
  normalizeUnit,
  createDuplicateKey,
  BRAND_DICTIONARY
};
