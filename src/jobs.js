'use strict';
// 货架同步任务（独立进程跑：node src/jobs.js；服务器上 cron/pm2 挂）：
//   真实模式下每小时拉 hot 榜 + 关键词池搜索结果 upsert 进本地货架（无 key 只读层的数据面）。
//   MOCK_MODE 或未配 AppKey 时拒绝启动（货架同步必须真实数据）。
const config = require('./config');
const shelf = require('./services/shelf');
const ali = require('./adapters/aliexpress');

async function syncOnce() {
  const t0 = Date.now();
  let collected = [];
  const errs = [];
  // hot 榜 3 页 × 50
  for (const page of [1, 2, 3]) {
    try { collected = collected.concat(await ali.hotProducts({ page, pageSize: 50 })); }
    catch (e) { errs.push('hot p' + page + ': ' + e.message); }
  }
  // 关键词池每词 1 页 × 50（配额友好：词池大小 × 1 次调用/小时）
  for (const kw of config.SYNC_KEYWORDS) {
    try { collected = collected.concat(await ali.searchGoods(kw, { pageSize: 50 })); }
    catch (e) { errs.push(kw + ': ' + e.message); }
  }
  const r = shelf.upsertItems(collected);
  console.log('[jobs] shelf sync: +' + r.added + ' ~' + r.updated + ' total=' + r.total +
    ' in ' + ((Date.now() - t0) / 1000).toFixed(1) + 's' + (errs.length ? ' errs=' + errs.length : ''));
  if (errs.length) console.log('[jobs] errors:', errs.join(' | ').slice(0, 800));
  return r;
}

async function main() {
  if (config.MOCK_MODE) { console.error('[jobs] MOCK_MODE=true — shelf sync needs real API keys (set MOCK_MODE=false + AppKey in .env)'); process.exit(1); }
  if (!config.ALIEXPRESS.APP_KEY || !config.ALIEXPRESS.APP_SECRET) { console.error('[jobs] missing ALIEXPRESS_APP_KEY/APP_SECRET'); process.exit(1); }
  console.log('[jobs] shelf sync every ' + config.SYNC_INTERVAL_MIN + 'min, keywords=' + config.SYNC_KEYWORDS.length);
  await syncOnce();
  setInterval(() => { syncOnce().catch((e) => console.error('[jobs] sync failed:', e.message)); }, config.SYNC_INTERVAL_MIN * 60e3);
}

if (require.main === module) main().catch((e) => { console.error('[jobs] fatal:', e); process.exit(1); });
module.exports = { syncOnce };
