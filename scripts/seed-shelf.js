'use strict';
// 货架种子（开发/演示用）：MOCK 模式下给本地货架灌一批假商品，让无 key 只读层可冒烟。
// 真实环境不要跑（货架应以 AliExpress 真实数据为准）；种子项带 seed:true 标记可被识别淘汰。
const shelf = require('../src/services/shelf');

const now = Date.now();
const items = [
  ['1001001', 'Wireless Bluetooth Earphones TWS Noise Cancelling Headphones', 'Electronics', 19.99, 29.99, 35, 8421, 96],
  ['1001002', 'Bluetooth Earphones Sport Waterproof Earbuds with Mic', 'Electronics', 12.5, 24.9, 40, 15230, 95],
  ['1001003', 'Smart Watch Fitness Tracker Heart Rate Blood Pressure', 'Watches', 23.9, 45.0, 12, 6102, 94],
  ['1001004', 'Clear Phone Case for iPhone 15 Shockproof Cover', 'Phone Accessories', 2.35, 5.9, 55, 45201, 97],
  ['1001005', 'LED Strip Light RGB 5m Bluetooth App Control', 'Lights & Lighting', 7.8, 15.6, 30, 22340, 93],
  ['1001006', 'Home Organizer Storage Box Drawer Divider Set', 'Home & Garden', 9.99, 18.8, 15, 3105, 92],
  ['1001007', 'Car Accessories Phone Mount Magnetic Air Vent Holder', 'Car Electronics', 4.5, 9.9, 20, 12870, 95],
  ['1001008', 'Kitchen Gadgets Vegetable Chopper Slicer Multi-Function', 'Kitchen,Dining & Bar', 11.2, 22.4, 18, 7650, 91],
  ['1001009', 'USB C Charger 65W GaN Fast Charging 3-Port', 'Computer & Office', 16.8, 33.5, 10, 5420, 96],
  ['1001010', 'Mini Projector 1080P Portable Home Cinema', 'Consumer Electronics', 45.9, 89.9, 8, 1890, 90],
  ['1001011', 'Pet Supplies Dog Harness Reflective Adjustable', 'Home & Garden', 8.6, 16.9, 22, 9310, 94],
  ['1001012', 'Camping Gear Ultralight Tent 2 Person Waterproof', 'Sports & Entertainment', 39.9, 79.8, 14, 2210, 93]
].map(([id, title, cat, price, orig, comm, sales, rating], i) => ({
  goods_id: id,
  title,
  pict_url: '',
  shop_name: 'SeedStore ' + (i + 1),
  category_name: cat,
  price,
  currency: 'USD',
  original_price: orig,
  discount: Math.round((1 - price / orig) * 100),
  coupon_code: null,
  coupon_amount: null,
  coupon_start_fee: null,
  sales,
  rating,
  commission_rate: comm,
  goods_url: 'https://www.aliexpress.com/item/' + id + '.html',
  shop_url: '',
  video_url: '',
  seed: true
}));

const r = shelf.upsertItems(items);
console.log('[seed] shelf seeded: +' + r.added + ' total=' + r.total);
