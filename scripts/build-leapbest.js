'use strict';
/* leapbest.com 静态站生成器 v3（零依赖，对标主流站去 AI 味）
 * 首页: 大类导航条(10 类) + 机票精选横滚条 + Today's Deals 每日轮换 + Best Sellers（无 hero 大卡）
 * 机票页: Skyscanner 式 From/To/Date 筛选栏（客户端筛选 /flights-data.json）+ 紧凑行式航班列表
 * 分类: AliExpress 细分类目 → 10 大类关键词映射
 * 每日轮换: seed=当天日期, 排序 md5(id+seed)（cron 05:00 重建即换血）
 * 用法: node scripts/build-leapbest.js [商品详情页上限=全部]
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const SHELF = path.join(ROOT, 'data', 'shelf.json');
const OUT = path.join(ROOT, 'website', 'leapbest.com-site');
const LIMIT = parseInt(process.argv[2] || '0', 10) || 0;
const PAGE_SIZE = 48;
const MAX_PAGES = 200;

const _raw = JSON.parse(fs.readFileSync(SHELF, 'utf8'));
const allItems = Array.isArray(_raw) ? _raw : _raw.items || [];
const goods = allItems.filter(x => x.platform !== 'travelpayouts' && (x.category_name || '').toLowerCase() !== 'flights');
const flights = allItems.filter(x => x.platform === 'travelpayouts' || (x.category_name || '').toLowerCase() === 'flights');
const list = LIMIT ? goods.slice(0, LIMIT) : goods;

const SEED = new Date().toISOString().slice(0, 10);
const hash = (s) => crypto.createHash('md5').update(s).digest('hex');
const dailyStream = [...list].sort((a, b) => hash(a.goods_id + SEED) < hash(b.goods_id + SEED) ? -1 : 1);
const PAGES_N = Math.min(MAX_PAGES, Math.max(1, Math.ceil(dailyStream.length / PAGE_SIZE)));

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (v, cur) => (cur || 'USD') === 'USD' ? '$' + Number(v).toFixed(2) : Number(v).toFixed(2) + ' ' + (cur || '');

/* ── 大类映射（关键词 → 10 大类，未命中进 Everything Else）── */
const MAJOR_CATS = [
  { slug: 'electronics', name: 'Electronics', icon: '📱', kws: ['phone', 'mobile', 'audio', 'video', 'electronic', 'consumer', 'computer', 'cable', 'charger', 'camera', 'watch', 'headphone', 'earbud', 'bluetooth', 'speaker', 'tab'] },
  { slug: 'home-living', name: 'Home & Living', icon: '🏠', kws: ['home', 'decor', 'textile', 'kitchen', 'dining', 'bar', 'storage', 'organization', 'holder', 'stand', 'furniture', 'bedding', 'light', 'garden', 'bathroom', ' curtain'] },
  { slug: 'fashion', name: 'Fashion & Bags', icon: '👗', kws: ['costume', 'jewelry', 'bag', 'apparel', 'clothing', 'shoes', 'accessorie', 'wig', 'fashion'] },
  { slug: 'sports', name: 'Sports & Outdoors', icon: '⚽', kws: ['sport', 'outdoor', 'tennis', 'fitness', 'camping', 'bicycle', 'bike', 'exercise', 'golf', 'fishing'] },
  { slug: 'toys-hobbies', name: 'Toys & Hobbies', icon: '🎮', kws: ['acg', 'toy', 'hobby', 'game', 'puzzle', 'doll', 'model', 'kids', 'baby', 'child'] },
  { slug: 'beauty-health', name: 'Beauty & Health', icon: '💄', kws: ['beauty', 'health', 'cosmetic', 'makeup', 'skin', 'hair care', 'personal care'] },
  { slug: 'auto-moto', name: 'Auto & Moto', icon: '🚗', kws: ['rv parts', 'auto', 'motorcycle', 'car ', 'vehicle'] },
  { slug: 'pet-supplies', name: 'Pet Supplies', icon: '🐾', kws: ['pet'] },
  { slug: 'tools-diy', name: 'Tools & DIY', icon: '🔧', kws: ['tool', 'hardware', 'diy', 'measurement', 'industrial', 'packaging', 'printing', 'equipment', 'machine'] },
  { slug: 'office-school', name: 'Office & School', icon: '✏️', kws: ['office', 'school', 'stationery', 'pen', 'notebook'] },
];
function majorOf(catName) {
  const c = String(catName || '').toLowerCase();
  for (const m of MAJOR_CATS) if (m.kws.some(k => c.includes(k))) return m;
  return { slug: 'all', name: 'Everything Else', icon: '🛍' };
}
const catMajor = {}; // category_name -> major slug
for (const it of goods) catMajor[it.category_name || 'Other'] = majorOf(it.category_name).slug;

/* ── 机票城市映射（IATA → 城市）── */
const CITY = {
  PEK: 'Beijing', PVG: 'Shanghai', SHA: 'Shanghai', CAN: 'Guangzhou', SZX: 'Shenzhen',
  HKG: 'Hong Kong', TPE: 'Taipei', ICN: 'Seoul', NRT: 'Tokyo', KIX: 'Osaka',
  SIN: 'Singapore', BKK: 'Bangkok', KUL: 'Kuala Lumpur', DPS: 'Bali', MNL: 'Manila',
  SGN: 'Ho Chi Minh', DEL: 'Delhi', DXB: 'Dubai', DOH: 'Doha', IST: 'Istanbul',
  JFK: 'New York', LAX: 'Los Angeles', SFO: 'San Francisco', SEA: 'Seattle', YYZ: 'Toronto',
  LHR: 'London', CDG: 'Paris', FRA: 'Frankfurt', AMS: 'Amsterdam', FCO: 'Rome',
  SYD: 'Sydney', MEL: 'Melbourne', AKL: 'Auckland', HND: 'Tokyo',
};
const cityName = (i) => CITY[i] || i;

/* ── CSS v3（对标主流站：信息密度高、克制配色）── */
const CSS = `
*{margin:0;padding:0;box-sizing:border-box}
body{font:15px/1.55 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#182234;background:#f5f6fa}
a{color:inherit;text-decoration:none}
header{background:#fff;border-bottom:1px solid #e8ebf2;padding:12px 24px;display:flex;align-items:center;gap:22px;position:sticky;top:0;z-index:30}
header .logo{font-weight:800;font-size:21px;letter-spacing:-.4px;color:#0b1b33}
header .logo span{color:#ff5a1f}
header form{flex:1;display:flex;max-width:560px}
header input{flex:1;border:1.5px solid #d9dfea;border-radius:8px 0 0 8px;padding:9px 14px;font-size:14.5px;outline:none;border-right:0}
header input:focus{border-color:#ff5a1f}
header button{border:0;background:#ff5a1f;color:#fff;font-weight:700;padding:9px 20px;border-radius:0 8px 8px 0;cursor:pointer}
header .top-links{display:flex;gap:18px;font-size:13.5px;color:#5a6a86}
nav.channels{background:#0b1b33;display:flex;align-items:center;gap:2px;padding:0 20px;overflow-x:auto}
nav.channels a{color:#c6d2e6;padding:10px 16px;font-size:13.5px;font-weight:600;border-bottom:3px solid transparent;white-space:nowrap}
nav.channels a:hover{color:#fff}
nav.channels a.on{color:#fff;border-bottom-color:#ff5a1f}
nav.channels .soon{margin-left:auto;color:#5f6f8e;font-size:12px;padding:10px 6px;white-space:nowrap}
main{max-width:1280px;margin:0 auto;padding:20px}
/* 分类导航条（京东/Amazon 式，一行图标大类） */
.catbar{display:grid;grid-template-columns:repeat(10,1fr);gap:8px;margin:6px 0 20px}
.catbar a{background:#fff;border:1px solid #e8ebf2;border-radius:10px;padding:12px 6px;display:flex;flex-direction:column;align-items:center;gap:5px;font-size:12.5px;color:#33415c;font-weight:600;transition:.15s}
.catbar a:hover{border-color:#ff5a1f;color:#ff5a1f;box-shadow:0 3px 10px rgba(255,90,31,.12)}
.catbar .ic{font-size:22px}
h2.sec{font-size:18px;margin:22px 0 12px;letter-spacing:-.2px;display:flex;align-items:baseline;gap:10px}
h2.sec small{font-size:12px;color:#8a94a8;font-weight:400}
h2.sec .more{margin-left:auto;font-size:13px;color:#ff5a1f;font-weight:600}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(196px,1fr));gap:12px}
.card{background:#fff;border:1px solid #e8ebf2;border-radius:10px;overflow:hidden;display:flex;flex-direction:column;transition:.15s}
.card:hover{box-shadow:0 5px 16px rgba(16,26,50,.10);transform:translateY(-1px)}
.card img{width:100%;aspect-ratio:1;object-fit:cover;background:#f0f2f8}
.card .in{padding:9px 10px 10px;display:flex;flex-direction:column;gap:5px;flex:1}
.card .t{font-size:13px;line-height:1.4;color:#243;max-height:54px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical}
.card .p{font-size:16px;font-weight:800;color:#ff5a1f}
.card .p s{color:#9aa4b8;font-weight:400;font-size:11.5px;margin-left:5px}
.card .d{display:inline-block;background:#fff1e8;color:#d1440f;font-size:11px;font-weight:700;border-radius:5px;padding:1px 6px;width:fit-content}
.card .r{font-size:11.5px;color:#77839a}
/* 机票横滚条（首页轻露出） */
.fscroll{display:flex;gap:10px;overflow-x:auto;padding-bottom:6px;scroll-snap-type:x mandatory}
.fmini{min-width:236px;background:#fff;border:1px solid #e8ebf2;border-radius:10px;padding:11px 13px;display:flex;flex-direction:column;gap:3px;scroll-snap-align:start}
.fmini .rt{font-size:14px;font-weight:800;color:#0b1b33}
.fmini .rt .arr{color:#ff5a1f}
.fmini .mt{font-size:11.5px;color:#77839a}
.fmini .bt{display:flex;align-items:center;justify-content:space-between;margin-top:3px}
.fmini .pr{font-size:16px;font-weight:800;color:#ff5a1f}
.fmini .bk{background:#0b1b33;color:#fff;font-size:11.5px;font-weight:700;border-radius:6px;padding:5px 10px}
/* 机票页筛选栏（Skyscanner 式） */
.fbar{background:#fff;border:1px solid #e8ebf2;border-radius:12px;padding:14px;display:flex;gap:10px;align-items:end;flex-wrap:wrap;position:sticky;top:56px;z-index:20;box-shadow:0 2px 10px rgba(16,26,50,.06)}
.fbar .fld{display:flex;flex-direction:column;gap:4px}
.fbar label{font-size:11px;font-weight:700;color:#5a6a86;text-transform:uppercase;letter-spacing:.3px}
.fbar select{border:1.5px solid #d9dfea;border-radius:8px;padding:8px 10px;font-size:14px;min-width:170px;outline:none;background:#fff}
.fbar select:focus{border-color:#ff5a1f}
.fbar .swap{border:1.5px solid #d9dfea;background:#fff;border-radius:8px;padding:8px 12px;cursor:pointer;font-size:15px}
.fbar .clr{border:0;background:none;color:#ff5a1f;font-weight:700;font-size:13px;cursor:pointer;padding:8px 6px}
.fbar .cnt{margin-left:auto;font-size:13px;color:#5a6a86}
/* 航班行式列表 */
.flist{display:flex;flex-direction:column;gap:8px;margin-top:14px}
.frow{background:#fff;border:1px solid #e8ebf2;border-radius:10px;padding:13px 16px;display:grid;grid-template-columns:1.3fr 1.6fr 1fr auto;gap:14px;align-items:center}
.frow .rt{font-size:16px;font-weight:800;color:#0b1b33}
.frow .rt small{display:block;font-size:11.5px;color:#77839a;font-weight:400;margin-top:2px}
.frow .dt{font-size:13px;color:#33415c}
.frow .dt b{color:#0b1b33}
.frow .via{font-size:12px;color:#77839a}
.frow .via .tag{display:inline-block;background:#eef7ee;color:#1a7f37;border-radius:5px;padding:1px 7px;font-weight:700;font-size:11px;margin-right:6px}
.frow .via .tag.stops{background:#fff4e5;color:#9a5b00}
.frow .pr{font-size:19px;font-weight:800;color:#ff5a1f;text-align:right}
.frow .bk{background:#ff5a1f;color:#fff;font-weight:700;border-radius:8px;padding:8px 16px;font-size:13px;white-space:nowrap;justify-self:end}
.fempty{background:#fff;border:1px dashed #d9dfea;border-radius:10px;padding:30px;text-align:center;color:#77839a}
/* 分页 */
.pager{display:flex;gap:6px;flex-wrap:wrap;justify-content:center;margin:26px 0 8px}
.pager a,.pager span{min-width:36px;text-align:center;padding:6px 10px;border:1px solid #e8ebf2;background:#fff;border-radius:8px;font-size:13px;color:#445}
.pager a:hover{border-color:#ff5a1f;color:#ff5a1f}
.pager .cur{background:#ff5a1f;border-color:#ff5a1f;color:#fff;font-weight:700}
.pager .gap{border:0;background:none}
.pnote{text-align:center;color:#8a94a8;font-size:12px;margin-bottom:8px}
/* coming soon 徽章行 */
.soonrow{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;margin:26px 0 4px}
.soonrow span{background:#eef1f7;border-radius:999px;padding:5px 14px;font-size:12px;color:#5a6a86}
.pill{display:inline-block;background:#eef1f7;border-radius:999px;padding:3px 10px;font-size:12px;color:#556;margin:0 6px 6px 0}
.pdp{display:grid;grid-template-columns:minmax(280px,440px) 1fr;gap:32px;background:#fff;border:1px solid #e8ebf2;border-radius:12px;padding:26px}
.pdp img{width:100%;border-radius:10px;background:#f0f2f8}
.pdp h1{font-size:20px;line-height:1.45;letter-spacing:-.2px;margin-bottom:14px}
.price{font-size:29px;font-weight:800;color:#ff5a1f}
.price s{font-size:14px;color:#98a2b8;font-weight:400;margin-left:10px}
.save{display:inline-block;background:#fff1e8;color:#d1440f;font-weight:700;border-radius:8px;padding:4px 10px;font-size:12.5px;margin-top:8px}
.meta{margin:14px 0;color:#556;font-size:13.5px;display:grid;gap:5px}
.buybig{display:block;background:#ff5a1f;color:#fff;text-align:center;font-weight:800;font-size:16px;border-radius:10px;padding:13px;margin-top:16px}
.note{color:#77839a;font-size:12px;margin-top:9px}
footer{max-width:1280px;margin:26px auto 0;padding:18px 20px;color:#8a94a8;font-size:12.5px;border-top:1px solid #e8ebf2}
@media(max-width:900px){.catbar{grid-template-columns:repeat(5,1fr)}.frow{grid-template-columns:1fr auto;gap:8px}.frow .dt,.frow .via{grid-column:1}.pdp{grid-template-columns:1fr;padding:14px}}
`;

const FAVICON = `<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%230b1b33'/%3E%3Cpath d='M16 44h32M22 40l12-16 8 10' fill='none' stroke='%23ff5a1f' stroke-width='5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E">`;

function channelsHTML(active) {
  const tabs = [['/', 'Home'], ['/deals/1.html', 'All Deals'], ['/flights.html', '✈ Flights'], ['/ai.html', '🤖 AI 买手']];
  return `<nav class="channels">${tabs.map(([u, t]) => `<a href="${u}"${u === active ? ' class="on"' : ''}>${t}</a>`).join('')}<span class="soon">🔥 Hotels · eSIM · Activities — coming soon</span></nav>`;
}
function headerTopHTML(q) {
  return `<header><a class="logo" href="/">Leap<span>Best</span></a>
<form action="/search.html" role="search"><input name="q" placeholder="Search ${list.length.toLocaleString()}+ deals…" value="${esc(q || '')}" aria-label="Search"><button>Search</button></form>
<div class="top-links"><a href="https://baydeep.com" style="color:#5a6a86">For AI agents ↗</a></div></header>`;
}
const footerHTML = `<footer><p><b>LeapBest</b> — leap to the best price · Part of the Deep family · <a href="https://baydeep.com" style="color:#445">BayDeep</a></p>
<p style="margin-top:5px">Affiliate disclosure: LeapBest earns commissions from qualifying purchases (AliExpress) and flight bookings (Travelpayouts/Aviasales). Deals & fares refresh daily.</p>
<p style="margin-top:5px">© 2026 LeapBest</p></footer>`;

function cardHTML(it) {
  const disc = it.discount ? `<span class="d">-${it.discount}%</span>` : '';
  const rate = it.rating ? `★ ${(it.rating / 20).toFixed(1)}` : '';
  const sold = it.sales ? ` · ${it.sales} sold` : '';
  return `<a class="card" href="/p/${esc(it.goods_id)}.html">
<img loading="lazy" src="${esc(it.pict_url)}" alt="${esc(it.title).slice(0, 80)}">
<div class="in"><div class="t">${esc(it.title)}</div>
<div class="p">${money(it.price, it.currency)}${it.original_price ? `<s>${money(it.original_price, it.currency)}</s>` : ''}</div>
${disc}<div class="r">${rate}${sold}</div></div></a>`;
}

function fminiHTML(f) {
  const dep = (f.departure_at || '').replace('T', ' ').slice(0, 16);
  const stops = f.transfers === 0 ? 'Direct' : (f.transfers != null ? `${f.transfers} stop` : '');
  return `<a class="fmini" href="/go/${esc(f.goods_id)}" rel="nofollow sponsored">
<div class="rt">${cityName(f.origin_airport)} <span class="arr">→</span> ${cityName(f.destination_airport)}</div>
<div class="mt">${esc(dep)} · ${stops}${f.shop_name ? ' · ' + esc(f.shop_name) : ''}</div>
<div class="bt"><span class="pr">${money(f.price, f.currency)}</span><span class="bk">Book ›</span></div></a>`;
}

function catbarHTML() {
  const counts = {};
  for (const it of goods) { const m = catMajor[it.category_name || 'Other']; counts[m] = (counts[m] || 0) + 1; }
  return `<div class="catbar">${MAJOR_CATS.map(m => `<a href="/search.html?q=${encodeURIComponent(m.name)}"><span class="ic">${m.icon}</span>${m.name}<span style="color:#9aa4b8;font-weight:400">${counts[m.slug] || 0}</span></a>`).join('')}</div>`;
}

function pagerHTML(cur) {
  const base = (i) => i === 1 ? '/deals/1.html' : `/deals/${i}.html`;
  const parts = [];
  if (cur > 1) parts.push(`<a href="${base(cur - 1)}">‹ Prev</a>`);
  const win = new Set([1, PAGES_N, cur, cur - 1, cur + 1, cur - 2, cur + 2]);
  let last = 0;
  for (let i = 1; i <= PAGES_N; i++) {
    if (win.has(i) || i <= 2 || i > PAGES_N - 2) {
      if (last && i - last > 1) parts.push(`<span class="gap">…</span>`);
      parts.push(i === cur ? `<span class="cur">${i}</span>` : `<a href="${base(i)}">${i}</a>`);
      last = i;
    }
  }
  if (cur < PAGES_N) parts.push(`<a href="${base(cur + 1)}">Next ›</a>`);
  return `<div class="pager">${parts.join('')}</div><p class="pnote">Page ${cur} of ${PAGES_N} · picks rotate daily</p>`;
}

function pdpHTML(it) {
  const cur = it.currency || 'USD';
  const save = it.original_price && it.original_price > it.price ? Math.round((1 - it.price / it.original_price) * 100) : 0;
  const jsonld = {
    '@context': 'https://schema.org', '@type': 'Product',
    name: it.title, image: [it.pict_url], description: it.title,
    brand: { '@type': 'Brand', name: it.shop_name || 'AliExpress' },
    offers: { '@type': 'Offer', price: it.price, priceCurrency: cur, availability: 'https://schema.org/InStock', url: `https://leapbest.com/p/${it.goods_id}.html` },
  };
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(it.title).slice(0, 60)} — ${money(it.price, cur)} | LeapBest</title>
<meta name="description" content="${esc(it.title).slice(0, 150)}. ${money(it.price, cur)}${save ? ` (${save}% off)` : ''} — ships to 200+ countries via AliExpress.">
<link rel="canonical" href="https://leapbest.com/p/${esc(it.goods_id)}.html">${FAVICON}
<script type="application/ld+json">${JSON.stringify(jsonld)}</script><style>${CSS}</style></head><body>
${headerTopHTML(it.title.slice(0, 36))}${channelsHTML('/deals/1.html')}<main>
<p style="margin-bottom:12px"><a href="/deals/1.html" style="color:#77839a">‹ All deals</a> <span class="pill">${esc(it.category_name || 'Deals')}</span>${it.shop_name ? `<span class="pill">${esc(it.shop_name)}</span>` : ''}</p>
<div class="pdp"><div><img src="${esc(it.pict_url)}" alt="${esc(it.title).slice(0, 80)}"></div>
<div><h1>${esc(it.title)}</h1>
<div class="price">${money(it.price, cur)}${it.original_price ? `<s>${money(it.original_price, cur)}</s>` : ''}</div>
${save ? `<span class="save">Save ${save}% today</span>` : ''}
<div class="meta">${it.rating ? `<span>Rating: ★ ${(it.rating / 20).toFixed(1)} / 5</span>` : ''}${it.sales ? `<span>${it.sales} sold</span>` : ''}<span>Ships to 200+ countries · buyer protection via AliExpress</span></div>
<a class="buybig" href="/go/${esc(it.goods_id)}" rel="nofollow sponsored">Buy on AliExpress ›</a>
<p class="note">You'll checkout on AliExpress (secure). LeapBest may earn a commission.</p>
</div></div>
<h2 class="sec">More in ${esc(it.category_name || 'this category')}</h2><div class="grid">${(it._related || []).map(cardHTML).join('')}</div>
</main>${footerHTML}</body></html>`;
}

function dealsPageHTML(page) {
  const slice = dailyStream.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const url = `https://leapbest.com/deals/${page}.html`;
  const prevNext = [];
  if (page > 1) prevNext.push(`<link rel="prev" href="https://leapbest.com/deals/${page - 1}.html">`);
  if (page < PAGES_N) prevNext.push(`<link rel="next" href="https://leapbest.com/deals/${page + 1}.html">`);
  const topFares = [...flights].sort((a, b) => (a.price ?? 1e15) - (b.price ?? 1e15)).slice(0, 8);
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>All Deals — Page ${page} of ${PAGES_N} | LeapBest</title>
<meta name="description" content="Browse ${list.length.toLocaleString()}+ AliExpress deals, page ${page}. Fresh picks daily — ships to 200+ countries.">
<link rel="canonical" href="${url}">${prevNext.join('')}${FAVICON}<style>${CSS}</style></head><body>
${headerTopHTML('')}${channelsHTML('/deals/1.html')}<main>
${catbarHTML()}
<h2 class="sec">🛍 All deals <small>daily rotation · ${SEED}</small></h2>
<div class="grid">${slice.map(cardHTML).join('')}</div>
${pagerHTML(page)}
</main>${footerHTML}</body></html>`;
}

function indexHTML() {
  const todays = dailyStream.slice(0, 40);
  const bestSellers = [...goods].sort((a, b) => (b.sales || 0) - (a.sales || 0)).slice(0, 20);
  const topFares = [...flights].sort((a, b) => (a.price ?? 1e15) - (b.price ?? 1e15)).slice(0, 8);
  const aiCard = `
<div class="aicard">
<div class="aihead"><span class="aiic">🤖</span><div><b>AI Shopper</b><div style="font-size:12px;color:#77839a">compare · check price · decide for you</div></div><a class="aigo" href="/ai.html">Open chat ›</a></div>
<a class="aiq" href="/ai.html?q=air%20fryer%20deals">What air fryer deals are there?</a>
<a class="aiq" href="/ai.html?q=flights%20to%20Bangkok">Flights to Bangkok this month?</a>
<a class="aiq" href="/ai.html?q=iphone%20case%20under%20%243">iPhone case under $3?</a>
</div>`;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>LeapBest — Leap to the best price | AliExpress deals up to 90% off</title>
<meta name="description" content="Live deals across ${list.length.toLocaleString()}+ products from AliExpress plus flight fares — fresh picks daily. Ships to 200+ countries.">
${FAVICON}<link rel="canonical" href="https://leapbest.com/">
<style>${CSS}
.aicard{background:#0b1b33;color:#fff;border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:8px}
.aicard .aihead{display:flex;align-items:center;gap:10px}
.aicard .aiic{font-size:26px}
.aicard b{font-size:15px}
.aicard .aigo{margin-left:auto;background:#ff5a1f;color:#fff;font-size:12px;font-weight:700;border-radius:7px;padding:6px 12px;white-space:nowrap}
.aicard .aiq{background:rgba(255,255,255,.08);border-radius:8px;padding:8px 11px;font-size:12.5px;color:#dbe6f5}
.aicard .aiq:hover{background:rgba(255,255,255,.16)}
.split{display:grid;grid-template-columns:1fr 300px;gap:18px;align-items:start}
@media(max-width:980px){.split{grid-template-columns:1fr}}
</style></head><body>${headerTopHTML('')}${channelsHTML('/')}<main>
${catbarHTML()}
<h2 class="sec">✈ Flight deals <small>refreshed daily · via Aviasales</small><a class="more" href="/flights.html">All flights ›</a></h2>
<div class="fscroll">${topFares.map(fminiHTML).join('')}</div>
<div class="split">
  <div>
    <h2 class="sec">🔥 Today's deals <small>rotated daily</small><a class="more" href="/deals/2.html">Next page ›</a></h2>
    <div class="grid">${todays.map(cardHTML).join('')}</div>
    <div class="pager"><a href="/deals/1.html">Browse all ${PAGES_N} pages ›</a></div>
    <h2 class="sec">⭐ Best sellers</h2><div class="grid">${bestSellers.map(cardHTML).join('')}</div>
  </div>
  <aside>${aiCard}</aside>
</div>
<div class="soonrow"><span>🛏 Hotels — soon</span><span>📶 eSIM data — soon</span><span>🎟 Activities — soon</span><span>🛒 Temu &amp; Shein — soon</span></div>
</main>${footerHTML}</body></html>`;
}

function flightsHTML() {
  const origins = [...new Set(flights.map(f => f.origin_airport))].filter(Boolean).sort();
  const dests = [...new Set(flights.map(f => f.destination_airport))].filter(Boolean).sort();
  const dates = [...new Set(flights.map(f => (f.departure_at || '').slice(0, 10)))].filter(Boolean).sort();
  const opt = (arr) => `<option value="">Any</option>` + arr.map(v => `<option value="${esc(v)}">${cityName(v)} (${esc(v)})</option>`).join('');
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Flights — compare fares from Beijing, Shanghai, Guangzhou, NYC, London | LeapBest</title>
<meta name="description" content="Live flight fares via Aviasales partners: ${flights.length} fares across ${origins.length} departure cities. Filter by city and date, book in one leap.">
${FAVICON}<link rel="canonical" href="https://leapbest.com/flights.html"><style>${CSS}</style></head><body>
${headerTopHTML('')}${channelsHTML('/flights.html')}<main>
<h2 class="sec">✈ Flight deals <small>${flights.length} live fares · refreshed daily</small></h2>
<div class="fbar">
<div class="fld"><label>From</label><select id="fo">${opt(origins)}</select></div>
<button class="swap" id="swap" title="Swap">⇄</button>
<div class="fld"><label>To</label><select id="ft">${opt(dests)}</select></div>
<div class="fld"><label>Departure</label><select id="fd">${opt(dates)}</select></div>
<button class="clr" id="clr">Clear</button>
<span class="cnt" id="cnt"></span>
</div>
<div class="flist" id="flist"></div>
<div id="fempty" class="fempty" style="display:none">No fares match this route yet — try Clear, or check back tomorrow (fares refresh daily).</div>
<script>
const DATA = ${JSON.stringify(flights.map(f => ({ id: f.goods_id, o: f.origin_airport, d: f.destination_airport, dep: (f.departure_at || '').slice(0, 16), stops: f.transfers, via: f.shop_name || '', price: f.price, url: '/go/' + f.goods_id })))};
const CITY = ${JSON.stringify(CITY)};
const $ = id => document.getElementById(id);
const cn = i => CITY[i] || i;
const esc = s => String(s == null ? '' : s);
function render() {
  const fo = $('fo').value, ft = $('ft').value, fd = $('fd').value;
  let list = DATA.filter(f => (!fo || f.o === fo) && (!ft || f.d === ft) && (!fd || f.dep.slice(0, 10) === fd));
  list.sort((a, b) => a.price - b.price);
  $('cnt').textContent = list.length + ' fare' + (list.length === 1 ? '' : 's');
  $('fempty').style.display = list.length ? 'none' : 'block';
  $('flist').innerHTML = list.map(f => {
    const stops = f.stops === 0 ? '<span class="tag">Direct</span>' : (f.stops != null ? '<span class="tag stops">' + f.stops + ' stop' + (f.stops > 1 ? 's' : '') + '</span>' : '');
    return '<div class="frow"><div class="rt">' + cn(f.o) + ' → ' + cn(f.d) + '<small>' + f.o + ' → ' + f.d + '</small></div>' +
      '<div class="dt"><b>' + esc(f.dep) + '</b></div>' +
      '<div class="via">' + stops + (f.via ? ' via ' + esc(f.via) : '') + '</div>' +
      '<div><div class="pr">$' + Number(f.price).toFixed(2) + '</div><a class="bk" href="' + f.url + '" rel="nofollow sponsored">Book ›</a></div></div>';
  }).join('');
}
$('fo').onchange = render; $('ft').onchange = render; $('fd').onchange = render;
$('clr').onclick = () => { $('fo').value = ''; $('ft').value = ''; $('fd').value = ''; render(); };
$('swap').onclick = () => { const t = $('fo').value; $('fo').value = $('ft').value; $('ft').value = t; render(); };
const qp = new URLSearchParams(location.search);
if (qp.get('from')) $('fo').value = qp.get('from');
if (qp.get('to')) $('ft').value = qp.get('to');
if (qp.get('date')) $('fd').value = qp.get('date');
render();
</script>
</main>${footerHTML}</body></html>`;
}

function searchHTML() {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Search — LeapBest</title>${FAVICON}<style>${CSS}</style></head><body>${headerTopHTML('')}${channelsHTML('/deals/1.html')}<main>
<div id="trend"></div><h2 class="sec" id="rh">Results</h2><div class="grid" id="g"></div></main>${footerHTML}
<script>
const q=new URLSearchParams(location.search).get('q')||'';
document.querySelector('input[name=q]').value=q;
const E=s=>String(s==null?'':s).replace(/[<>&"]/g,'');
if(q){document.getElementById('rh').textContent='Results for "'+E(q)+'"';
fetch('/api/search?q='+encodeURIComponent(q)).then(r=>r.json()).then(d=>{
  document.getElementById('g').innerHTML=(d.items||[]).map(i=>'<a class="card" href="/p/'+E(i.goods_id)+'.html"><img loading="lazy" src="'+E(i.pict_url)+'"><div class="in"><div class="t">'+E(i.title)+'</div><div class="p">$'+Number(i.price).toFixed(2)+(i.original_price?'<s>$'+Number(i.original_price).toFixed(2)+'</s>':'')+'</div>'+(i.discount?'<span class="d">-'+i.discount+'%</span>':'')+'</div></a>').join('')||'<p style="color:#77839a">No results — try another keyword.</p>';
}).catch(()=>{document.getElementById('g').innerHTML='<p style="color:#77839a">Search temporarily unavailable.</p>'});}
fetch('/api/hot').then(r=>r.json()).then(d=>{const t=d.top||[];if(t.length)document.getElementById('trend').innerHTML='<h2 class="sec">🔥 Trending searches</h2><div class="chips">'+t.map(x=>'<a href="/search.html?q='+encodeURIComponent(x.q)+'">'+E(x.q)+' <b style="color:#9aa">'+x.n+'</b></a>').join('')+'</div>';}).catch(()=>{});
</script></body></html>`;
}

/* AI 买手对话页（tuifan AI 助手同款思路）：意图识别（flight/goods）→ 调 /api/search → 结果卡流式呈现。
 * 体验是对话，实际是结构化查询——零 LLM 依赖，后续可无缝替换为真 LLM（工具仍是 baydeep 网关）。 */
function aiHTML() {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AI Shopper — ask, compare, leap | LeapBest</title>
<meta name="description" content="Ask the LeapBest AI shopper: find AliExpress deals, compare flight fares, get attributed buy links.">
${FAVICON}<link rel="canonical" href="https://leapbest.com/ai.html"><style>${CSS}
.chatwrap{max-width:760px;margin:0 auto}
.chatbox{background:#fff;border:1px solid #e8ebf2;border-radius:12px;min-height:420px;max-height:60vh;overflow-y:auto;padding:18px;display:flex;flex-direction:column;gap:12px}
.msg{max-width:86%;border-radius:12px;padding:10px 14px;font-size:13.5px;line-height:1.5}
.msg.you{align-self:flex-end;background:#ff5a1f;color:#fff}
.msg.bot{align-self:flex-start;background:#f0f2f8;color:#182234}
.msg.bot .cards{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-top:8px}
.msg.bot .mini{background:#fff;border:1px solid #e8ebf2;border-radius:8px;overflow:hidden;display:flex;gap:8px;padding:6px}
.msg.bot .mini img{width:52px;height:52px;object-fit:cover;border-radius:6px;background:#f0f2f8}
.msg.bot .mini .t{font-size:11.5px;line-height:1.3;color:#243;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.msg.bot .mini .p{font-size:12.5px;font-weight:800;color:#ff5a1f}
.askrow{display:flex;gap:8px;margin-top:12px}
.askrow input{flex:1;border:1.5px solid #d9dfea;border-radius:10px;padding:11px 14px;font-size:14px;outline:none}
.askrow input:focus{border-color:#ff5a1f}
.askrow button{border:0;background:#ff5a1f;color:#fff;font-weight:700;border-radius:10px;padding:11px 22px;cursor:pointer}
.qchips{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
.qchips button{border:1px solid #d9dfea;background:#fff;border-radius:999px;padding:6px 13px;font-size:12.5px;color:#445;cursor:pointer}
.qchips button:hover{border-color:#ff5a1f;color:#ff5a1f}
</style></head><body>${headerTopHTML('')}${channelsHTML('/ai.html')}<main>
<div class="chatwrap">
<h2 class="sec">🤖 AI Shopper <small>ask me to find deals or flights — powered by BayDeep gateway</small></h2>
<div class="chatbox" id="box"><div class="msg bot">Hi! Tell me what you're shopping for — a product ("air fryer under $50") or a trip ("PEK to SIN flights"). I'll dig the catalog for you.</div></div>
<div class="qchips">
<button data-q="air fryer deals">air fryer deals</button>
<button data-q="pet supplies">pet supplies</button>
<button data-q="phone case under $3">phone case under $3</button>
<button data-q="flights BKK to SIN">flights BKK → SIN</button>
<button data-q="cheapest flights to Tokyo">flights to Tokyo</button>
</div>
<div class="askrow"><input id="ask" placeholder="e.g. warm LED lights for bedroom… (or: LHR to PEK flights)" onkeydown="if(event.key==='Enter')ask()"><button onclick="ask()">Ask</button></div>
</div></main>${footerHTML}
<script>
const box=document.getElementById('box');
const E=s=>String(s==null?'':s).replace(/[<>&"]/g,'');
function addYou(t){const d=document.createElement('div');d.className='msg you';d.textContent=t;box.appendChild(d);box.scrollTop=box.scrollHeight;}
function addBot(html){const d=document.createElement('div');d.className='msg bot';d.innerHTML=html;box.appendChild(d);box.scrollTop=box.scrollHeight;return d;}
function thinking(){return addBot('Digging the catalog<span id="dots">…</span>');}
async function ask(q){
  q=(q||'').trim()||document.getElementById('ask').value.trim();
  if(!q)return;
  document.getElementById('ask').value='';
  addYou(q);
  const t=thinking();
  const fl=q.match(/\\b(?:flights?|fare|fly)\\b/i)&&q.match(/\\b([A-Z]{3}|[a-z]{3})\\b.*\\b(?:to)\\b.*\\b([A-Za-z]{3})\\b|\\b([A-Za-z]{3})\\s*(?:to|→)\\s*([A-Za-z]{3})\\b/i);
  try{
    if(/flight|fly|fare/i.test(q)){
      const m=q.toUpperCase().match(/\\b([A-Z]{3})\\b[^A-Z]*\\b(?:TO|→)\\b[^A-Z]*\\b([A-Z]{3})\\b/);
      const r=await fetch('/flights-data.json');const all=await r.json();
      let list=all.filter(f=>(!m||f.o===m[1])&&(!m||f.d===m[2]));
      list.sort((a,b)=>a.price-b.price);
      const top=list.slice(0,6);
      t.innerHTML='Found <b>'+list.length+'</b> fares'+(m?' for '+m[1]+' → '+m[2]:'')+'. Cheapest first:'+
        (top.length?'<div class="cards">'+top.map(f=>'<a class="mini" href="/go/'+E(f.id)+'" rel="nofollow sponsored"><div><div class="t">'+E(f.o)+' → '+E(f.d)+'<br>'+E((f.dep||'').slice(0,16))+'</div><div class="p">$'+Number(f.price).toFixed(2)+'</div></div></a>').join('')+'</div>':'<br>No fares on this route yet — try Clear filters on the flights page, or another date.');
    }else{
      const r=await fetch('/api/search?q='+encodeURIComponent(q.replace(/deals|under \\$?\\d+|cheap(est)?/gi,'').trim()||q));
      const d=await r.json();
      const items=(d.items||[]).slice(0,6);
      t.innerHTML='Top picks from <b>'+(d.total||items.length)+'</b> matches:'+
        (items.length?'<div class="cards">'+items.map(i=>'<a class="mini" href="/p/'+E(i.goods_id)+'.html"><img loading="lazy" src="'+E(i.pict_url)+'"><div><div class="t">'+E(i.title).slice(0,70)+'</div><div class="p">$'+Number(i.price).toFixed(2)+(i.discount?' <span style="color:#1a7f37">-'+i.discount+'%</span>':'')+'</div></div></a>').join('')+'</div>':'<br>No match — try a broader keyword.');
    }
  }catch(e){t.innerHTML='Search hiccup — try again in a moment.';}
}
document.querySelectorAll('.qchips button').forEach(b=>b.onclick=()=>ask(b.dataset.q));
const qp=new URLSearchParams(location.search).get('q');
if(qp)ask(qp);
</script></body></html>`;
}

function main() {
  fs.mkdirSync(path.join(OUT, 'p'), { recursive: true });
  fs.mkdirSync(path.join(OUT, 'deals'), { recursive: true });
  let n = 0;
  for (const it of list) {
    it._related = goods.filter(x => catMajor[x.category_name || 'Other'] === catMajor[it.category_name || 'Other'] && x.goods_id !== it.goods_id).slice(0, 8);
    fs.writeFileSync(path.join(OUT, 'p', `${it.goods_id}.html`), pdpHTML(it));
    n++;
    if (n % 2000 === 0) console.log('[build] pdp pages', n);
  }
  for (let i = 1; i <= PAGES_N; i++) fs.writeFileSync(path.join(OUT, 'deals', `${i}.html`), dealsPageHTML(i));
  fs.writeFileSync(path.join(OUT, 'index.html'), indexHTML());
  fs.writeFileSync(path.join(OUT, 'flights.html'), flightsHTML());
  fs.writeFileSync(path.join(OUT, 'search.html'), searchHTML());
  fs.writeFileSync(path.join(OUT, 'ai.html'), aiHTML());
  console.log(`[build] DONE pdp=${n} deal-pages=${PAGES_N} flights=${flights.length} seed=${SEED} goods=${goods.length} → ${path.relative(ROOT, OUT)}`);
}
main();
