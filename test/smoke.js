'use strict';
// 冒烟测试：MOCK_MODE=true（默认，无 .env）→ 验证各方法出参结构与签名前参数；
// 配好 .env 且 MOCK_MODE=false → 打真实 API（需 node>=18 自带 fetch）。
const config = require('../src/config');
const ali = require('../src/adapters/aliexpress');

(async () => {
  console.log('MOCK_MODE =', config.MOCK_MODE);
  console.log('app_key   =', config.ALIEXPRESS.APP_KEY ? '✓ set' : '✗ missing');
  console.log('tracking  =', config.ALIEXPRESS.TRACKING_ID || '✗ missing');

  console.log('\n--- searchGoods("bluetooth earphones") ---');
  console.log(JSON.stringify(await ali.searchGoods('bluetooth earphones', { pageSize: 20, sort: 'SALE_PRICE_ASC' }), null, 1).slice(0, 600));

  console.log('\n--- hotProducts ---');
  console.log(JSON.stringify(await ali.hotProducts({ pageSize: 10 }), null, 1).slice(0, 300));

  console.log('\n--- goodsDetail([1234567, 7654321]) ---');
  console.log(JSON.stringify(await ali.goodsDetail([1234567, 7654321]), null, 1).slice(0, 300));

  console.log('\n--- convertLink("https://www.aliexpress.com/item/100500123.html") ---');
  console.log(JSON.stringify(await ali.convertLink('https://www.aliexpress.com/item/100500123.html'), null, 1));

  console.log('\n--- orderDetails(last 24h) ---');
  const end = new Date(), start = new Date(Date.now() - 86400e3);
  console.log(JSON.stringify(await ali.orderDetails({ startTime: start.toISOString(), endTime: end.toISOString() }), null, 1));

  console.log('\n✅ smoke done');
})().catch((e) => { console.error('❌', e.message); process.exit(1); });
