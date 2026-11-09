'use strict';
// 真实 API 联调（node>=16 兼容：用 https 模块做 fetch 兜底，本机 16.13.1 可跑）。
// 用法：node test/live-call.js [关键词]   默认搜 "bluetooth earphones"
const https = require('https');

// node<18 无全局 fetch——polyfill 一个最小 POST 实现（适配器只需要 POST form）
if (typeof AbortSignal?.timeout !== 'function') {
  AbortSignal.timeout = (ms) => { const c = new AbortController(); setTimeout(() => c.abort(), ms); return c.signal; };
}
if (typeof globalThis.fetch !== 'function') {
  globalThis.fetch = (url, opts = {}) => new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: opts.method || 'GET',
      headers: opts.headers || {}
    }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => resolve({ json: () => Promise.resolve(JSON.parse(buf)) }));
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

const config = require('../src/config');
const ali = require('../src/adapters/aliexpress');

(async () => {
  const kw = process.argv[2] || 'bluetooth earphones';
  console.log('MOCK_MODE =', config.MOCK_MODE, ' app_key =', config.ALIEXPRESS.APP_KEY);
  console.log('\n--- categories（最轻量，先验签名/权限）---');
  try {
    const cats = await ali.categories({});
    console.log('categories OK, top-level =', Array.isArray(cats) ? cats.length : Object.keys(cats).slice(0, 5));
  } catch (e) { console.log('categories FAIL:', e.message.slice(0, 200)); }

  console.log('\n--- searchGoods("' + kw + '") ---');
  try {
    const list = await ali.searchGoods(kw, { pageSize: 3 });
    if (list.length) {
      console.log('search OK,', list.length, 'items; first:');
      const g = list[0];
      console.log(' ', JSON.stringify({ id: g.goods_id, title: g.title.slice(0, 60), price: g.price, currency: g.currency, sales: g.sales, commission: g.commission_rate }));
    } else console.log('search OK but empty list');
  } catch (e) { console.log('search FAIL:', e.message.slice(0, 200)); }
})().catch((e) => { console.error('fatal:', e.message); process.exit(1); });
