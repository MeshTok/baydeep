'use strict';
// 统一商品库（本地货架）— L2 核心资产（DESIGN §二.2 海外镜像）：
//   无 key 只读层只查货架（不烧 AliExpress 配额）；sync 任务（jobs.js）把 hot+关键词池结果灌进来。
//   商品协议 = adapters/aliexpress.js normGoods（platform/goods_id/title/price/coupon/sales/…）。
const store = require('../store');

const coll = store.collection('shelf', { items: [], updated_at: null });

function tokenize(q) {
  return String(q || '').toLowerCase().split(/[^a-z0-9\u4e00-\u9fff]+/).filter((t) => t.length > 0);
}

// 相关性打分：标题命中为主、类目/店铺名半权重；多词查询按"词覆盖率"过滤——
// "air fryer" 不再召回只含 "air" 的弱相关（coverage<0.6 直接为 0），销量仅做 tie-break
function scoreItem(item, terms) {
  if (!terms.length) return 0;
  // 词边界匹配：非字母数字统一折叠成空格，避免子串误命中（"air"∩"chair"）
  const norm = (v) => ' ' + String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ') + ' ';
  const title = norm(item.title);
  const cat = norm(item.category_name);
  const shop = norm(item.shop_name);
  let hits = 0, titleHits = 0;
  for (const t of terms) {
    const w = ' ' + t + ' ';
    if (title.includes(w)) { hits += 1; titleHits += 1; }
    else if (cat.includes(w) || shop.includes(w)) hits += 0.5;
  }
  if (hits <= 0) return 0;
  const coverage = hits / terms.length;
  // 标题必须至少全词命中一个词（头名词语义），否则类目/店铺蹭分不放行
  if (coverage < 0.6 || titleHits < 1) return 0;
  return coverage * 2 + Math.min((item.sales || 0) / 1e6, 0.1);
}

function searchShelf(opts = {}) {
  const terms = tokenize(opts.q);
  const priceMin = opts.price_min != null ? Number(opts.price_min) : null;
  const priceMax = opts.price_max != null ? Number(opts.price_max) : null;
  let list = coll.data.items.filter((it) => {
    if (priceMin != null && !(it.price != null && it.price >= priceMin)) return false;
    if (priceMax != null && !(it.price != null && it.price <= priceMax)) return false;
    return true;
  });
  if (terms.length) list = list.map((it) => ({ it, s: scoreItem(it, terms) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).map((x) => x.it);
  const sort = opts.sort || (terms.length ? 'relevance' : 'sales');
  if (sort === 'price') list = list.slice().sort((a, b) => (a.price ?? 1e15) - (b.price ?? 1e15));
  else if (sort === 'sales') list = list.slice().sort((a, b) => (b.sales || 0) - (a.sales || 0));
  else if (sort === 'latest') list = list.slice().sort((a, b) => String(b.stocked_at || '').localeCompare(String(a.stocked_at || '')));
  const page = Math.max(parseInt(opts.page || '1', 10) || 1, 1);
  const pageSize = Math.min(Math.max(parseInt(opts.page_size || '20', 10) || 20, 1), 50);
  return {
    total: list.length,
    page,
    page_size: pageSize,
    items: list.slice((page - 1) * pageSize, page * pageSize)
  };
}

function getItem(goodsId) {
  const id = decodeURIComponent(String(goodsId || ''));
  return coll.data.items.find((it) => it.goods_id === id) || null;
}

// upsert：同 goods_id 覆盖（价格/销量/佣金刷新），seed 项不被真实同步顶掉时保留 stocked_at 首次入库时间
function upsertItems(items, opts = {}) {
  // 防跨进程覆盖：本进程内存快照可能陈旧（别的 cron 刚写入过），写回前以磁盘最新为底
  const fresh = store.reload('shelf');
  if (fresh && Array.isArray(fresh.items)) coll.data.items = fresh.items;
  const byId = new Map(coll.data.items.map((it) => [it.goods_id, it]));
  let added = 0, updated = 0;
  for (const it of items || []) {
    if (!it.goods_id) continue;
    const prev = byId.get(it.goods_id);
    if (prev) {
      byId.set(it.goods_id, { ...prev, ...it, stocked_at: prev.stocked_at });
      updated++;
    } else {
      const row = { platform: 'aliexpress', ...it, stocked_at: new Date().toISOString() };
      byId.set(it.goods_id, row);
      added++;
    }
  }
  let list = [...byId.values()];
  // 容量上限：超限先淘汰 seed 标记外的最旧入库项（货架越长越值钱，但磁盘要兜底）
  const max = require('../config').SHELF_MAX;
  if (list.length > max) {
    list = list.sort((a, b) => String(a.stocked_at || '').localeCompare(String(b.stocked_at || '')));
    const seeds = list.filter((x) => x.seed);
    const rest = list.filter((x) => !x.seed);
    list = seeds.concat(rest.slice(rest.length - max + seeds.length));
  }
  coll.data.items = list;
  coll.data.updated_at = new Date().toISOString();
  store.save('shelf');
  return { added, updated, total: list.length };
}

function stats() {
  return { total: coll.data.items.length, updated_at: coll.data.updated_at };
}

// 平台×品类聚合（MCP catalog_overview 用：让 agent 一眼看清"我们有什么产品类型"）
function overview() {
  const byPlatform = {}, byCat = {};
  for (const it of coll.data.items) {
    const p = it.platform || 'aliexpress';
    byPlatform[p] = (byPlatform[p] || 0) + 1;
    const c = it.category_name || 'Other';
    byCat[c] = (byCat[c] || 0) + 1;
  }
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  return {
    total: coll.data.items.length,
    updated_at: coll.data.updated_at,
    platforms: byPlatform,
    categories_total: cats.length,
    top_categories: cats.slice(0, 30).map(([name, count]) => ({ name, count }))
  };
}

// 机票专用检索（免 key 面：agent 问"PEK 到 SIN 的机票"直接命中，返回的 book_url 已带 Travelpayouts 归因）
function searchFlights(opts = {}) {
  const from = String(opts.origin || '').toUpperCase().trim();
  const to = String(opts.destination || '').toUpperCase().trim();
  const date = String(opts.date || '').trim();
  let list = coll.data.items.filter((x) => x.platform === 'travelpayouts' || (x.category_name || '').toLowerCase() === 'flights');
  if (from) list = list.filter((x) => String(x.origin_airport || '').toUpperCase() === from);
  if (to) list = list.filter((x) => String(x.destination_airport || '').toUpperCase() === to);
  if (date) list = list.filter((x) => String(x.departure_at || '').slice(0, 10) === date);
  list = list.slice().sort((a, b) => (a.price ?? 1e15) - (b.price ?? 1e15));
  const pageSize = Math.min(Math.max(parseInt(opts.page_size || '20', 10) || 20, 1), 50);
  return {
    total: list.length,
    routes_available: [...new Set(list.map((x) => `${x.origin_airport}→${x.destination_airport}`))].slice(0, 40),
    items: list.slice(0, pageSize)
  };
}

module.exports = { searchShelf, getItem, upsertItems, stats, overview, searchFlights };
