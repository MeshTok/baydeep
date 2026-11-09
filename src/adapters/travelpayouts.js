'use strict';
/* Travelpayouts 适配器（机票/酒店——多品类货架第二批数据源）
 * API: https://api.travelpayouts.com/aviasales/v3/prices_for_dates（账号 802904 token 已验证）
 * 归因：data API 返回的 search 链接是相对路径 → 拼域名 + marker=账号 ID
 * 货架 schema 对齐：platform=travelpayouts, category=flight
 * 自带 node<18 fetch polyfill（与 aliexpress 同款）
 */
const config = require('../config');

let fetchP = global.fetch;
if (typeof fetchP !== 'function') {
  fetchP = require('node:https');
  fetchP = null; // node16: 走下面的 https 实现
}
const https = require('node:https');
function _httpsJson(url, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: timeoutMs }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('bad json: ' + data.slice(0, 80))); } });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}
async function getJson(url) {
  if (typeof global.fetch === 'function') {
    const res = await fetch(url, { signal: AbortSignal.timeout ? AbortSignal.timeout(20000) : undefined });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }
  return _httpsJson(url);
}

const MARKER = (process.env.TRAVELPAYOUTS_MARKER || config.TRAVELPAYOUTS_MARKER || '802904');
const TOKEN = process.env.TRAVELPAYOUTS_TOKEN || config.TRAVELPAYOUTS_TOKEN || '';
const BASE = 'https://api.travelpayouts.com';
const AVIA_WWW = 'https://www.aviasales.com';

// 归一化：Travelpayouts 航班 → 统一货架 schema
function normFlight(d, ctx) {
  const id = ['fl', ctx.origin, ctx.destination, (d.departure_at || '').slice(0, 10), d.flight_number || 'na'].join('-').replace(/\s+/g, '');
  const dep = (d.departure_at || '').replace('T', ' ').slice(0, 16);
  const rtn = d.return_at ? (d.return_at + '').replace('T', ' ').slice(0, 10) : null;
  const title = [
    `${ctx.origin} → ${ctx.destination}`,
    d.airline ? `· ${d.airline}${d.flight_number ? ' ' + d.flight_number : ''}` : '',
    `· ${dep}`,
    rtn ? `· return ${rtn}` : '· one-way',
    d.transfers === 0 ? '· direct' : (d.transfers != null ? `· ${d.transfers} stop(s)` : '')
  ].join(' ');
  const linkPath = d.link && d.link.startsWith('/') ? d.link : ('/search/' + ctx.origin + (ctx.depart_date || '').replace(/-/g, '').slice(2) + ctx.destination + '1');
  const goodsUrl = AVIA_WWW + linkPath + (linkPath.includes('?') ? '&' : '?') + 'marker=' + MARKER + '.' + ctx.currency;
  return {
    platform: 'travelpayouts',
    category: 'flight',
    goods_id: id,
    title,
    pict_url: '',
    shop_name: d.gate || 'Aviasales',
    category_name: 'Flights',
    price: d.price,
    currency: (ctx.currency || 'usd').toUpperCase(),
    original_price: null,
    discount: null,
    sales: null,
    rating: null,
    commission_rate: null,
    goods_url: goodsUrl,
    origin_airport: d.origin_airport || ctx.origin,
    destination_airport: d.destination_airport || ctx.destination,
    departure_at: d.departure_at,
    return_at: d.return_at || null,
    transfers: d.transfers,
  };
}

// 日期工具： depart_date 默认今天+7，return_date +14
function iso(daysAhead) {
  const d = new Date(Date.now() + daysAhead * 86400e3);
  return d.toISOString().slice(0, 10);
}

/* 机票：按航线列表抓 prices_for_dates（每航线一次调用，返回多条报价） */
async function flightPrices(opts = {}) {
  const routes = opts.routes || [
    // 亚洲内
    ['PEK', 'SIN'], ['SHA', 'NRT'], ['CAN', 'BKK'], ['PVG', 'ICN'],
    ['SIN', 'BKK'], ['HKG', 'TPE'], ['PEK', 'ICN'], ['PVG', 'SIN'],
    ['CAN', 'KUL'], ['HKG', 'BKK'], ['PEK', 'NRT'], ['SHA', 'HKG'],
    ['TPE', 'NRT'], ['KUL', 'SIN'], ['ICN', 'BKK'], ['PVG', 'TPE'],
    // 跨洋（欧/美）
    ['JFK', 'LHR'], ['LAX', 'NRT'], ['FRA', 'PEK'], ['LHR', 'HKG'],
    ['JFK', 'CDG'], ['LAX', 'ICN'], ['SFO', 'NRT'], ['JFK', 'FCO'],
    ['LHR', 'JFK'], ['CDG', 'PVG'], ['FRA', 'HKG'], ['AMS', 'PEK'],
    ['SEA', 'PEK'], ['YYZ', 'PEK'], ['JFK', 'IST'], ['LAX', 'SYD'],
    // 东南亚/大洋洲/中东
    ['PEK', 'DPS'], ['PVG', 'SYD'], ['SIN', 'SYD'], ['BKK', 'DPS'],
    ['DXB', 'BKK'], ['DOH', 'SIN'], ['IST', 'PEK'], ['HKG', 'DPS'],
  ];
  const currency = (opts.currency || 'usd').toLowerCase();
  const depart = opts.depart_date || iso(7);
  const oneWay = opts.one_way !== false;
  const out = [];
  const errs = [];
  for (const [origin, destination] of routes) {
    const u = `${BASE}/aviasales/v3/prices_for_dates?origin=${origin}&destination=${destination}` +
      `&departure_at=${depart}${oneWay ? '&one_way=true' : ''}&currency=${currency}&token=${TOKEN}&limit=8&sorting=price`;
    try {
      const r = await getJson(u);
      const arr = (r && r.data) || [];
      for (const d of arr) out.push(normFlight(d, { origin, destination, currency, depart_date: depart }));
    } catch (e) { errs.push(`${origin}-${destination}: ${e.message.slice(0, 60)}`); }
    await new Promise(r => setTimeout(r, 300));
  }
  return { list: out, errs };
}

/* 酒店：Travelpayouts hotel 数据走 maptt/hotels 静态价（低频）——占位，先返回空
 * （tp 酒店 API 文案常变，待联盟后台确认酒店 API 权限后补全） */
async function hotelPrices() { return { list: [], errs: ['hotel API 待联盟后台开通确认'] }; }

module.exports = { flightPrices, hotelPrices, normFlight, getJson };
