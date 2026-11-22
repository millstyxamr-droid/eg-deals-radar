const fs = require('fs');
const path = require('path');

const b1 = [
  {"asin":"B0HLTJ95BK","category":"Bakery","discount":"10% OFF","flavor":null,"imgSrc":"https://m.media-amazon.com/images/I/41UzjlvS+0L._AC_SL500_.jpg","oldPrice":"EGP 55.00","price":"EGP 49.50","productUrl":"https://www.amazon.eg/dp/B0HLTJ95BK","title":"Domty Chia Tannour Bread"},
  {"asin":"B0FZH6TPCP","category":"Domty","discount":"8% OFF","flavor":null,"imgSrc":"https://m.media-amazon.com/images/I/41lH9V2GI4L._AC_SL500_.jpg","oldPrice":"EGP 82.00","price":"EGP 75.75","productUrl":"https://www.amazon.eg/dp/B0FZH6TPCP","title":"Domty Feta Cheese"},
  {"asin":"B0FZHBVDFJ","category":"Domty","discount":"3% OFF","flavor":null,"imgSrc":"https://m.media-amazon.com/images/I/41lH9V2GI4L._AC_SL500_.jpg","oldPrice":"EGP 41.00","price":"EGP 39.95","productUrl":"https://www.amazon.eg/dp/B0FZHBVDFJ","title":"Domty Feta Cheese"},
  {"asin":"B0GWFKPLBJ","category":"Domty","discount":"10% OFF","flavor":null,"imgSrc":"https://m.media-amazon.com/images/I/31O5Q1Wp-bL._AC_SL500_.jpg","oldPrice":"EGP 110.00","price":"EGP 99.00","productUrl":"https://www.amazon.eg/dp/B0GWFKPLBJ","title":"DomtyGold Qeshta Cheese"},
  {"asin":"B0G1ZD8K1M","category":"Bakery","discount":null,"flavor":"High Protein Chia Seed","imgSrc":"https://m.media-amazon.com/images/I/31P-F1q9YVL._AC_SL500_.jpg","oldPrice":null,"price":"EGP 74.95","productUrl":"https://www.amazon.eg/dp/B0G1ZD8K1M","title":"Domty Protein Toast with Chia Seed - 500g"},
  {"asin":"B0FZHL95MD","category":"Domty","discount":null,"flavor":"Olive","imgSrc":"https://m.media-amazon.com/images/I/41CIUw2syjL._AC_SL500_.jpg","oldPrice":null,"price":"EGP 82.00","productUrl":"https://www.amazon.eg/dp/B0FZHL95MD","title":"Domty Feta Cheese"},
  {"asin":"B0HDJ6FBSL","category":"Bakery","discount":null,"flavor":null,"imgSrc":"https://m.media-amazon.com/images/I/41S-+u5TTbL._AC_SL500_.jpg","oldPrice":null,"price":"EGP 64.95","productUrl":"https://www.amazon.eg/dp/B0HDJ6FBSL","title":"Domty Whole Wheat Toast"},
  {"asin":"B0FZHDMVN2","category":"Domty","discount":null,"flavor":"Olive","imgSrc":"https://m.media-amazon.com/images/I/41CIUw2syjL._AC_SL500_.jpg","oldPrice":null,"price":"EGP 41.00","productUrl":"https://www.amazon.eg/dp/B0FZHDMVN2","title":"Domty Feta Cheese"},
  {"asin":"B0G1ZG4K1J","category":"Bakery","discount":"10% OFF","flavor":"Feta & Edam","imgSrc":"https://m.media-amazon.com/images/I/41sOAHsUf-L._AC_SL500_.jpg","oldPrice":"EGP 15.00","price":"EGP 13.50","productUrl":"https://www.amazon.eg/dp/B0G1ZG4K1J","title":"Domty Feta Cheese Croissant with Edam Flavor - 1 Piece"},
  {"asin":"B0G1ZFPL84","category":"Bakery","discount":"10% OFF","flavor":"Plain","imgSrc":"https://m.media-amazon.com/images/I/31NyqWBIPlL._AC_SL500_.jpg","oldPrice":"EGP 29.95","price":"EGP 27.00","productUrl":"https://www.amazon.eg/dp/B0G1ZFPL84","title":"Domty Fino Bread - 4 Pieces"},
  {"asin":"B0G1ZCRGJF","category":"Bakery","discount":"10% OFF","flavor":"Creamy Cheese","imgSrc":"https://m.media-amazon.com/images/I/31j4vyAVouL._AC_SL500_.jpg","oldPrice":"EGP 15.00","price":"EGP 13.50","productUrl":"https://www.amazon.eg/dp/B0G1ZCRGJF","title":"Creamy Cheese Jumbo Sandwich by Domty - 1 Piece"},
  {"asin":"B07GX5FRKX","category":"Domty","discount":"10% OFF","flavor":null,"imgSrc":"https://m.media-amazon.com/images/I/41sq0PB5hbL._AC_SL500_.jpg","oldPrice":"EGP 51.00","price":"EGP 45.90","productUrl":"https://www.amazon.eg/dp/B07GX5FRKX","title":"Domty Plus Feta Cheese"},
  {"asin":"B0G1ZFM596","category":"Bakery","discount":null,"flavor":"Bran","imgSrc":"https://m.media-amazon.com/images/I/31FIHVVKq4L._AC_SL500_.jpg","oldPrice":null,"price":"EGP 59.95","productUrl":"https://www.amazon.eg/dp/B0G1ZFM596","title":"Domty Bran Toast - 500 gm"},
  {"asin":"B0FZH9LRP2","category":"Domty","discount":"10% OFF","flavor":null,"imgSrc":"https://m.media-amazon.com/images/I/31Rf5cv2JCL._AC_SL500_.jpg","oldPrice":"EGP 110.00","price":"EGP 99.00","productUrl":"https://www.amazon.eg/dp/B0FZH9LRP2","title":"Domty Istanbolly Cheese"},
  {"asin":"B0G1ZF69PN","category":"Bakery","discount":"10% OFF","flavor":"Istanboli Cheese","imgSrc":"https://m.media-amazon.com/images/I/41JBYRvO14L._AC_SL500_.jpg","oldPrice":"EGP 15.00","price":"EGP 13.50","productUrl":"https://www.amazon.eg/dp/B0G1ZF69PN","title":"Domty Croissant with Istanboli Cheese - 1 Piece"},
  {"asin":"B0FZHL7QLQ","category":"Domty","discount":"10% OFF","flavor":null,"imgSrc":"https://m.media-amazon.com/images/I/31ylLxF8x0L._AC_SL500_.jpg","oldPrice":"EGP 110.00","price":"EGP 99.00","productUrl":"https://www.amazon.eg/dp/B0FZHL7QLQ","title":"Domty Feta Cheese"},
  {"asin":"B0FZHFS8G8","category":"Domty","discount":null,"flavor":null,"imgSrc":"https://m.media-amazon.com/images/I/419IxF70g0L._AC_SL500_.jpg","oldPrice":null,"price":"EGP 82.00","productUrl":"https://www.amazon.eg/dp/B0FZHFS8G8","title":"Domty Gold Light Soft Cheese"},
  {"asin":"B0G1ZDPSR4","category":"Bakery","discount":"10% OFF","flavor":"Feta Pastrami","imgSrc":"https://m.media-amazon.com/images/I/416t39cfRgL._AC_SL500_.jpg","oldPrice":"EGP 15.00","price":"EGP 13.50","productUrl":"https://www.amazon.eg/dp/B0G1ZDPSR4","title":"Domty Feta Pastrami Cheese Croissant"},
  {"asin":"B0G1ZBZ24M","category":"Bakery","discount":"10% OFF","flavor":"Chocolate Hazelnut","imgSrc":"https://m.media-amazon.com/images/I/31gQ6TF0JvL._AC_SL500_.jpg","oldPrice":"EGP 15.00","price":"EGP 13.50","productUrl":"https://www.amazon.eg/dp/B0G1ZBZ24M","title":"Domty Jumbo Chocolate with Hazelnut Sandwich - 1 Piece"},
  {"asin":"B0FZHGPQSW","category":"Domty","discount":"10% OFF","flavor":"Pastrami","imgSrc":"https://m.media-amazon.com/images/I/41En5daeXIL._AC_SL500_.jpg","oldPrice":"EGP 51.00","price":"EGP 45.90","productUrl":"https://www.amazon.eg/dp/B0FZHGPQSW","title":"Domty Feta Cheese"},
  {"asin":"B0G1ZC6VNS","category":"Bakery","discount":"10% OFF","flavor":"White Cheese Jalapeno","imgSrc":"https://m.media-amazon.com/images/I/418vfCojpmL._AC_SL500_.jpg","oldPrice":"EGP 15.00","price":"EGP 13.50","productUrl":"https://www.amazon.eg/dp/B0G1ZC6VNS","title":"Domty White Cheese Croissant with Spicy Jalapeno Flavor - 1 Piece"},
  {"asin":"B0FZHHBRCT","category":"Domty","discount":"10% OFF","flavor":"Olive","imgSrc":"https://m.media-amazon.com/images/I/31OyhojYX5L._AC_SL500_.jpg","oldPrice":"EGP 110.00","price":"EGP 99.00","productUrl":"https://www.amazon.eg/dp/B0FZHHBRCT","title":"Domty Feta Cheese"},
  {"asin":"B0CGMRQ38S","category":"Domty","discount":"10% OFF","flavor":null,"imgSrc":"https://m.media-amazon.com/images/I/31Yj9GmbM7L._AC_SL500_.jpg","oldPrice":"EGP 51.00","price":"EGP 45.90","productUrl":"https://www.amazon.eg/dp/B0CGMRQ38S","title":"Domty Istanbuli Plus Cheese"},
  {"asin":"B0FZH9KN3Q","category":"Domty","discount":"10% OFF","flavor":null,"imgSrc":"https://m.media-amazon.com/images/I/41M7tLALfLL._AC_SL500_.jpg","oldPrice":"EGP 79.00","price":"EGP 71.10","productUrl":"https://www.amazon.eg/dp/B0FZH9KN3Q","title":"Domty Creamy Plain Cheese"},
  {"asin":"B0FZHCJRQJ","category":"Domty","discount":"10% OFF","flavor":null,"imgSrc":"https://m.media-amazon.com/images/I/41s1RldreTL._AC_SL500_.jpg","oldPrice":"EGP 79.00","price":"EGP 71.10","productUrl":"https://www.amazon.eg/dp/B0FZHCJRQJ","title":"Domty Light Cream Cheese"},
  {"asin":"B0G1ZC6NYR","category":"Bakery","discount":"10% OFF","flavor":"Feta & Olives","imgSrc":"https://m.media-amazon.com/images/I/41iSYiU12+L._AC_SL500_.jpg","oldPrice":"EGP 15.00","price":"EGP 13.50","productUrl":"https://www.amazon.eg/dp/B0G1ZC6NYR","title":"Feta Plus Olives Cheese Jumbo Sandwich - 1 Piece by Domty"},
  {"asin":"B0G1ZG73GF","category":"Bakery","discount":null,"flavor":"Milk","imgSrc":"https://m.media-amazon.com/images/I/318ONtDcKyL._AC_SL500_.jpg","oldPrice":null,"price":"EGP 60.00","productUrl":"https://www.amazon.eg/dp/B0G1ZG73GF","title":"Domty Milk Toast - 500gm"},
  {"asin":"B0FZH8J55T","category":"Domty","discount":"10% OFF","flavor":"Cheddar","imgSrc":"https://m.media-amazon.com/images/I/41FteHK0ghL._AC_SL500_.jpg","oldPrice":"EGP 133.45","price":"EGP 120.11","productUrl":"https://www.amazon.eg/dp/B0FZH8J55T","title":"Domty Creamy Cheese"},
  {"asin":"B0FZHDYVM7","category":"Domty","discount":"10% OFF","flavor":null,"imgSrc":"https://m.media-amazon.com/images/I/412Lcl3SDKL._AC_SL500_.jpg","oldPrice":"EGP 115.00","price":"EGP 103.50","productUrl":"https://www.amazon.eg/dp/B0FZHDYVM7","title":"Domty Low Salt Cheese"},
  {"asin":"B0FZH6PZBS","category":"Domty","discount":"10% OFF","flavor":null,"imgSrc":"https://m.media-amazon.com/images/I/31UnsLD26rL._AC_SL500_.jpg","oldPrice":"EGP 110.00","price":"EGP 99.00","productUrl":"https://www.amazon.eg/dp/B0FZH6PZBS","title":"Domty Light Feta Cheese"},
  {"asin":"B0FZGY8YQ5","category":"Domty","discount":"10% OFF","flavor":null,"imgSrc":"https://m.media-amazon.com/images/I/318Ah5RBU5L._AC_SL500_.jpg","oldPrice":"EGP 133.45","price":"EGP 120.11","productUrl":"https://www.amazon.eg/dp/B0FZGY8YQ5","title":"Domty Light Cream Cheese"},
  {"asin":"B0FZHK2YJJ","category":"Domty","discount":"10% OFF","flavor":null,"imgSrc":"https://m.media-amazon.com/images/I/414JzQ-yzLL._AC_SL500_.jpg","oldPrice":"EGP 79.00","price":"EGP 71.10","productUrl":"https://www.amazon.eg/dp/B0FZHK2YJJ","title":"Domty Creamy Cheddar Cheese Dip"},
  {"asin":"B0HHN59B69","category":"Domty","discount":null,"flavor":null,"imgSrc":"https://m.media-amazon.com/images/I/41yNh97Z8CL._AC_SL500_.jpg","oldPrice":null,"price":"EGP 91.80","productUrl":"https://www.amazon.eg/dp/B0HHN59B69","title":"Domty Creamy Cheese with Hero Delicia Berry Jam 220g"},
  {"asin":"B0FZHJFPC6","category":"Domty","discount":"10% OFF","flavor":null,"imgSrc":"https://m.media-amazon.com/images/I/31Sq6kIG+dL._AC_SL500_.jpg","oldPrice":"EGP 110.00","price":"EGP 99.00","productUrl":"https://www.amazon.eg/dp/B0FZHJFPC6","title":"Domty Gold Barameli Cheese"},
  {"asin":"B0FZHF1MSJ","category":"Domty","discount":"10% OFF","flavor":null,"imgSrc":"https://m.media-amazon.com/images/I/41K9EhE7wwL._AC_SL500_.jpg","oldPrice":"EGP 28.00","price":"EGP 25.20","productUrl":"https://www.amazon.eg/dp/B0FZHF1MSJ","title":"Domty Light Plus Cheese"},
  {"asin":"B0H63BMBQ3","category":"Domty","discount":null,"flavor":null,"imgSrc":"https://m.media-amazon.com/images/I/413vY5I0dJL._AC_SL500_.jpg","oldPrice":null,"price":"EGP 58.35","productUrl":"https://www.amazon.eg/dp/B0H63BMBQ3","title":"Domty Natural Processed Smoked Cheddar Cheese Sauce 250g"},
  {"asin":"B0HLT681QY","category":"Bakery","discount":null,"flavor":null,"imgSrc":"https://m.media-amazon.com/images/I/41TW+uO3yGL._AC_SL500_.jpg","oldPrice":null,"price":"EGP 33.00","productUrl":"https://www.amazon.eg/dp/B0HLT681QY","title":"Domty Bran Fino Bread – 4 Pieces"},
  {"asin":"B0FZHLFMHQ","category":"Domty","discount":"10% OFF","flavor":"Olive","imgSrc":"https://m.media-amazon.com/images/I/31lBgTnra9L._AC_SL500_.jpg","oldPrice":"EGP 51.00","price":"EGP 45.90","productUrl":"https://www.amazon.eg/dp/B0FZHLFMHQ","title":"Domty Plus Feta Cheese"},
  {"asin":"B0FZHBRZ32","category":"Domty","discount":"10% OFF","flavor":"Olives","imgSrc":"https://m.media-amazon.com/images/I/41gQic30a8L._AC_SL500_.jpg","oldPrice":"EGP 79.00","price":"EGP 71.10","productUrl":"https://www.amazon.eg/dp/B0FZHBRZ32","title":"Domty Creamy Cheese"}
];

const b2 = [
  {"asin":"B0FZHHRGBN","category":"Domty","discount":"10% OFF","flavor":null,"imgSrc":"https://m.media-amazon.com/images/I/41ahe3FlPXL._AC_SL500_.jpg","oldPrice":"EGP 196.00","price":"EGP 176.40","productUrl":"https://www.amazon.eg/dp/B0FZHHRGBN","title":"Domty Low Salt Cheese"},
  {"asin":"B00VQBMPS2","category":"Domty","discount":null,"flavor":null,"imgSrc":"https://m.media-amazon.com/images/I/41sq0PB5hbL._AC_SL500_.jpg","oldPrice":null,"price":"EGP 24.30","productUrl":"https://www.amazon.eg/dp/B00VQBMPS2","title":"Domty Plus Feta Cheese 250 g"},
  {"asin":"B0FZHHCN1Y","category":"Domty","discount":"10% OFF","flavor":null,"imgSrc":"https://m.media-amazon.com/images/I/41gKvx4kwXL._AC_SL500_.jpg","oldPrice":"EGP 51.00","price":"EGP 45.90","productUrl":"https://www.amazon.eg/dp/B0FZHHCN1Y","title":"Domty Roumy Cheese"},
  {"asin":"B0G1ZFDHBL","category":"Bakery","discount":"10% OFF","flavor":"Istanboli Cheese","imgSrc":"https://m.media-amazon.com/images/I/31ktmXs-6TL._AC_SL500_.jpg","oldPrice":"EGP 15.00","price":"EGP 13.50","productUrl":"https://www.amazon.eg/dp/B0G1ZFDHBL","title":"Domty Jumbo Sandwich with Istanboli Cheese - 1 Piece"},
  {"asin":"B0FZH6KF13","category":"Domty","discount":"10% OFF","flavor":"Olives","imgSrc":"https://m.media-amazon.com/images/I/31QF-zACALL._AC_SL500_.jpg","oldPrice":"EGP 14.00","price":"EGP 12.60","productUrl":"https://www.amazon.eg/dp/B0FZH6KF13","title":"Domty Feta Cheese"},
  {"asin":"B0G1ZG23QQ","category":"Bakery","discount":null,"flavor":"Plain","imgSrc":"https://m.media-amazon.com/images/I/31MrEUMQplL._AC_SL500_.jpg","oldPrice":null,"price":"EGP 59.95","productUrl":"https://www.amazon.eg/dp/B0G1ZG23QQ","title":"Domty Plain Toast - 500 gm"},
  {"asin":"B0FZHBNK34","category":"Domty","discount":"10% OFF","flavor":null,"imgSrc":"https://m.media-amazon.com/images/I/41Y3kihPqDL._AC_SL500_.jpg","oldPrice":"EGP 51.00","price":"EGP 45.90","productUrl":"https://www.amazon.eg/dp/B0FZHBNK34","title":"Domty Feta Cheese"},
  {"asin":"B019T5BG5O","category":"Domty","discount":null,"flavor":null,"imgSrc":"https://m.media-amazon.com/images/I/41MRYsr0kBL._AC_SL500_.jpg","oldPrice":null,"price":"EGP 42.30","productUrl":"https://www.amazon.eg/dp/B019T5BG5O","title":"دومتي اوريجينال فيتا 500 جرام"},
  {"asin":"B0FZHL8G2S","category":"Domty","discount":null,"flavor":null,"imgSrc":"https://m.media-amazon.com/images/I/41WX0i1tnYL._AC_SL500_.jpg","oldPrice":null,"price":"EGP 45.90","productUrl":"https://www.amazon.eg/dp/B0FZHL8G2S","title":"Domty Cheddar Cheese"},
  {"asin":"B0H639XT3G","category":"Domty","discount":null,"flavor":null,"imgSrc":"https://m.media-amazon.com/images/I/31NADBsPgIL._AC_SL500_.jpg","oldPrice":null,"price":"EGP 58.35","productUrl":"https://www.amazon.eg/dp/B0H639XT3G","title":"Domty Natural Processed Burger Cheese Sauce 250g"},
  {"asin":"B0CGMPDQVN","category":"Domty","discount":"10% OFF","flavor":null,"imgSrc":"https://m.media-amazon.com/images/I/31QQtdl6arL._AC_SL500_.jpg","oldPrice":"EGP 27.00","price":"EGP 24.30","productUrl":"https://www.amazon.eg/dp/B0CGMPDQVN","title":"Domty Istanbuli Plus Cheese"},
  {"asin":"B0FZHC7C4G","category":"Domty","discount":"10% OFF","flavor":"Pastrami","imgSrc":"https://m.media-amazon.com/images/I/41En5daeXIL._AC_SL500_.jpg","oldPrice":"EGP 27.00","price":"EGP 24.30","productUrl":"https://www.amazon.eg/dp/B0FZHC7C4G","title":"Domty Feta Cheese"},
  {"asin":"B0FZHC646F","category":"Domty","discount":"9% OFF","flavor":null,"imgSrc":"https://m.media-amazon.com/images/I/41FLG7u7aYL._AC_SL500_.jpg","oldPrice":"EGP 14.00","price":"EGP 12.75","productUrl":"https://www.amazon.eg/dp/B0FZHC646F","title":"Domty Feta Cheese"},
  {"asin":"B0FZHF8W9T","category":"Domty","discount":"10% OFF","flavor":null,"imgSrc":"https://m.media-amazon.com/images/I/31OJ-Rch+wL._AC_SL500_.jpg","oldPrice":"EGP 85.00","price":"EGP 76.50","productUrl":"https://www.amazon.eg/dp/B0FZHF8W9T","title":"Domty Cream Cheese"},
  {"asin":"B0FZHDVV7R","category":"Domty","discount":null,"flavor":"Burger","imgSrc":"https://m.media-amazon.com/images/I/31Og1R9roWL._AC_SL500_.jpg","oldPrice":null,"price":"EGP 133.45","productUrl":"https://www.amazon.eg/dp/B0FZHDVV7R","title":"Domty Cream Cheese"},
  {"asin":"B0FZHD4DPX","category":"Domty","discount":"10% OFF","flavor":null,"imgSrc":"https://m.media-amazon.com/images/I/31wQoFJ8OmL._AC_SL500_.jpg","oldPrice":"EGP 27.00","price":"EGP 24.30","productUrl":"https://www.amazon.eg/dp/B0FZHD4DPX","title":"Domty Roumy Cheese"},
  {"asin":"B0G3TVKZJ4","category":"Bakery","discount":"10% OFF","flavor":"Multigrain","imgSrc":"https://m.media-amazon.com/images/I/31b2II4NYrL._AC_SL500_.jpg","oldPrice":"EGP 40.00","price":"EGP 36.00","productUrl":"https://www.amazon.eg/dp/B0G3TVKZJ4","title":"Domty multigrain Fino Bread 4-Pieces"},
  {"asin":"B0FZH8YFYX","category":"Domty","discount":"10% OFF","flavor":"Burger","imgSrc":"https://m.media-amazon.com/images/I/41Lqw9wkzKL._AC_SL500_.jpg","oldPrice":"EGP 79.00","price":"EGP 71.10","productUrl":"https://www.amazon.eg/dp/B0FZH8YFYX","title":"Domty Creamy Cheese"},
  {"asin":"B0FZH9D6S3","category":"Domty","discount":"10% OFF","flavor":null,"imgSrc":"https://m.media-amazon.com/images/I/41Y3kihPqDL._AC_SL500_.jpg","oldPrice":"EGP 27.00","price":"EGP 24.30","productUrl":"https://www.amazon.eg/dp/B0FZH9D6S3","title":"Domty Feta Cheese"},
  {"asin":"B0FZH9293C","category":"Domty","discount":null,"flavor":"Pastrami","imgSrc":"https://m.media-amazon.com/images/I/3126uA5P-YL._AC_SL500_.jpg","oldPrice":null,"price":"EGP 133.45","productUrl":"https://www.amazon.eg/dp/B0FZH9293C","title":"Domty Cream Cheese"},
  {"asin":"B0FZH61Z16","category":"Domty","discount":"10% OFF","flavor":null,"imgSrc":"https://m.media-amazon.com/images/I/41DQzu9oeAL._AC_SL500_.jpg","oldPrice":"EGP 79.00","price":"EGP 71.10","productUrl":"https://www.amazon.eg/dp/B0FZH61Z16","title":"Domty Creamy Roumy Cheese"},
  {"asin":"B0FZHHH3W3","category":"Domty","discount":"10% OFF","flavor":"Jalpeno","imgSrc":"https://m.media-amazon.com/images/I/41NhtCa6DVL._AC_SL500_.jpg","oldPrice":"EGP 79.00","price":"EGP 71.10","productUrl":"https://www.amazon.eg/dp/B0FZHHH3W3","title":"Domty Spread Cream"},
  {"asin":"B0BVSBGGVB","category":"Domty","discount":"10% OFF","flavor":null,"imgSrc":"https://m.media-amazon.com/images/I/31lBgTnra9L._AC_SL500_.jpg","oldPrice":"EGP 27.00","price":"EGP 24.30","productUrl":"https://www.amazon.eg/dp/B0BVSBGGVB","title":"Domty Olives Plus Cheese"},
  {"asin":"B0FZHG6N45","category":"Domty","discount":"10% OFF","flavor":null,"imgSrc":"https://m.media-amazon.com/images/I/41WX0i1tnYL._AC_SL500_.jpg","oldPrice":"EGP 27.00","price":"EGP 24.30","productUrl":"https://www.amazon.eg/dp/B0FZHG6N45","title":"Domty Cheddar Cheese"},
  {"asin":"B0FZHDDY9Z","category":"Domty","discount":"10% OFF","flavor":null,"imgSrc":"https://m.media-amazon.com/images/I/41ptEojdLZL._AC_SL500_.jpg","oldPrice":"EGP 14.00","price":"EGP 12.60","productUrl":"https://www.amazon.eg/dp/B0FZHDDY9Z","title":"Domty Istanbolly Cheese"},
  {"asin":"B0FZHH9JF5","category":"Domty","discount":"10% OFF","flavor":null,"imgSrc":"https://m.media-amazon.com/images/I/41RDpMwXbSL._AC_SL500_.jpg","oldPrice":"EGP 133.45","price":"EGP 120.11","productUrl":"https://www.amazon.eg/dp/B0FZHH9JF5","title":"Domty Creamy Roumy Cheese"},
  {"asin":"B0FZH5FY2C","category":"Domty","discount":"10% OFF","flavor":"Jalapeno","imgSrc":"https://m.media-amazon.com/images/I/41NhtCa6DVL._AC_SL500_.jpg","oldPrice":"EGP 133.45","price":"EGP 120.11","productUrl":"https://www.amazon.eg/dp/B0FZH5FY2C","title":"Domty Creamy Cheese"},
  {"asin":"B0FZHFHSBC","category":"Domty","discount":"10% OFF","flavor":null,"imgSrc":"https://m.media-amazon.com/images/I/41q-PL2nw1L._AC_SL1000_.jpg","oldPrice":"EGP 99.00","price":"EGP 89.10","productUrl":"https://www.amazon.eg/dp/B0FZHFHSBC","title":"Domty Istanbolly Cheese"},
  {"asin":"B0H633KB4C","category":"Domty","discount":null,"flavor":null,"imgSrc":"https://m.media-amazon.com/images/I/31BBosVQGWL._AC_SL500_.jpg","oldPrice":null,"price":"EGP 205.20","productUrl":"https://www.amazon.eg/dp/B0H633KB4C","title":"Domty Natural Processed Chedder Cheese Sauce 900g"},
  {"asin":"B0FZHB2WD5","category":"Domty","discount":null,"flavor":null,"imgSrc":"https://m.media-amazon.com/images/I/41lFjFWjj0L._AC_SL500_.jpg","oldPrice":null,"price":"EGP 89.10","productUrl":"https://www.amazon.eg/dp/B0FZHB2WD5","title":"Domty Feta Cheese"},
  {"asin":"B0FZH93GX3","category":"Domty","discount":null,"flavor":null,"imgSrc":"https://m.media-amazon.com/images/I/41T0+0sD5oL._AC_SL500_.jpg","oldPrice":null,"price":"EGP 133.45","productUrl":"https://www.amazon.eg/dp/B0FZH93GX3","title":"Domty Cream Cheese"},
  {"asin":"B0FZHL7QNL","category":"Domty","discount":"10% OFF","flavor":"Olives","imgSrc":"https://m.media-amazon.com/images/I/41ENEbyjaYL._AC_SL500_.jpg","oldPrice":"EGP 133.45","price":"EGP 120.11","productUrl":"https://www.amazon.eg/dp/B0FZHL7QNL","title":"Domty Creamy Cheese"},
  {"asin":"B0FZHBPY14","category":"Domty","discount":null,"flavor":null,"imgSrc":"https://m.media-amazon.com/images/I/41MV6N9LFJL._AC_SL500_.jpg","oldPrice":null,"price":"EGP 99.00","productUrl":"https://www.amazon.eg/dp/B0FZHBPY14","title":"Domty Roumy Cheese"},
  {"asin":"B0FZHF2RB6","category":"Domty","discount":"10% OFF","flavor":null,"imgSrc":"https://m.media-amazon.com/images/I/31GiAQ3sm4L._AC_SL500_.jpg","oldPrice":"EGP 99.00","price":"EGP 89.10","productUrl":"https://www.amazon.eg/dp/B0FZHF2RB6","title":"Domty Feta Cheese"},
  {"asin":"B0BMXS73Y2","category":"Beverages","discount":null,"flavor":"Lemonade","imgSrc":"https://m.media-amazon.com/images/I/41Jyd+CQYGL._AC_SL1000_.jpg","oldPrice":null,"price":"EGP 328.93","productUrl":"https://www.amazon.eg/dp/B0BMXS73Y2","title":"Domty Blends Juice"},
  {"asin":"B08WJNGCDR","category":"Beverages","discount":null,"flavor":"Strawberry & Banana","imgSrc":"https://m.media-amazon.com/images/I/41dw2hMHa+L._AC_SL500_.jpg","oldPrice":null,"price":"EGP 262.24","productUrl":"https://www.amazon.eg/dp/B08WJNGCDR","title":"Domty Fruit Juice"},
  {"asin":"B08WJLGCXQ","category":"Beverages","discount":null,"flavor":"Kiwi & lemon","imgSrc":"https://m.media-amazon.com/images/I/41koxN0Z1tL._AC_SL500_.jpg","oldPrice":null,"price":"EGP 262.24","productUrl":"https://www.amazon.eg/dp/B08WJLGCXQ","title":"Domty Blends Juice"},
  {"asin":"B08WJMQ4YS","category":"Beverages","discount":null,"flavor":"Orange","imgSrc":"https://m.media-amazon.com/images/I/31EsQv8KNmL._AC_SL500_.jpg","oldPrice":null,"price":"EGP 205.54","productUrl":"https://www.amazon.eg/dp/B08WJMQ4YS","title":"Domty Fruit Juice"}
];

const allDomty = [...b1, ...b2];

// Parse numeric prices helper
function parsePrice(str) {
  if (!str) return null;
  const match = str.match(/[\d,.]+/);
  return match ? parseFloat(match[0].replace(/,/g, '')) : null;
}

const formattedDomty = allDomty.map(item => ({
  asin: item.asin,
  title: item.title,
  currentPrice: item.price,
  currentPriceNum: parsePrice(item.price),
  oldPrice: item.oldPrice,
  oldPriceNum: parsePrice(item.oldPrice),
  currency: 'EGP',
  discount: item.discount,
  category: item.category || 'Domty',
  productUrl: item.productUrl,
  imgSrc: item.imgSrc
}));

// Read existing products
const existingPath = path.join(__dirname, 'products.json');
let existing = [];
if (fs.existsSync(existingPath)) {
  existing = JSON.parse(fs.readFileSync(existingPath, 'utf-8'));
}

// Merge map by ASIN
const map = new Map();
existing.forEach(p => map.set(p.asin, p));
formattedDomty.forEach(p => map.set(p.asin, p));

const merged = Array.from(map.values());
fs.writeFileSync(existingPath, JSON.stringify(merged, null, 2), 'utf-8');
console.log(`[+] Merged dataset: total ${merged.length} products (Domty total in dataset: ${merged.filter(p => p.title.toLowerCase().includes('domty') || p.category === 'Domty').length})`);
