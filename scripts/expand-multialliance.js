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

async function main() {
  const t0 = Date.now();
  const r = await tp.flightPrices({});
  const rr = shelf.upsertItems(r.list);
  console.log(`[tp] flights: +${rr.added} ~${rr.updated} errs=${r.errs.length} total=${rr.total}`);
  if (r.errs.length) console.log('[tp] errors:', r.errs.join(' | ').slice(0, 400));
  const st = shelf.stats();
  console.log(`[tp] DONE in ${((Date.now() - t0) / 1000).toFixed(0)}s SHELF_TOTAL=${st.total}`);
}
main().catch(e => { console.error('[tp] fatal:', e.message); process.exit(1); });
