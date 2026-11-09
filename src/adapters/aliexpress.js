'use strict';
// AliExpress 联盟适配器 — BayDeep L1 海外主力腿（照抄 agentmall pdd.js 模式）
// 网关 https://api-sg.aliexpress.com/sync；签名=TOP 规则：
//   除 sign 外全部参数按 key ASCII 升序拼 k+v；
//   md5        = MD5(secret + 拼接串 + secret) 十六进制大写
//   hmac-sha256= HMAC(密钥=secret, 消息=拼接串)     十六进制大写
// affiliate 产品包不需要 session token；归因靠 tracking_id（Portals 后台 Tracking ID 页创建）。
// ⚠️ openservice 创建应用后需申请「aliexpress.affiliate」产品包权限，否则权限类报错（AppKey 没权限 ≠ 签名错）。
const crypto = require('crypto');
const config = require('../config');
const { ERR } = require('../util');

// node<18 兜底：fetch / AbortSignal.timeout polyfill（服务器 node>=18 自动用原生，此段不生效）
if (typeof AbortSignal?.timeout !== 'function') {
  AbortSignal.timeout = (ms) => { const c = new AbortController(); setTimeout(() => c.abort(), ms); return c.signal; };
}
if (typeof globalThis.fetch !== 'function') {
  const https = require('https');
  globalThis.fetch = (url, opts = {}) => new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: opts.method || 'GET',
      headers: opts.headers || {}, signal: opts.signal
    }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => resolve({ json: () => Promise.resolve(JSON.parse(buf)), status: res.statusCode }));
    });
    req.on('error', reject);
    if (opts.signal) opts.signal.addEventListener('abort', () => req.destroy(new Error('aborted')));
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

const API_URL = 'https://api-sg.aliexpress.com/sync';

async function call(method, biz = {}) {
  if (config.MOCK_MODE) return { __mock: true, method, biz };
  const app = config.ALIEXPRESS;
  if (!app.APP_KEY || !app.APP_SECRET) throw ERR.UPSTREAM_ERROR('aliexpress app not configured');
  const params = {
    method,
    app_key: app.APP_KEY,
    timestamp: Date.now(),              // api-sg 接受毫秒时间戳；客户端时钟偏差上限 10 分钟
    sign_method: app.SIGN_METHOD,
    format: 'json',
    v: '2.0',
    ...biz
  };
  const flat = Object.keys(params).filter((k) => k !== 'sign').sort().map((k) => k + params[k]).join('');
  params.sign = app.SIGN_METHOD === 'md5'
    ? crypto.createHash('md5').update(app.APP_SECRET + flat + app.APP_SECRET, 'utf8').digest('hex').toUpperCase()
    : crypto.createHmac('sha256', app.APP_SECRET).update(flat, 'utf8').digest('hex').toUpperCase();
  const body = new URLSearchParams();
  for (const k of Object.keys(params).sort()) body.set(k, String(params[k]));
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(15000)
  });
  const j = await res.json();
  if (j.error_code || j.error_msg) {   // 网关层错误（签名/权限/限流）
    throw ERR.UPSTREAM_ERROR(`aliexpress ${method}: ${j.error_code || ''} ${j.error_msg || ''}`.slice(0, 200));
  }
  // affiliate 包统一包在 *_response → resp_result；resp_code 200 才是成功
  const key = Object.keys(j)[0] || '';
  const rr = (j[key] || {}).resp_result;
  if (!rr || (rr.resp_code && rr.resp_code !== 200)) {
    throw ERR.UPSTREAM_ERROR(`aliexpress ${method}: resp_code=${(rr && rr.resp_code) || '?'} ${(rr && rr.resp_msg) || ''}`.slice(0, 200));
  }
  return rr.result || {};
}

// 佣金率/百分比字段形如 "9.00%"，统一成数字
function pct(v) { return v == null || v === '' ? null : parseFloat(String(v).replace('%', '')) || null; }

function normGoods(p) {
  return {
    goods_id: String(p.product_id || ''),
    title: p.product_title || '',
    pict_url: p.product_main_image_url || (p.product_small_image_urls && p.product_small_image_urls[0]) || '',
    shop_name: p.shop_name || '',
    category_name: p.second_level_category_name || p.first_level_category_name || p.category_name || '',
    price: p.target_sale_price != null ? Number(p.target_sale_price) : null,          // 到手价（target_currency 计价）
    currency: p.target_sale_price_currency || null,
    original_price: p.target_original_price != null ? Number(p.target_original_price) : null,
    discount: pct(p.discount),
    coupon_code: p.coupon_code || null,
    coupon_amount: p.coupon_amount != null ? Number(String(p.coupon_amount).replace(/[^0-9.]/g, '')) || null : null,
    coupon_start_fee: p.coupon_start_fee != null ? Number(String(p.coupon_start_fee).replace(/[^0-9.]/g, '')) || null : null,
    sales: p.lastest_volume != null ? parseInt(p.lastest_volume, 10) || null : null,  // 近期成交量
    rating: pct(p.evaluate_rate),                                                      // 好评率%
    commission_rate: pct(p.commission_rate),                                           // 佣金率%（ Portals 等级越高越大）
    goods_url: p.product_detail_url || '',
    shop_url: p.shop_url || '',
    video_url: p.product_video_url || ''
  };
}

// 限流熔断（照抄 pdd.js：触发后 10 分钟内直接跳过，避免扇出时每次都空打）
let _circuitUntil = 0;

// 关键词搜商品（page_size 1-50；sort 可选 SALE_PRICE_ASC/DESC、AVERAGE_RATE_ASC/DESC、ORDINAL_ASC/DESC）
async function searchGoods(keyword, opts = {}) {
  if (Date.now() < _circuitUntil) throw new Error('aliexpress circuit-open (rate-limit cooldown)');
  const app = config.ALIEXPRESS;
  const biz = {
    keywords: String(keyword),
    page: opts.page || 1,
    page_size: Math.min(Math.max(opts.pageSize || 10, 1), 50),
    target_currency: opts.currency || app.TARGET_CURRENCY,
    target_language: opts.language || app.TARGET_LANGUAGE,
    ship_to_country: opts.shipTo || app.SHIP_TO,
    ...(app.TRACKING_ID || opts.trackingId ? { tracking_id: opts.trackingId || app.TRACKING_ID } : {}),
    ...(opts.sort ? { sort: opts.sort } : {}),
    ...(opts.categoryId ? { category_ids: String(opts.categoryId) } : {})
  };
  let r;
  try {
    r = await call('aliexpress.affiliate.product.query', biz);
  } catch (e) {
    if (/429|rate|quota|ISP/i.test(e.message)) _circuitUntil = Date.now() + 10 * 60e3;
    throw e;
  }
  if (r.__mock) return r;   // MOCK_MODE：返回带签名前参数的信封，供 smoke 检查结构
  return (((r || {}).products || {}).product || []).map(normGoods);
}

// 热销榜（不带关键词；按类目可选）
async function hotProducts(opts = {}) {
  const app = config.ALIEXPRESS;
  const r = await call('aliexpress.affiliate.hotproduct.query', {
    page: opts.page || 1,
    page_size: Math.min(Math.max(opts.pageSize || 10, 1), 50),
    target_currency: opts.currency || app.TARGET_CURRENCY,
    target_language: opts.language || app.TARGET_LANGUAGE,
    ship_to_country: opts.shipTo || app.SHIP_TO,
    ...(app.TRACKING_ID || opts.trackingId ? { tracking_id: opts.trackingId || app.TRACKING_ID } : {}),
    ...(opts.categoryId ? { category_ids: String(opts.categoryId) } : {})
  });
  if (r.__mock) return r;   // MOCK_MODE：返回带签名前参数的信封，供 smoke 检查结构
  return (((r || {}).products || {}).product || []).map(normGoods);
}

// 商品详情（批量，官方上限 10 个 id，逗号分隔）
// ⚠️ 2026-11-09 实测：正确方法名是 productdetail.get（product.detail.get 报 InvalidApiPath）
async function goodsDetail(goodsIds, opts = {}) {
  const app = config.ALIEXPRESS;
  const ids = [].concat(goodsIds).map(String).slice(0, 10);
  const r = await call('aliexpress.affiliate.productdetail.get', {
    product_ids: ids.join(','),
    target_currency: opts.currency || app.TARGET_CURRENCY,
    target_language: opts.language || app.TARGET_LANGUAGE,
    ship_to_country: opts.shipTo || app.SHIP_TO,
    country: opts.shipTo || app.SHIP_TO,
    ...(app.TRACKING_ID || opts.trackingId ? { tracking_id: opts.trackingId || app.TRACKING_ID } : {})
  });
  if (r.__mock) return r;   // MOCK_MODE：返回带签名前参数的信封，供 smoke 检查结构
  return (((r || {}).products || {}).product || []).map(normGoods);
}

// 转链：任意 aliexpress.com 商品/店铺/搜索 URL → 带 tracking_id 的联盟链接（单次上限 10 条）
// ⚠️ 2026-11-09 实测：参数名是 source_values（urls 已废弃）；tracking_id 必填（官方强制）——
//    未配 tracking id 时调用会报 MissingParameter，提示先去 Portals 建号并配 ALIEXPRESS_TRACKING_ID
async function convertLink(urls, opts = {}) {
  const app = config.ALIEXPRESS;
  const list = [].concat(urls).map(String).slice(0, 10);
  if (!list.length) throw ERR.INVALID_PARAM('urls required');
  const trackingId = opts.trackingId || app.TRACKING_ID;
  if (!trackingId && !config.MOCK_MODE) throw ERR.UPSTREAM_ERROR('aliexpress tracking_id required: create one at portals.aliexpress.com and set ALIEXPRESS_TRACKING_ID');
  const r = await call('aliexpress.affiliate.link.generate', {
    source_values: list.join(','),
    promotion_link_type: opts.linkType != null ? opts.linkType : 2,   // 2=短链
    tracking_id: trackingId
  });
  if (r.__mock) return r;
  // 2026-11-09 实测响应结构：result.promotion_links.promotion_link = [{promotion_link, source_value}]
  const links = (((r || {}).promotion_links || {}).promotion_link || []).map((l) => ({ click_url: l.promotion_link || '', source: l.source_value || '' }));
  return { links, click_url: (links[0] && links[0].click_url) || '' };
}

// 类目树（建本地类目映射用；结构 catalog: [{ id, name, children: [...] }]）
async function categories(opts = {}) {
  const app = config.ALIEXPRESS;
  const r = await call('aliexpress.affiliate.category.get', {
    ...(app.TRACKING_ID || opts.trackingId ? { tracking_id: opts.trackingId || app.TRACKING_ID } : {})
  });
  if (r.__mock) return r;
  return ((r || {}).categories || {}).category || [];
}

// 订单明细（佣金对账/开发者分成结算数据源）
// ⚠️ 2026-11-09 实测：正确方法名是 order.get（order.query/list.query 均报 InvalidApiPath）；
//    但 start_date/end_date（秒/毫秒/字符串时间均试过）返回 406「input params is empty」——
//    参数名/格式待官方文档核对（推测需 status 等必填或有专属枚举）。有真实订单流量后按 406 提示调参。
// status 透传官方枚举（PENDING/PAID/CLOSED 等）；start/end 兼容 ISO/时间戳
async function orderDetails(opts = {}) {
  const sec = (v) => {
    const s = String(v || '');
    if (/^\d{10}$/.test(s)) return Number(s);
    const t = Date.parse(s.includes('T') || /[+:]/.test(s) ? s : s.replace(' ', 'T') + 'Z');
    return t ? Math.floor(t / 1000) : 0;
  };
  const su = sec(opts.startTime), eu = sec(opts.endTime);
  if (!su || !eu) throw ERR.INVALID_PARAM('startTime & endTime required');
  const r = await call('aliexpress.affiliate.order.get', {
    start_date: su,
    end_date: eu,
    page: opts.page || 1,
    page_size: Math.min(opts.pageSize || 20, 50),
    ...(opts.status ? { status: opts.status } : {})
  });
  if (r.__mock) return r;
  const list = (((r || {}).order_list || {}).order || []).map((o) => ({
    order_no: String(o.order_number || ''),
    goods_id: String(o.product_id || ''),
    item_title: o.product_name || '',
    item_num: o.quantity != null ? parseInt(o.quantity, 10) || null : null,
    pay_price: o.order_amount != null ? Number(String(o.order_amount).replace(/[^0-9.]/g, '')) || null : null,
    commission: o.commission_amount != null ? Number(String(o.commission_amount).replace(/[^0-9.]/g, '')) || null : null,
    status: o.status || null,
    paid_time: o.payment_date || o.order_time || null,
    tracking_id: o.tracking_id || ''
  }));
  return { list, has_more: list.length >= (opts.pageSize || 20) };
}

module.exports = { call, searchGoods, hotProducts, goodsDetail, convertLink, categories, orderDetails, normGoods };
