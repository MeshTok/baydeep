'use strict';
/* Trip.com Partner 适配器（酒店链接级 CPS——Partner 后台激活后启用）
 * 归因：Trip.com 联盟参数 allianceid + sid（从 Affiliate Link 工具生成的链接中提取）
 * 品类：hotel（热门目的地酒店搜索页）——页面本身带价格日历，用户点入即进入带归因的预订流
 * 环境变量：TRIPCOM_ALLIANCE_ID / TRIPCOM_SID（.env 填好后 cron 自动启用）
 * 佣金：酒店最高 7%（月结，$200 起付）
 */
const https = require('node:https');

const ALLIANCE_ID = process.env.TRIPCOM_ALLIANCE_ID || '';
const SID = process.env.TRIPCOM_SID || '';

// 热门目的地（cityId 为 Trip.com 城市 ID，name 用于展示）
const DESTS = [
  ['656303', 'Bangkok'],      ['1', 'Singapore'],     ['649', 'Tokyo'],
  ['528', 'Seoul'],           ['636', 'Hong Kong'],   ['651', 'Taipei'],
  ['204', 'Paris'],           ['242', 'London'],      ['702', 'New York'],
  ['662', 'Los Angeles'],     ['328', 'Dubai'],       ['858', 'Sydney'],
  ['665', 'Kuala Lumpur'],    ['825', 'Bali'],        ['773', 'Istanbul'],
  ['1381', 'Macau'],          ['656305', 'Phuket'],   ['286', 'Rome'],
];

function _httpsJson(url, timeoutMs = 20000) {
  return new Promise((resolve) => {
    const req = https.get(url, { timeout: timeoutMs }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

function attrUrl(base) {
  const joiner = base.includes('?') ? '&' : '?';
  return `${base}${joiner}AllianceID=${ALLIANCE_ID}&SID=${SID}&trip_sub1=leapbest`;
}

/* 酒店目的地卡片：每目的地 1 条（链接到归因后的酒店列表页） */
async function hotelDestinations(opts = {}) {
  if (!ALLIANCE_ID || !SID) return { list: [], errs: ['TRIPCOM_ALLIANCE_ID/SID not configured yet'] };
  const out = [];
  for (const [cityId, name] of DESTS) {
    const base = `https://www.trip.com/hotels/list?city=${cityId}&checkin=&checkout=&crn=1&adult=2&language=en-US&curr=USD`;
    out.push({
      platform: 'tripcom',
      category: 'hotel',
      goods_id: `ht-${cityId}`,
      title: `Hotels in ${name} — compare & book on Trip.com`,
      pict_url: '',
      shop_name: 'Trip.com',
      category_name: 'Hotels',
      price: null,
      currency: 'USD',
      original_price: null,
      discount: null,
      sales: null,
      rating: null,
      commission_rate: null,
      goods_url: attrUrl(base),
      city_id: cityId,
      city_name: name,
    });
  }
  return { list: out, errs: [] };
}

module.exports = { hotelDestinations, attrUrl, DESTS };
