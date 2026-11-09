'use strict';
/* 货架批量扩充：大关键词池 × 多页抓取 → upsert 进 data/shelf.json
 * 用法: node scripts/expand-shelf.js [每词页数=2] [起始词序号=0]
 * 特点: 词间/页间延时防限速；单页失败不中断；结束打印增量统计。
 */
const config = require('../src/config');
const shelf = require('../src/services/shelf');
const ali = require('../src/adapters/aliexpress');

const PAGES = parseInt(process.argv[2] || '2', 10) || 2;
const START = parseInt(process.argv[3] || '0', 10) || 0;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// 大关键词池（跨类目， AliExpress 高密度词）
const KEYWORDS = [
  // 3C 电子
  'bluetooth earphones', 'smart watch', 'phone case', 'usb c charger', 'power bank',
  'bluetooth speaker', 'wireless keyboard', 'gaming mouse', 'mechanical keyboard',
  'action camera', 'drone', 'ring light', 'microphone', 'smart bulb', 'led strip',
  'tablet stand', 'laptop sleeve', 'screen protector', 'mini projector', 'fitness tracker',
  // 家居
  'home organizer', 'led light', 'air fryer', 'coffee maker', 'robot vacuum',
  'humidifier', 'air purifier', 'electric toothbrush', 'hair dryer', 'bedding set',
  'throw pillow', 'wall art', 'plant pot', 'storage box', 'laundry basket',
  'shower head', 'blackout curtain', 'area rug', 'scented candle', 'wall mirror',
  // 户外/运动
  'camping gear', 'sleeping bag', 'hiking backpack', 'tent', 'yoga mat',
  'resistance bands', 'dumbbells', 'bicycle accessories', 'swimming goggles', 'tennis racket',
  // 汽配/摩托
  'car accessories', 'dash cam', 'tire inflator', 'car phone mount', 'motorcycle helmet',
  'seat cover', 'led headlight', 'car charger',
  // 宠物
  'pet supplies', 'dog bed', 'cat tree', 'pet carrier', 'dog leash', 'aquarium pump',
  // 时尚/饰品
  'sunglasses', 'backpack', 'handbag', 'watch band', 'jewelry', 'earrings',
  'sneakers', 'baseball cap', 'scarf', 'beanie', 'swimsuit', 'hoodie',
  // 美妆/个护
  'face serum', 'makeup brush', 'nail art', 'wig', 'hair clip', 'lip gloss',
  // 母婴/玩具
  'plush toy', 'rc car', 'puzzle', 'building blocks', 'baby monitor', 'kids drawing',
  // 厨房
  'kitchen gadgets', 'knife sharpener', 'silicone mold', 'spice rack', 'water bottle',
];

async function main() {
  const t0 = Date.now();
  let added = 0, updated = 0, errs = 0, calls = 0;
  const list = KEYWORDS.slice(START);
  console.log(`[expand] keywords=${list.length} pagesPerKeyword=${PAGES}`);
  for (let i = 0; i < list.length; i++) {
    const kw = list[i];
    for (let page = 1; page <= PAGES; page++) {
      try {
        calls++;
        const items = await ali.searchGoods(kw, { page, pageSize: 50 });
        const r = shelf.upsertItems(items);
        added += r.added; updated += r.updated;
        process.stdout.write(`\r[expand] ${i + 1}/${list.length} "${kw}" p${page}: +${r.added} ~${r.updated} 累计新增${added} 库存${r.total}   `);
      } catch (e) {
        errs++;
        console.log(`\n[expand] ERR ${kw} p${page}: ${e.message.slice(0, 100)}`);
        if (errs > 15) { console.log('\n[expand] 错误过多，提前收工'); break; }
      }
      await sleep(350); // 防限速
    }
    await sleep(200);
  }
  const total = (shelf.stats() || {}).total;
  console.log(`\n[expand] DONE in ${((Date.now() - t0) / 1000).toFixed(0)}s calls=${calls} added=${added} updated=${updated} errs=${errs} SHELF_TOTAL=${total}`);
}
main().catch(e => { console.error('[expand] fatal:', e.message); process.exit(1); });
