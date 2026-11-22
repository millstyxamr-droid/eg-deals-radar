const fs = require('fs');
const path = require('path');

const BRAND_ID = 'sAuWWBROaG';
const BASE_URL = 'https://www.amazon.eg';

function makeUrl(nodeId, title) {
  const encTitle = encodeURIComponent(title || '').replace(/%20/g, '+');
  return `${BASE_URL}/tez/browse/explore/category?qcbrand=${BRAND_ID}&nodeId=${nodeId}&title=${encTitle}`;
}

const CATEGORIES_110 = [
  // 1. Dairy, Eggs & Cheese (1-9)
  { id: 'dairy-eggs', parent_id: null, name: 'Dairy, Eggs & Cheese', nodeId: '215052334031', depth: 0 },
  { id: 'dairy-cheese', parent_id: 'dairy-eggs', name: 'Cheese', nodeId: '223598260031', depth: 1 },
  { id: 'dairy-milk', parent_id: 'dairy-eggs', name: 'Milk', nodeId: '223598268031', depth: 1 },
  { id: 'dairy-yogurt', parent_id: 'dairy-eggs', name: 'Yogurt', nodeId: '223598264031', depth: 1 },
  { id: 'dairy-butter', parent_id: 'dairy-eggs', name: 'Butter & Margarine', nodeId: '223598262031', depth: 1 },
  { id: 'dairy-fresh-eggs', parent_id: 'dairy-eggs', name: 'Eggs', nodeId: '223598261031', depth: 1 },
  { id: 'dairy-cream', parent_id: 'dairy-eggs', name: 'Fresh Cream & Labneh', nodeId: '223598263031', depth: 1 },
  { id: 'dairy-condensed', parent_id: 'dairy-eggs', name: 'Condensed & Evaporated Milk', nodeId: '223598265031', depth: 1 },
  { id: 'dairy-plant-milk', parent_id: 'dairy-eggs', name: 'Plant-Based & Almond Milk', nodeId: '223598266031', depth: 1 },

  // 2. Fruits & Vegetables (10-18)
  { id: 'fruits-vegetables', parent_id: null, name: 'Fruits & Vegetables', nodeId: '214841697031', depth: 0 },
  { id: 'vegetables', parent_id: 'fruits-vegetables', name: 'Fresh Vegetables', nodeId: '214899312031', depth: 1 },
  { id: 'fruits', parent_id: 'fruits-vegetables', name: 'Fresh Fruits', nodeId: '214899311031', depth: 1 },
  { id: 'fruits-citrus', parent_id: 'fruits-vegetables', name: 'Citrus & Oranges', nodeId: '214899313031', depth: 1 },
  { id: 'fruits-bananas-apples', parent_id: 'fruits-vegetables', name: 'Apples & Bananas', nodeId: '214899314031', depth: 1 },
  { id: 'vegetables-potatoes-onions', parent_id: 'fruits-vegetables', name: 'Potatoes, Onions & Garlic', nodeId: '214899315031', depth: 1 },
  { id: 'vegetables-tomatoes-cucumbers', parent_id: 'fruits-vegetables', name: 'Tomatoes & Cucumbers', nodeId: '214899317031', depth: 1 },
  { id: 'vegetables-leafy-herbs', parent_id: 'fruits-vegetables', name: 'Fresh Herbs & Leafy Greens', nodeId: '214899318031', depth: 1 },
  { id: 'fruits-organic', parent_id: 'fruits-vegetables', name: 'Organic Fruits & Vegetables', nodeId: '214899321031', depth: 1 },

  // 3. Chicken, Meat & Fish (19-27)
  { id: 'meat-chicken-fish', parent_id: null, name: 'Chicken, Meat & Fish', nodeId: '214841696031', depth: 0 },
  { id: 'meat', parent_id: 'meat-chicken-fish', name: 'Fresh Beef & Meat', nodeId: '214899316031', depth: 1 },
  { id: 'chicken', parent_id: 'meat-chicken-fish', name: 'Fresh Poultry & Chicken', nodeId: '214899320031', depth: 1 },
  { id: 'seafood', parent_id: 'meat-chicken-fish', name: 'Fresh & Frozen Fish & Seafood', nodeId: '214899319031', depth: 1 },
  { id: 'meat-minced', parent_id: 'meat-chicken-fish', name: 'Minced Meat & Cubes', nodeId: '214899322031', depth: 1 },
  { id: 'meat-cold-cuts', parent_id: 'meat-chicken-fish', name: 'Cold Cuts & Deli Pastrami', nodeId: '214899323031', depth: 1 },
  { id: 'meat-sausages-burgers', parent_id: 'meat-chicken-fish', name: 'Sausages, Franks & Burgers', nodeId: '214899324031', depth: 1 },
  { id: 'chicken-fillet-strips', parent_id: 'meat-chicken-fish', name: 'Chicken Breast & Strips', nodeId: '214899325031', depth: 1 },
  { id: 'meat-marinated', parent_id: 'meat-chicken-fish', name: 'Marinated Ready-to-Cook Meat', nodeId: '214899326031', depth: 1 },

  // 4. Bakery & Bread (28-35)
  { id: 'bakery', parent_id: null, name: 'Bakery & Bread', nodeId: '215052333031', depth: 0 },
  { id: 'bread', parent_id: 'bakery', name: 'Bread & Toast', nodeId: '215052339031', depth: 1 },
  { id: 'bakery-baladi-fino', parent_id: 'bakery', name: 'Baladi & Fino Bread', nodeId: '215052335031', depth: 1 },
  { id: 'bakery-croissants-pastries', parent_id: 'bakery', name: 'Croissants, Danish & Pastries', nodeId: '215052336031', depth: 1 },
  { id: 'bakery-cakes-muffins', parent_id: 'bakery', name: 'Cakes, Cupcakes & Muffins', nodeId: '215052337031', depth: 1 },
  { id: 'bakery-rusks-pate', parent_id: 'bakery', name: 'Rusks, Grissini & Crackers', nodeId: '215052338031', depth: 1 },
  { id: 'bakery-tortilla-wraps', parent_id: 'bakery', name: 'Tortilla, Lebanese & Flatbread', nodeId: '215052340031', depth: 1 },
  { id: 'bakery-oriental-sweets', parent_id: 'bakery', name: 'Oriental Sweets & Baklava', nodeId: '215052341031', depth: 1 },

  // 5. Cooking, Baking & Pantry (36-47)
  { id: 'cooking-baking', parent_id: null, name: 'Cooking & Baking', nodeId: '212925568031', depth: 0 },
  { id: 'oil-ghee', parent_id: 'cooking-baking', name: 'Oil & Ghee', nodeId: '215093304031', depth: 1 },
  { id: 'rice-pasta', parent_id: 'cooking-baking', name: 'Rice & Pasta', nodeId: '215093302031', depth: 1 },
  { id: 'spices', parent_id: 'cooking-baking', name: 'Spices & Herbs', nodeId: '215093300031', depth: 1 },
  { id: 'cooking-sauces-tomato', parent_id: 'cooking-baking', name: 'Tomato Paste & Pasta Sauces', nodeId: '215093301031', depth: 1 },
  { id: 'cooking-flour-sugar', parent_id: 'cooking-baking', name: 'Flour, Sugar & Baking Mixes', nodeId: '215093303031', depth: 1 },
  { id: 'cooking-canned-food', parent_id: 'cooking-baking', name: 'Canned Beans, Tuna & Corn', nodeId: '215093305031', depth: 1 },
  { id: 'cooking-vinegar-dressings', parent_id: 'cooking-baking', name: 'Vinegar, Mayo & Salad Dressings', nodeId: '215093306031', depth: 1 },
  { id: 'cooking-legumes-pulses', parent_id: 'cooking-baking', name: 'Lentils, Beans & Pulses', nodeId: '215093307031', depth: 1 },
  { id: 'cooking-stock-bouillon', parent_id: 'cooking-baking', name: 'Bouillon & Soup Mixes', nodeId: '215093308031', depth: 1 },
  { id: 'cooking-salt-seasoning', parent_id: 'cooking-baking', name: 'Salt & Specialized Seasoning', nodeId: '215093309031', depth: 1 },
  { id: 'cooking-noodles', parent_id: 'cooking-baking', name: 'Instant Noodles & Ramen', nodeId: '215093310031', depth: 1 },

  // 6. Beverages & Drinks (48-56)
  { id: 'beverages', parent_id: null, name: 'Water & Beverages', nodeId: '212925566031', depth: 0 },
  { id: 'coffee-tea', parent_id: 'beverages', name: 'Coffee & Tea', nodeId: '212925569031', depth: 1 },
  { id: 'beverages-bottled-water', parent_id: 'beverages', name: 'Bottled Water & Gallons', nodeId: '212925570031', depth: 1 },
  { id: 'beverages-sparkling-water', parent_id: 'beverages', name: 'Sparkling & Flavored Water', nodeId: '212925571031', depth: 1 },
  { id: 'beverages-soft-drinks', parent_id: 'beverages', name: 'Carbonated Soft Drinks & Soda', nodeId: '212925572031', depth: 1 },
  { id: 'beverages-juices', parent_id: 'beverages', name: 'Packaged Juices & Nectars', nodeId: '212925573031', depth: 1 },
  { id: 'beverages-energy-drinks', parent_id: 'beverages', name: 'Energy & Sports Drinks', nodeId: '212925574031', depth: 1 },
  { id: 'beverages-malt-nonalcoholic', parent_id: 'beverages', name: 'Malt Beverages', nodeId: '212925575031', depth: 1 },
  { id: 'beverages-herbal-tea', parent_id: 'beverages', name: 'Herbal & Green Teas', nodeId: '212925576031', depth: 1 },

  // 7. Snacks & Sweets (57-66)
  { id: 'snacks-sweets', parent_id: null, name: 'Snacks & Sweets', nodeId: '215093298031', depth: 0 },
  { id: 'chocolate', parent_id: 'snacks-sweets', name: 'Chocolates & Bars', nodeId: '215093316031', depth: 1 },
  { id: 'chips', parent_id: 'snacks-sweets', name: 'Potato Chips & Pretzels', nodeId: '223316837031', depth: 1 },
  { id: 'snacks-biscuits-cookies', parent_id: 'snacks-sweets', name: 'Biscuits, Wafers & Cookies', nodeId: '215093317031', depth: 1 },
  { id: 'snacks-candy-gum', parent_id: 'snacks-sweets', name: 'Candies, Lollipops & Gum', nodeId: '215093318031', depth: 1 },
  { id: 'snacks-nuts-seeds', parent_id: 'snacks-sweets', name: 'Nuts, Seeds & Trail Mix', nodeId: '215093319031', depth: 1 },
  { id: 'snacks-dried-fruits', parent_id: 'snacks-sweets', name: 'Dried Fruits & Dates', nodeId: '215093320031', depth: 1 },
  { id: 'snacks-popcorn', parent_id: 'snacks-sweets', name: 'Popcorn & Extruded Snacks', nodeId: '215093321031', depth: 1 },
  { id: 'snacks-protein-bars', parent_id: 'snacks-sweets', name: 'Protein & Granola Bars', nodeId: '215093322031', depth: 1 },
  { id: 'snacks-halawa-tahina', parent_id: 'snacks-sweets', name: 'Halawa & Sweet Spreads', nodeId: '215093323031', depth: 1 },

  // 8. Frozen Food (67-73)
  { id: 'frozen-food', parent_id: null, name: 'Frozen Food', nodeId: '212925567031', depth: 0 },
  { id: 'frozen-vegetables', parent_id: 'frozen-food', name: 'Frozen Vegetables & Peas', nodeId: '212925577031', depth: 1 },
  { id: 'frozen-fries-potatoes', parent_id: 'frozen-food', name: 'Frozen French Fries & Wedges', nodeId: '212925578031', depth: 1 },
  { id: 'frozen-ready-meals', parent_id: 'frozen-food', name: 'Frozen Nuggets & Ready Meals', nodeId: '212925579031', depth: 1 },
  { id: 'frozen-pastry-dough', parent_id: 'frozen-food', name: 'Frozen Dough, Sambousek & Pastry', nodeId: '212925580031', depth: 1 },
  { id: 'frozen-ice-cream', parent_id: 'frozen-food', name: 'Ice Cream & Frozen Desserts', nodeId: '212925581031', depth: 1 },
  { id: 'frozen-seafood-items', parent_id: 'frozen-food', name: 'Frozen Fish Fillet & Shrimps', nodeId: '212925582031', depth: 1 },

  // 9. Household & Cleaning (74-84)
  { id: 'household-cleaning', parent_id: null, name: 'Home Care & Cleaning', nodeId: '215103357031', depth: 0 },
  { id: 'laundry', parent_id: 'household-cleaning', name: 'Laundry Detergent & Pods', nodeId: '215103359031', depth: 1 },
  { id: 'cleaning-fabric-softener', parent_id: 'household-cleaning', name: 'Fabric Softener & Scent Boosters', nodeId: '215103360031', depth: 1 },
  { id: 'cleaning-dishwashing', parent_id: 'household-cleaning', name: 'Dishwashing Liquids & Tablets', nodeId: '215103361031', depth: 1 },
  { id: 'cleaning-surface-cleaners', parent_id: 'household-cleaning', name: 'Surface, Floor & Glass Cleaners', nodeId: '215103362031', depth: 1 },
  { id: 'cleaning-bleach-disinfectant', parent_id: 'household-cleaning', name: 'Bleach & Antiseptic Disinfectants', nodeId: '215103363031', depth: 1 },
  { id: 'cleaning-toilet-bathroom', parent_id: 'household-cleaning', name: 'Toilet & Bathroom Cleaners', nodeId: '215103364031', depth: 1 },
  { id: 'cleaning-tissues-paper', parent_id: 'household-cleaning', name: 'Toilet Paper, Facial Tissues & Towels', nodeId: '215103365031', depth: 1 },
  { id: 'cleaning-trash-bags-foil', parent_id: 'household-cleaning', name: 'Trash Bags, Foil & Cling Film', nodeId: '215103366031', depth: 1 },
  { id: 'cleaning-air-fresheners', parent_id: 'household-cleaning', name: 'Air Fresheners & Scent Diffusers', nodeId: '215103367031', depth: 1 },
  { id: 'cleaning-pest-control', parent_id: 'household-cleaning', name: 'Insecticides & Pest Control', nodeId: '215103368031', depth: 1 },

  // 10. Personal Care & Health (85-94)
  { id: 'personal-care', parent_id: null, name: 'Health & Personal Care', nodeId: '215032325031', depth: 0 },
  { id: 'personal-hair-care', parent_id: 'personal-care', name: 'Shampoo & Hair Conditioners', nodeId: '215032326031', depth: 1 },
  { id: 'personal-body-wash-soap', parent_id: 'personal-care', name: 'Body Wash, Shower Gel & Soap', nodeId: '215032327031', depth: 1 },
  { id: 'personal-deodorants', parent_id: 'personal-care', name: 'Deodorants & Body Sprays', nodeId: '215032328031', depth: 1 },
  { id: 'personal-oral-care', parent_id: 'personal-care', name: 'Toothpaste & Toothbrushes', nodeId: '215032329031', depth: 1 },
  { id: 'personal-shaving', parent_id: 'personal-care', name: 'Shaving Razors, Foam & Blades', nodeId: '215032330031', depth: 1 },
  { id: 'personal-feminine-care', parent_id: 'personal-care', name: 'Feminine Pads & Panty Liners', nodeId: '215032331031', depth: 1 },
  { id: 'personal-first-aid', parent_id: 'personal-care', name: 'First Aid, Bandages & Antiseptics', nodeId: '215032332031', depth: 1 },
  { id: 'personal-skin-lotions', parent_id: 'personal-care', name: 'Hand Creams & Body Lotions', nodeId: '215032333031', depth: 1 },
  { id: 'personal-cotton-wipes', parent_id: 'personal-care', name: 'Cotton Buds & Wet Wipes', nodeId: '215032334031', depth: 1 },

  // 11. Beauty (95-99)
  { id: 'beauty', parent_id: null, name: 'Beauty Essentials', nodeId: '215021840031', depth: 0 },
  { id: 'beauty-skin-care', parent_id: 'beauty', name: 'Face Care & Cleansers', nodeId: '215021841031', depth: 1 },
  { id: 'beauty-hair-styling', parent_id: 'beauty', name: 'Hair Oils, Serums & Styling Gels', nodeId: '215021842031', depth: 1 },
  { id: 'beauty-perfumes', parent_id: 'beauty', name: 'Fragrances & Perfumes', nodeId: '215021843031', depth: 1 },
  { id: 'beauty-makeup', parent_id: 'beauty', name: 'Cosmetics & Makeup Tools', nodeId: '215021844031', depth: 1 },

  // 12. Baby Care (100-104)
  { id: 'baby-care', parent_id: null, name: 'Baby Care', nodeId: '215021807031', depth: 0 },
  { id: 'baby-diapers', parent_id: 'baby-care', name: 'Baby Diapers & Pants', nodeId: '215021808031', depth: 1 },
  { id: 'baby-wipes', parent_id: 'baby-care', name: 'Baby Wipes', nodeId: '215021809031', depth: 1 },
  { id: 'baby-food-formula', parent_id: 'baby-care', name: 'Baby Formula & Cereals', nodeId: '215021810031', depth: 1 },
  { id: 'baby-bath-shampoo', parent_id: 'baby-care', name: 'Baby Shampoo, Lotion & Bath', nodeId: '215021811031', depth: 1 },

  // 13. Home & Kitchen (105-106)
  { id: 'home-kitchen', parent_id: null, name: 'Home & Kitchen', nodeId: '215021792031', depth: 0 },
  { id: 'kitchen-storage-tools', parent_id: 'home-kitchen', name: 'Food Storage & Kitchen Utensils', nodeId: '215021793031', depth: 1 },

  // 14. Electronics & Accessories (107-108)
  { id: 'electronics', parent_id: null, name: 'Electronics & Accessories', nodeId: '215078183031', depth: 0 },
  { id: 'electronics-batteries-cables', parent_id: 'electronics', name: 'Batteries, Cables & Chargers', nodeId: '215078184031', depth: 1 },

  // 15. Stationery & Books (109-110)
  { id: 'stationery', parent_id: null, name: 'Stationery & Books', nodeId: '215021827031', depth: 0 },
  { id: 'stationery-pens-notebooks', parent_id: 'stationery', name: 'Pens, Notebooks & Office Supplies', nodeId: '215021828031', depth: 1 }
];

// Enrich with URLs
const formatted = CATEGORIES_110.map(c => ({
  id: c.id,
  parent_id: c.parent_id,
  name: c.name,
  nodeId: c.nodeId,
  url: makeUrl(c.nodeId, c.name),
  depth: c.depth
}));

console.log(`Writing ${formatted.length} categories to categories.json`);
fs.writeFileSync(path.join(__dirname, '..', 'categories.json'), JSON.stringify(formatted, null, 2), 'utf-8');
console.log('Done!');
