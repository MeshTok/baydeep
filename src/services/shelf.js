'use strict';
// 统一商品库（本地货架）— L2 核心资产（DESIGN §二.2 海外镜像）：
//   无 key 只读层只查货架（不烧 AliExpress 配额）；sync 任务（jobs.js）把 hot+关键词池结果灌进来。
//   商品协议 = adapters/aliexpress.js normGoods（platform/goods_id/title/price/coupon/sales/…）。
const store = require('../store');

const coll = store.collection('shelf', { items: [], updated_at: null });

function tokenize(q) {
  return String(q || '').toLowerCase().split(/[^a-z0-9\u4e00-\u9fff]+/).filter((t) => t.length > 0);
}

// 相关性打分：标题命中为主、类目/店铺名半权重，销量只做已命中的 tie-break
//（⚠️ tie-break 不能无条件加——销量>0 的项无词命中也会 >0 分，货架搜索将永远过滤不掉任何项）
function scoreItem(item, terms) {
  if (!terms.length) return 0;
  const title = String(item.title || '').toLowerCase();
  const cat = String(item.category_name || '').toLowerCase();
  const shop = String(item.shop_name || '').toLowerCase();
  let s = 0;
  for (const t of terms) {
    if (title.includes(t)) s += 1; else if (cat.includes(t) || shop.includes(t)) s += 0.5;
  }
  if (s <= 0) return 0;
  return s + Math.min((item.sales || 0) / 1e6, 0.1);
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

module.exports = { searchShelf, getItem, upsertItems, stats };
