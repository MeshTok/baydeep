#!/usr/bin/env node
'use strict';
/* 类目全量遍历采集（照源头淘"全库类目分页"打法）：
 * AliExpress 564 个叶子类目逐个拉商品 → 货架；游标存 data/sync-cursor.json 断点续跑。
 * 每轮处理 BATCH 个类目 × SORTS 个排序视角 × 50 件；cron 每小时一轮 → ~3 天走完全目录，
 * 之后循环刷新（价格/销量/排名同步更新）。货架自然增长到数万件。
 * 用法: node scripts/sync-categories.js [batch=8]
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);
const config = require('../src/config');
const shelf = require('../src/services/shelf');
const ali = require('../src/adapters/aliexpress');

const CURSOR_FILE = path.join(ROOT, 'data', 'sync-cursor.json');
const BATCH = parseInt(process.argv[2] || '8', 10) || 8;
const PAGES = 1; // 每类目每排序 1 页 × 50（配额友好）
const SORTS = ['ORDINAL_DESC', 'SALE_PRICE_ASC']; // 热销 + 低价两个视角（去重靠 upsert）
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function loadCursor() {
  try { return JSON.parse(fs.readFileSync(CURSOR_FILE, 'utf8')); } catch (e) { return { idx: 0 }; }
}
function saveCursor(c) { fs.writeFileSync(CURSOR_FILE, JSON.stringify(c)); }

async function main() {
  const t0 = Date.now();
  const cats = await ali.categories();
  if (!cats.length) throw new Error('category tree empty');
  const cur = loadCursor();
  let added = 0, updated = 0, errs = 0, calls = 0;
  let processed = 0;
  for (let i = 0; i < BATCH; i++) {
    const cat = cats[(cur.idx + i) % cats.length];
    for (const sort of SORTS) {
      try {
        calls++;
        const items = await ali.searchGoods('', { categoryId: cat.category_id, page: PAGES, pageSize: 50, sort });
        const r = shelf.upsertItems(items);
        added += r.added; updated += r.updated;
      } catch (e) {
        errs++;
        console.log(`[cat] ERR ${cat.category_name}(${cat.category_id}) ${sort}: ${e.message.slice(0, 90)}`);
        if (errs > 10) { console.log('[cat] 错误过多，中断本轮'); break; }
      }
      await sleep(350);
    }
    processed++;
    process.stdout.write(`\r[cat] ${i + 1}/${BATCH} "${cat.category_name}(${cat.category_id})" 累计 +${added} ~${updated}   `);
    if (errs > 10) break;
  }
  const nextIdx = (cur.idx + processed) % cats.length;
  saveCursor({ idx: nextIdx });
  const st = shelf.stats();
  console.log(`\n[cat] DONE ${processed} categories in ${((Date.now() - t0) / 1000).toFixed(0)}s calls=${calls} +${added} ~${updated} errs=${errs} cursor=${nextIdx}/${cats.length} SHELF_TOTAL=${st.total}`);
}
main().catch(e => { console.error('[cat] fatal:', e.message); process.exit(1); });
