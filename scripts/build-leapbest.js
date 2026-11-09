'use strict';
/* leapbest.com 静态站生成器（零依赖）
 * 读 data/shelf.json → website/leapbest.com-site/
 *   index.html          首页（类目 + 折扣榜 + 畅销榜）
 *   search.html         搜索页（客户端调 /api/search，服务端落搜索历史）
 *   p/<goods_id>.html   商品详情页（SEO：JSON-LD Product + 购买走 /go/<id> 服务端转链）
 * 用法: node scripts/build-leapbest.js [商品上限=全部]
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SHELF = path.join(ROOT, 'data', 'shelf.json');
const OUT = path.join(ROOT, 'website', 'leapbest.com-site');
const LIMIT = parseInt(process.argv[2] || '0', 10) || 0; // 0=全部

const _raw = JSON.parse(fs.readFileSync(SHELF, 'utf8'));
const items = Array.isArray(_raw) ? _raw : _raw.items || [];
const list = LIMIT ? items.slice(0, LIMIT) : items;

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (v, cur) => (cur || 'USD') === 'USD' ? '$' + Number(v).toFixed(2) : Number(v).toFixed(2) + ' ' + (cur || '');

const CSS = `
*{margin:0;padding:0;box-sizing:border-box}
body{font:16px/1.6 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#1a2333;background:#f6f7fb}
a{color:inherit;text-decoration:none}
header{background:#0e1526;color:#fff;padding:14px 24px;display:flex;align-items:center;gap:18px;position:sticky;top:0;z-index:9;flex-wrap:wrap}
header .logo{font-weight:800;font-size:22px;letter-spacing:-.4px}
header .logo span{color:#fbbf24}
header form{flex:1;display:flex;max-width:640px}
header input{flex:1;border:0;border-radius:8px 0 0 8px;padding:10px 14px;font-size:15px;outline:none;min-width:180px}
header button{border:0;background:#fbbf24;color:#0e1526;font-weight:700;padding:10px 18px;border-radius:0 8px 8px 0;cursor:pointer}
main{max-width:1200px;margin:0 auto;padding:24px 20px}
.chips{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:22px}
.chips a{background:#fff;border:1px solid #e3e8f2;border-radius:999px;padding:6px 14px;font-size:13.5px;color:#445}
.chips a:hover{border-color:#fbbf24;color:#0e1526}
h2.sec{font-size:20px;margin:26px 0 14px;letter-spacing:-.2px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:16px}
.card{background:#fff;border:1px solid #e6eaf3;border-radius:12px;overflow:hidden;display:flex;flex-direction:column;transition:box-shadow .15s}
.card:hover{box-shadow:0 6px 18px rgba(20,30,60,.10)}
.card img{width:100%;aspect-ratio:1;object-fit:cover;background:#f0f2f8}
.card .in{padding:10px 12px 12px;display:flex;flex-direction:column;gap:6px;flex:1}
.card .t{font-size:13.5px;line-height:1.45;color:#243;max-height:58px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical}
.card .p{font-size:17px;font-weight:800;color:#e04515}
.card .p s{color:#98a2b8;font-weight:400;font-size:12.5px;margin-left:6px}
.card .d{display:inline-block;background:#feeec8;color:#8a5b00;font-size:11.5px;font-weight:700;border-radius:6px;padding:2px 7px;width:fit-content}
.card .r{font-size:12px;color:#77839a}
.card .buy{margin-top:auto;background:#fbbf24;text-align:center;font-weight:700;border-radius:8px;padding:8px;font-size:13.5px}
.pill{display:inline-block;background:#eef2f9;border-radius:999px;padding:3px 10px;font-size:12px;color:#556;margin:0 6px 6px 0}
.pdp{display:grid;grid-template-columns:minmax(280px,460px) 1fr;gap:34px;background:#fff;border:1px solid #e6eaf3;border-radius:14px;padding:28px}
.pdp img{width:100%;border-radius:10px;background:#f0f2f8}
.pdp h1{font-size:21px;line-height:1.45;letter-spacing:-.2px;margin-bottom:14px}
.price{font-size:30px;font-weight:800;color:#e04515}
.price s{font-size:15px;color:#98a2b8;font-weight:400;margin-left:10px}
.save{display:inline-block;background:#feeec8;color:#8a5b00;font-weight:700;border-radius:8px;padding:4px 10px;font-size:13px;margin-top:8px}
.meta{margin:16px 0;color:#556;font-size:14px;display:grid;gap:6px}
.buybig{display:block;background:#fbbf24;text-align:center;font-weight:800;font-size:17px;border-radius:10px;padding:14px;margin-top:18px}
.note{color:#77839a;font-size:12.5px;margin-top:10px}
footer{max-width:1200px;margin:30px auto 0;padding:20px;color:#8a94a8;font-size:13px;border-top:1px solid #e6eaf3}
@media(max-width:760px){.pdp{grid-template-columns:1fr;padding:16px}}
`;

function headerHTML(active) {
  return `<header><a class="logo" href="/">Leap<span>Best</span></a>
<form action="/search.html" role="search"><input name="q" placeholder="Search deals…" value="${esc(active || '')}" aria-label="Search"><button>Search</button></form></header>`;
}
const footerHTML = `<footer><p><b>LeapBest</b> — leap to the best price. Part of the Deep family · <a href="https://baydeep.com" style="color:#445">BayDeep</a></p>
<p style="margin-top:6px">Affiliate disclosure: LeapBest earns commissions from qualifying purchases made through links on this site. Prices update periodically from the AliExpress affiliate program.</p>
<p style="margin-top:6px">© 2026 LeapBest</p></footer>`;

function cardHTML(it) {
  const disc = it.discount ? `<span class="d">-${it.discount}%</span>` : '';
  const rate = it.rating ? `★ ${(it.rating / 20).toFixed(1)}` : '';
  const sold = it.sales ? ` · ${it.sales} sold` : '';
  return `<a class="card" href="/p/${esc(it.goods_id)}.html">
<img loading="lazy" src="${esc(it.pict_url)}" alt="${esc(it.title).slice(0, 80)}">
<div class="in"><div class="t">${esc(it.title)}</div>
<div class="p">${money(it.price, it.currency)}${it.original_price ? `<s>${money(it.original_price, it.currency)}</s>` : ''}</div>
${disc}<div class="r">${rate}${sold}</div>
<div class="buy">View deal ›</div></div></a>`;
}

function pdpHTML(it) {
  const cur = it.currency || 'USD';
  const save = it.original_price && it.original_price > it.price
    ? Math.round((1 - it.price / it.original_price) * 100) : 0;
  const jsonld = {
    '@context': 'https://schema.org', '@type': 'Product',
    name: it.title, image: [it.pict_url], description: it.title,
    brand: { '@type': 'Brand', name: it.shop_name || 'AliExpress' },
    offers: { '@type': 'Offer', price: it.price, priceCurrency: cur,
      availability: 'https://schema.org/InStock', url: `https://leapbest.com/p/${it.goods_id}.html` },
  };
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(it.title).slice(0, 60)} — ${money(it.price, cur)} | LeapBest</title>
<meta name="description" content="${esc(it.title).slice(0, 150)}. ${money(it.price, cur)}${save ? ` (${save}% off)` : ''} — ships to 200+ countries via AliExpress.">
<link rel="canonical" href="https://leapbest.com/p/${esc(it.goods_id)}.html">
<script type="application/ld+json">${JSON.stringify(jsonld)}</script><style>${CSS}</style></head><body>
${headerHTML(it.title.slice(0, 40))}<main>
<p style="margin-bottom:14px"><a href="/" style="color:#77839a">‹ All deals</a> <span class="pill">${esc(it.category_name || 'Deals')}</span>${it.shop_name ? `<span class="pill">${esc(it.shop_name)}</span>` : ''}</p>
<div class="pdp"><div><img src="${esc(it.pict_url)}" alt="${esc(it.title).slice(0, 80)}"></div>
<div><h1>${esc(it.title)}</h1>
<div class="price">${money(it.price, cur)}${it.original_price ? `<s>${money(it.original_price, cur)}</s>` : ''}</div>
${save ? `<span class="save">Save ${save}% today</span>` : ''}
<div class="meta">${it.rating ? `<span>Rating: ★ ${(it.rating / 20).toFixed(1)} / 5</span>` : ''}${it.sales ? `<span>${it.sales} sold</span>` : ''}<span>Ships to 200+ countries · buyer protection via AliExpress</span></div>
<a class="buybig" href="/go/${esc(it.goods_id)}" rel="nofollow sponsored">Buy on AliExpress ›</a>
<p class="note">You'll checkout on AliExpress (secure). LeapBest may earn a commission.</p>
</div></div>
<h2 class="sec">More deals</h2><div class="grid">${(it._related || []).map(cardHTML).join('')}</div>
</main>${footerHTML}</body></html>`;
}

function main() {
  fs.mkdirSync(path.join(OUT, 'p'), { recursive: true });
  const catCount = {};
  for (const it of items) { const c = it.category_name || 'Other'; catCount[c] = (catCount[c] || 0) + 1; }
  const cats = Object.entries(catCount).sort((a, b) => b[1] - a[1]).slice(0, 14);
  const topDeals = [...items].sort((a, b) => (b.discount || 0) - (a.discount || 0)).slice(0, 48);
  const bestSellers = [...items].sort((a, b) => (b.sales || 0) - (a.sales || 0)).slice(0, 24);

  let n = 0;
  for (const it of list) {
    it._related = items.filter(x => x.category_name === it.category_name && x.goods_id !== it.goods_id).slice(0, 8);
    fs.writeFileSync(path.join(OUT, 'p', `${it.goods_id}.html`), pdpHTML(it));
    n++;
    if (n % 1000 === 0) console.log('[build] pages', n);
  }
  const index = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>LeapBest — Leap to the best price | AliExpress deals up to 90% off</title>
<meta name="description" content="Live deals across ${items.length.toLocaleString()}+ products from AliExpress — electronics, home, outdoors, fashion. Ships to 200+ countries.">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%230e1526'/%3E%3Cpath d='M16 44h32M22 40l12-16 8 10' fill='none' stroke='%23fbbf24' stroke-width='5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E">
<style>${CSS}</style></head><body>${headerHTML('')}<main>
<div class="chips">${cats.map(([c, k]) => `<a href="/search.html?q=${encodeURIComponent(c)}">${esc(c)} <b style="color:#9aa">${k}</b></a>`).join('')}</div>
<h2 class="sec">🔥 Biggest discounts today</h2><div class="grid">${topDeals.map(cardHTML).join('')}</div>
<h2 class="sec">⭐ Best sellers</h2><div class="grid">${bestSellers.map(cardHTML).join('')}</div>
</main>${footerHTML}</body></html>`;
  fs.writeFileSync(path.join(OUT, 'index.html'), index);
  const search = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Search — LeapBest</title><style>${CSS}</style></head><body>${headerHTML('')}<main>
<div id="trend"></div><h2 class="sec" id="rh">Results</h2><div class="grid" id="g"></div></main>${footerHTML}
<script>
const q=new URLSearchParams(location.search).get('q')||'';
document.querySelector('input[name=q]').value=q;
const E=s=>s.replace(/[<>&"]/g,'');
if(q){document.getElementById('rh').textContent='Results for "'+E(q)+'"';
fetch('/api/search?q='+encodeURIComponent(q)).then(r=>r.json()).then(d=>{
  document.getElementById('g').innerHTML=(d.items||[]).map(i=>'<a class="card" href="/p/'+i.goods_id+'.html"><img loading="lazy" src="'+E(i.pict_url)+'"><div class="in"><div class="t">'+E(i.title)+'</div><div class="p">$'+Number(i.price).toFixed(2)+(i.original_price?'<s>$'+Number(i.original_price).toFixed(2)+'</s>':'')+'</div>'+(i.discount?'<span class="d">-'+i.discount+'%</span>':'')+'<div class="buy">View deal ›</div></div></a>').join('')||'<p>No results — try another keyword.</p>';
}).catch(()=>{document.getElementById('g').innerHTML='<p>Search temporarily unavailable.</p>'});}
fetch('/api/hot').then(r=>r.json()).then(d=>{const t=d.top||[];if(t.length)document.getElementById('trend').innerHTML='<h2 class="sec">🔥 Trending searches</h2><div class="chips">'+t.map(x=>'<a href="/search.html?q='+encodeURIComponent(x.q)+'">'+E(x.q)+' <b style="color:#9aa">'+x.n+'</b></a>').join('')+'</div>';}).catch(()=>{});
</script></body></html>`;
  fs.writeFileSync(path.join(OUT, 'search.html'), search);
  console.log(`[build] DONE pages=${n} shelf=${items.length} → ${path.relative(ROOT, OUT)}`);
}
main();
