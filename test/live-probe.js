'use strict';
// L1 适配器真实 API 能力探测：逐方法调用，报告 OK/FAIL + 失败原因。
// 用途：明确当前凭据下哪些能力可用（Default 包）/哪些被挡（tracking id、Advanced 包）。
// 用法：node test/live-probe.js
const https = require('https');
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

const ali = require('../src/adapters/aliexpress');

(async () => {
  const rows = [];
  // 1. 类目
  try { const c = await ali.categories({}); rows.push(['categories', 'OK', (Array.isArray(c) ? c.length : '?') + ' 类目']); }
  catch (e) { rows.push(['categories', 'FAIL', e.message.slice(0, 90)]); }

  // 2. 搜索（拿一个真实 goods_id 供后续用）
  let gid = null;
  try {
    const list = await ali.searchGoods('phone case', { pageSize: 3 });
    gid = list[0] && list[0].goods_id;
    rows.push(['searchGoods', 'OK', list.length + ' items, first id=' + gid]);
  } catch (e) { rows.push(['searchGoods', 'FAIL', e.message.slice(0, 90)]); }

  // 3. 详情
  try {
    const d = await ali.goodsDetail(gid || '3256812614823774', {});
    rows.push(['goodsDetail', 'OK', d.length + ' items']);
  } catch (e) { rows.push(['goodsDetail', 'FAIL', e.message.slice(0, 90)]); }

  // 4. 转链（无 tracking_id 试探官方要求）
  try {
    const r = await ali.convertLink('https://www.aliexpress.com/item/' + (gid || '3256812614823774') + '.html', {});
    rows.push(['convertLink(no tracking_id)', 'OK', r.click_url ? r.click_url.slice(0, 50) : JSON.stringify(r).slice(0, 80)]);
  } catch (e) { rows.push(['convertLink(no tracking_id)', 'FAIL', e.message.slice(0, 90)]); }

  // 5. 热销榜（Advanced 包，预期 FAIL）
  try {
    const h = await ali.hotProducts({ pageSize: 3 });
    rows.push(['hotProducts(Advanced)', 'OK', h.length + ' items']);
  } catch (e) { rows.push(['hotProducts(Advanced)', 'FAIL', e.message.slice(0, 90)]); }

  // 6. 订单
  try {
    const end = new Date(), start = new Date(Date.now() - 86400e3);
    const r = await ali.orderDetails({ startTime: start.toISOString(), endTime: end.toISOString() });
    rows.push(['orderDetails', 'OK', 'list=' + (r.list || []).length]);
  } catch (e) { rows.push(['orderDetails', 'FAIL', e.message.slice(0, 90)]); }

  console.log('L1 capability probe (app_key=' + require('../src/config').ALIEXPRESS.APP_KEY + '):');
  for (const [name, st, note] of rows) console.log('  ' + (st === 'OK' ? '✅' : '❌') + ' ' + name.padEnd(28) + st.padEnd(6) + note);
})().catch((e) => { console.error('fatal:', e); process.exit(1); });
