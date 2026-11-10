'use strict';
/* leapbest.com API 服务（零依赖，node>=16）
 *   GET /api/search?q=    货架搜索（复用网关 shelf 服务 = 与 mcp/api.baydeep.com 共用同一份商品数据）
 *                         并把每次搜索落盘 data/searches.ndjson（用户令：搜索历史必须记录）
 *   GET /api/hot          热搜词榜（聚合 searches.ndjson）
 *   GET /go/<goods_id>    购买转链：查缓存→未命中则 AliExpress convertLink(tracking_id=leapbest)→302 s.click
 *                         （归因独立子号 leapbest，与开发者池隔离——照推返「同联盟独立推广位」惯例）
 * 部署: pm2 start src/leapbest-api.js --name leapbest-api (PORT=3790)
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');
const shelf = require('./services/shelf');
const store = require('./store');
const ali = require('./adapters/aliexpress');

const PORT = parseInt(process.env.PORT || '3790', 10);
const DATA = path.join(__dirname, '..', 'data');
const SEARCH_LOG = path.join(DATA, 'searches.ndjson');
const GO_CACHE = path.join(DATA, 'go-cache.json');
const TRACKING_ID = process.env.LEAPBEST_TRACKING_ID || 'leapbest';
const MAX_Q = 120;

let goCache = {};
try { goCache = JSON.parse(fs.readFileSync(GO_CACHE, 'utf8')); } catch (e) {}
let goCacheDirty = false;
setInterval(() => { if (goCacheDirty) { try { fs.writeFileSync(GO_CACHE, JSON.stringify(goCache)); goCacheDirty = false; } catch (e) {} } }, 5000).unref();

function logSearch(q, n, ip) {
  try {
    fs.appendFileSync(SEARCH_LOG, JSON.stringify({ ts: new Date().toISOString(), q, n, ip }) + '\n');
  } catch (e) {}
}
function topSearches(limit = 14) {
  try {
    const raw = fs.readFileSync(SEARCH_LOG, 'utf8').trim().split('\n').slice(-5000);
    const cnt = {};
    for (const line of raw) {
      try { const { q } = JSON.parse(line); if (q) { const k = q.toLowerCase().slice(0, 60); cnt[k] = (cnt[k] || 0) + 1; } } catch (e) {}
    }
    return Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, limit)
      .map(([q, n]) => ({ q, n }));
  } catch (e) { return []; }
}
function ipOf(req) {
  const xff = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xff || req.socket.remoteAddress || '';
}

async function goRedirect(req, res, id) {
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(id)) { res.writeHead(400); return res.end('bad id'); }
  let url = goCache[id];
  if (!url) {
    let it = shelf.getItem(id);
    if (!it || !it.goods_url) {
      // 内存快照可能落后于磁盘（cron 刚入库的新品/机票）：miss 时热重载一次再查
      const fresh = store.reload('shelf');
      if (fresh && Array.isArray(fresh.items)) {
        store.collection('shelf', { items: [], updated_at: null }).data = fresh;
        it = shelf.getItem(id);
      }
    }
    if (!it || !it.goods_url) { res.writeHead(404); return res.end('not found'); }
    if (it.platform === 'travelpayouts' || (it.category_name || '').toLowerCase() === 'flights') {
      // 机票：goods_url 已带 Travelpayouts marker 归因，直接跳 Aviasales
      url = it.goods_url;
      console.log('[go]', id, 'flight →', (url || '').slice(0, 80));
    } else {
      // 干净 URL（goods_url 自带 pdp_npi 参数会让转链接口报错）
      const cleanUrl = `https://www.aliexpress.com/item/${id}.html`;
      try {
        const r = await ali.convertLink([cleanUrl], { trackingId: TRACKING_ID });
        // convertLink 返回 {links:[{click_url,source}], click_url}——对象不是数组！
        url = (r && (r.click_url || (r.links && r.links[0] && r.links[0].click_url))) || cleanUrl;
        console.log('[go]', id, 'tracking=' + TRACKING_ID, '→', (url || '').slice(0, 80));
      } catch (e) {
        console.error('[go-ERR]', id, e.message.slice(0, 150));
        url = it.goods_url;
      }
    }
    goCache[id] = url; goCacheDirty = true;
  }
  res.writeHead(302, { Location: url, 'Cache-Control': 'private, no-store' });
  res.end();
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;
  const ip = ipOf(req);
  try {
    if (p === '/api/search') {
      const q = (u.searchParams.get('q') || '').slice(0, MAX_Q).trim();
      if (!q) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ items: [] })); }
      const r = shelf.searchShelf({ q, page_size: 40 });
      const items = (r && r.items) || r || [];
      logSearch(q, items.length, ip);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ q, total: items.length, items }));
    }
    if (p === '/api/hot') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'max-age=60' });
      return res.end(JSON.stringify({ top: topSearches() }));
    }
    const m = p.match(/^\/go\/([A-Za-z0-9_-]{4,64})$/);
    if (m) return await goRedirect(req, res, m[1]);
    if (p === '/healthz') { res.writeHead(200); return res.end('ok'); }
    res.writeHead(404); res.end();
  } catch (e) {
    try { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: e.message })); } catch (e2) {}
  }
});

if (config.MOCK_MODE) console.error('[leapbest-api] WARN MOCK_MODE=true — /go 转链不可用，仅搜索可用');
server.listen(PORT, '127.0.0.1', () => console.log(`[leapbest-api] listening 127.0.0.1:${PORT} tracking=${TRACKING_ID} shelf=${(shelf.stats() || {}).total}`));
