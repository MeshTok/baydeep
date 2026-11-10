#!/usr/bin/env node
'use strict';
/* 多联盟货架采集：Travelpayouts 机票 → upsert data/shelf.json（与 AliExpress 商品同库分 platform）
 * 用法: node scripts/expand-travelpayouts.js
 * 后续: Admitad(Temu/Shein feeds)/Viator(activities)/Airalo(esim) 审核通过后在此追加采集分支。
 */
const path = require('path');
const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);
const config = require('../src/config');
const shelf = require('../src/services/shelf');
const tp = require('../src/adapters/travelpayouts');
const tc = require('../src/adapters/tripcom');

async function main() {
  const t0 = Date.now();
  const errs = [];
  const r = await tp.flightPrices({});
  const rr = shelf.upsertItems(r.list);
  console.log(`[tp] flights: +${rr.added} ~${rr.updated} errs=${r.errs.length} total=${rr.total}`);
  if (r.errs.length) errs.push(...r.errs);
  // Trip.com 酒店（TRIPCOM_ALLIANCE_ID/SID 配置后自动启用；未配置时 adapters 内部跳过）
  try {
    const tr = await tc.hotelDestinations({});
    if (tr.list.length) {
      const rr2 = shelf.upsertItems(tr.list);
      console.log(`[tripcom] hotels: +${rr2.added} ~${rr2.updated} total=${rr2.total}`);
    } else if (tr.errs.length) {
      console.log('[tripcom] skip: ' + tr.errs[0]);
    }
  } catch (e) { errs.push('tripcom: ' + e.message.slice(0, 60)); }
  if (errs.length) console.log('[errs]', errs.slice(0, 8).join(' | '));
  const st = shelf.stats();
  console.log(`[multi] DONE in ${((Date.now() - t0) / 1000).toFixed(0)}s SHELF_TOTAL=${st.total}`);
}
main().catch(e => { console.error('[tp] fatal:', e.message); process.exit(1); });
