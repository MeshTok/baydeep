'use strict';
// MCP 端点（mcp.baydeep.com/mcp）——对外主接口（国内 ARCH §0.5 海外镜像：一切宿主的插座）。
// 手写最小 JSON-RPC（initialize/tools/list/tools/call），协议形态对齐 MCP streamable HTTP；
// 上真客户端如需 SSE/会话协商，再切官方 @modelcontextprotocol/sdk（薄壳替换本文件）。
// 开放分层（2026-10-14 用户令同构）：
//   无 key：initialize / tools/list / ping / 只读货架工具（IP 30/min，链接不带归因）；
//   免费 key（POST /mcp/trial 永久有效）：全工具 + 实时扇出 + tracking_id 归因；提现待结算面。
const ali = require('../adapters/aliexpress');
const config = require('../config');
const { ERR } = require('../util');
const { keylessGate, ipAllowed } = require('../middleware');
const { CORS } = require('../server');
const shelf = require('../services/shelf');
const trial = require('../services/trial');
const settlement = require('../services/settlement');
const metrics = require('../services/metrics');

const SERVER_INFO = { name: 'baydeep-gateway', version: '0.1.0', title: 'BayDeep — The e-commerce plugin for AI agents' };

const TOOLS = [
  {
    name: 'mint_free_key',
    description: 'SELF-SERVE a free API key — NO signup, NEVER expires, unlocks ALL tools (live AliExpress search, hot products, attributed convert links, your orders). Call this FIRST if any other tool says a key is required. Store the returned key and send it as X-API-Key header (or Authorization: Bearer) on subsequent calls. Rate limit: 30 req/min. Your commission share (3% on eligible purchases) is attributed via this key. Optional client_ref ([A-Za-z0-9-], <=40) = your own end-user id, echoed back on your orders.',
    inputSchema: { type: 'object', properties: {
      client_ref: { type: 'string', description: 'optional: your stable anonymized end-user id ([A-Za-z0-9-], <=40)' }
    } }
  },
  {
    name: 'search_products',
    description: 'LIVE AliExpress affiliate product search (100M+ item pool, ships to 200+ countries; prices in the target currency). Consumes platform quota — do not poll; prefer shelf_search for repeated lookups. Returns items with price, coupon, sales, rating, commission_rate and detail_url. Read-only. Requires a free API key.',
    inputSchema: { type: 'object', properties: {
      q: { type: 'string' }, page: { type: 'number', default: 1 }, page_size: { type: 'number', default: 10, maximum: 50 },
      sort: { type: 'string', description: 'SALE_PRICE_ASC | SALE_PRICE_DESC | AVERAGE_RATE_ASC | AVERAGE_RATE_DESC | ORDINAL_ASC | ORDINAL_DESC' },
      category_id: { type: 'string' }, ship_to: { type: 'string', description: 'ISO country code, default US' },
      currency: { type: 'string', default: 'USD' }, language: { type: 'string', default: 'EN' }
    }, required: ['q'] }
  },
  {
    name: 'hot_products',
    description: 'LIVE AliExpress hot-selling products (no keyword; optional category). Good for "what\'s trending" / deal feeds. Consumes platform quota. Read-only. Requires a free API key.',
    inputSchema: { type: 'object', properties: {
      page: { type: 'number', default: 1 }, page_size: { type: 'number', default: 10, maximum: 50 },
      category_id: { type: 'string' }, ship_to: { type: 'string' }, currency: { type: 'string' }, language: { type: 'string' }
    } }
  },
  {
    name: 'product_detail',
    description: 'Full detail for up to 10 AliExpress product ids (comma separated or array). Read-only. Requires a free API key.',
    inputSchema: { type: 'object', properties: { product_ids: { type: 'string', description: 'comma separated ids, max 10' } }, required: ['product_ids'] }
  },
  {
    name: 'convert_link',
    description: 'Convert any aliexpress.com product/shop/search URL(s) into YOUR affiliate-attributed link(s) (max 10 per call). ALWAYS run items through this before presenting a buy link — attribution is how your 3% share is tracked. Requires a free API key.',
    inputSchema: { type: 'object', properties: {
      urls: { type: 'string', description: 'comma separated URLs, max 10' },
      link_type: { type: 'number', enum: [0, 2], description: '2=short link (default), 0=original' }
    }, required: ['urls'] }
  },
  {
    name: 'affiliate_orders',
    description: 'YOUR attributed affiliate orders in a time range (source for your commission settlement & refund tracking). Orders are filtered to your key\'s tracking_id; each order carries share_eligible + share_amount and the page ends with share_summary — your share is 3% of purchase volume, counting ONLY orders whose product commission rate >3%. Requires a free API key.',
    inputSchema: { type: 'object', properties: {
      start_time: { type: 'string', description: 'ISO 8601 or yyyy-MM-dd HH:mm:ss (UTC assumed)' },
      end_time: { type: 'string' }, status: { type: 'string', description: 'PENDING | PAID | CLOSED ...' },
      page: { type: 'number' }, page_size: { type: 'number', maximum: 50 }
    }, required: ['start_time', 'end_time'] }
  },
  {
    name: 'categories',
    description: 'AliExpress affiliate category tree (for building category filters or browse UX). Requires a free API key.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'catalog_overview',
    description: 'WHAT BAYDEEP SELLS: product types currently in the catalog (physical goods from AliExpress, flight fares via Travelpayouts/Aviasales), item counts, top categories, and HOW to search/book each type. Call this FIRST when unsure what the catalog contains. Works WITHOUT any API key. Read-only.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'flight_search',
    description: 'Search FLIGHT FARES in the catalog (Aviasales/Travelpayouts partners, fares refreshed daily). Filter by origin/destination IATA code (e.g. PEK, JFK, SIN) and optional departure date (YYYY-MM-DD). Items sorted by price; book_url is ALREADY affiliate-attributed — link the user straight to it (no convert_link needed). Works WITHOUT any API key. Read-only.',
    inputSchema: { type: 'object', properties: {
      origin: { type: 'string', description: 'origin IATA code, e.g. PEK' },
      destination: { type: 'string', description: 'destination IATA code, e.g. SIN' },
      date: { type: 'string', description: 'departure date YYYY-MM-DD (optional)' },
      page_size: { type: 'number', default: 20, maximum: 50 }
    } }
  },
  {
    name: 'shelf_search',
    description: 'Search the LOCAL shelf — physical goods (AliExpress) AND flight fares (Travelpayouts). No platform quota consumed — works WITHOUT any API key (30 req/min per IP). sort=relevance(default when q given)|price|sales|latest; price_min/price_max filter. Goods items carry detail_url (attribute via convert_link with a free key); flight items carry book_url directly. Read-only.',
    inputSchema: { type: 'object', properties: {
      q: { type: 'string' }, sort: { type: 'string', enum: ['relevance', 'price', 'sales', 'latest'] },
      price_min: { type: 'number' }, price_max: { type: 'number' },
      page: { type: 'number', default: 1 }, page_size: { type: 'number', default: 20, maximum: 50 }
    } }
  },
  {
    name: 'shelf_item',
    description: 'Get one LOCAL shelf item by goods_id (full normalized fields; works for goods and flight fares). Works WITHOUT any API key. Read-only.',
    inputSchema: { type: 'object', properties: { goods_id: { type: 'string' } }, required: ['goods_id'] }
  }
];

// 无 key 只放行货架面；实时扇出工具进 quota-guard（isError + 指引，不烧平台配额）
const KEYLESS_BLOCKED = new Set(['search_products', 'hot_products', 'product_detail', 'convert_link', 'affiliate_orders', 'categories']);

function trackingOf(ctx) {
  return (ctx.agentKey && ctx.agentKey.tracking_id) || config.ALIEXPRESS.TRACKING_ID || undefined;
}

async function dispatchTool(ctx, name, args) {
  switch (name) {
    case 'mint_free_key': return trial.mintTrial(ctx.ip, args.client_ref);
    case 'catalog_overview': {
      const o = shelf.overview();
      const goods = o.platforms.aliexpress || 0;
      const flights = o.platforms.travelpayouts || 0;
      const hotels = o.platforms.tripcom || 0;
      return {
        service: 'BayDeep — the e-commerce plugin for AI agents',
        catalog: {
          total_items: o.total,
          updated_at: o.updated_at,
          product_types: [
            {
              type: 'physical_goods', platform: 'aliexpress', count: goods,
              how_to: 'shelf_search(q) to find, shelf_item(goods_id) for detail, then mint_free_key + convert_link(detail_url) for YOUR attributed buy URL'
            },
            {
              type: 'flight_fares', platform: 'travelpayouts/aviasales', count: flights,
              how_to: 'flight_search(origin,destination[,date]); book_url is pre-attributed, link the user directly'
            },
            {
              type: 'hotel_stays', platform: 'tripcom', count: hotels,
              how_to: 'shelf_item on ht-<cityid> items; goods_url is a Trip.com hotel list page pre-attributed (AllianceID/SID) — link the user directly'
            }
          ],
          top_categories: o.top_categories,
          categories_total: o.categories_total,
          coming_next: ['activities & tours (Viator)', 'eSIM data plans (Airalo)', 'Temu/Shein (Admitad)']
        },
        consumer_site: 'https://leapbest.com',
        agent_commission: '3% share of purchase volume on eligible orders (product commission rate >3%), attributed via your free API key'
      };
    }
    case 'flight_search': return shelf.searchFlights(args);
    case 'shelf_search': return shelf.searchShelf(args);
    case 'shelf_item': {
      const it = shelf.getItem(args.goods_id);
      if (!it) throw ERR.NOT_FOUND('item not on shelf');
      return { ...it, buy_hint: 'run convert_link with a free key to get your attributed buy URL for this item' };
    }
    case 'search_products': return ali.searchGoods(String(args.q), {
      page: args.page, pageSize: args.page_size, sort: args.sort, categoryId: args.category_id,
      shipTo: args.ship_to, currency: args.currency, language: args.language, trackingId: trackingOf(ctx)
    });
    case 'hot_products': return ali.hotProducts({
      page: args.page, pageSize: args.page_size, categoryId: args.category_id,
      shipTo: args.ship_to, currency: args.currency, language: args.language, trackingId: trackingOf(ctx)
    });
    case 'product_detail': return ali.goodsDetail(String(args.product_ids || ''), { trackingId: trackingOf(ctx) });
    case 'convert_link': {
      const urls = String(args.urls || '');
      if (!urls) throw ERR.INVALID_PARAM('urls required');
      return ali.convertLink(urls.split(',').map((s) => s.trim()).filter(Boolean), { trackingId: trackingOf(ctx), linkType: args.link_type });
    }
    case 'affiliate_orders': {
      const r = await ali.orderDetails({
        startTime: args.start_time, endTime: args.end_time, status: args.status, page: args.page, pageSize: args.page_size
      });
      if (ctx.agentKey && ctx.agentKey.tracking_id && Array.isArray(r.list)) {
        r.list = r.list.filter((o) => o.tracking_id === ctx.agentKey.tracking_id);
      }
      return settlement.decorateOrderPage(r); // 每笔 share_eligible/share_amount + 当页 share_summary
    }
    case 'categories': return ali.categories({ trackingId: trackingOf(ctx) });
    default: throw ERR.INVALID_PARAM('unknown tool: ' + name);
  }
}

function jsonRpc(id, result) { return { jsonrpc: '2.0', id, result }; }
function jsonRpcErr(id, code, message) { return { jsonrpc: '2.0', id, error: { code, message } }; }

const INSTRUCTIONS = [
  'BayDeep — the e-commerce plugin for AI agents (AliExpress affiliate gateway, 100M+ item pool, 200+ ship-to countries).',
  'OPEN ACCESS — NO signup required: shelf_search / shelf_item work without any key (30 req/min per IP), and you can SELF-SERVE a free API key by calling the mint_free_key tool right here (never expires, unlocks ALL tools incl. live search + attributed links + your commission). Mint it once, store it, and send it as X-API-Key on subsequent calls. A HTTP fallback also exists: POST ' + config.PUBLIC_BASE_URL + '/v1/trial.',
  '',
  'SHOPPING FLOW (most common):',
  '1. search_products with the user ask (q may be natural language; sort=SALE_PRICE_ASC when the user stresses cheap). For repeated/simple lookups prefer shelf_search (quota-free, no key needed).',
  '2. product_detail on shortlisted ids for full fields.',
  '3. convert_link EVERY url you are about to show as a buy link — attributed links are how your 3% share on purchases is tracked. Always present the converted link to the user.',
  '',
  'POLICY: never recommend medicines or give medical advice. Never put words like cashback/rebate in front of consumers — your share is your business revenue, not a user reward. The user always pays on AliExpress directly; agents never touch money.',
  '',
  'RATE LIMITS: search_products / hot_products / product_detail consume platform quota — do not poll or batch-poll them; prefer shelf tools for repeated lookups.',
  '',
  'SETTLEMENT: your share is 3% of purchase volume on commission-eligible orders only (product commission rate >3%). affiliate_orders returns your attributed orders (filtered by your tracking_id) with share_eligible / share_amount per order and a share_summary — that is the monthly settlement dataset.',
  '',
  'YOUR USERS (optional): pass client_ref ([A-Za-z0-9-], <=40) when minting your key — echoed back on order responses so you can run your own user rewards; the server never interprets it.'
].join('\n');

function routes() {
  return [
    { method: 'GET', pattern: '/mcp', handler: (ctx) => ctx.json({ error: 'POST only (streamable http)' }, 405) },
    { method: 'POST', pattern: '/mcp/trial', needsBody: true, handler: (ctx) => {
      if (!ipAllowed('trial:' + ctx.ip)) throw ERR.RATE_LIMITED();
      ctx.json(trial.mintTrial(ctx.ip, (ctx.body || {}).client_ref), 201, { 'Cache-Control': 'no-store' });
    } },
    { method: 'POST', pattern: '/mcp', needsBody: true, handler: async (ctx) => {
      const msg = ctx.body || {};
      const id = msg.id !== undefined ? msg.id : null;
      // 开放层闸门：ak_ key 走全量鉴权；无 key 放行握手/列表 + tools/call（IP 30/min）——
      // 实时工具不在闸门拦截，进 tools/call 后由 quota-guard 返回 isError + 领 key 指引
      //（比 401 裸错误对宿主模型更友好：模型能看到「领免费 key」的下一步动作）
      const open = () => msg.method === 'initialize' || msg.method === 'tools/list' || msg.method === 'ping'
        || (typeof msg.method === 'string' && msg.method.startsWith('notifications/'))
        || (msg.method === 'tools/call' && ipAllowed(ctx.ip));
      keylessGate(ctx, open);
      try {
        if (msg.method === 'initialize') {
          return ctx.json(jsonRpc(id, {
            protocolVersion: (msg.params && msg.params.protocolVersion) || '2025-06-18',
            capabilities: { tools: {} },
            serverInfo: SERVER_INFO,
            instructions: INSTRUCTIONS
          }));
        }
        if (msg.method === 'notifications/initialized') { ctx.res.writeHead(202, CORS); return ctx.res.end(); }
        if (msg.method === 'ping') return ctx.json(jsonRpc(id, {}));
        if (msg.method === 'tools/list') return ctx.json(jsonRpc(id, { tools: TOOLS }));
        if (msg.method === 'tools/call') {
          const { name, arguments: argsIn } = msg.params || {};
          let args = argsIn || {};
          // 默认 client_ref 注入（048 同构）
          if (!ctx.keyless && ctx.agentKey && ctx.agentKey.default_client_ref && args && args.client_ref == null) {
            args = { ...args, client_ref: ctx.agentKey.default_client_ref };
          }
          // 无 key 保护：实时扇出工具不开放（不烧平台配额），货架工具与 mint_free_key 放行
          if (ctx.keyless && KEYLESS_BLOCKED.has(name)) {
            metrics.log({ kind: 'mcp', tool: name, keyless: true, is_error: true, err_brief: 'keyless quota-guard' });
            return ctx.json(jsonRpc(id, {
              content: [{ type: 'text', text: 'the keyless tier covers the local shelf only. Call the mint_free_key tool to self-serve a free key (no signup, never expires, unlocks live search + attributed links + commission), then retry with the key as X-API-Key.' }],
              isError: true
            }));
          }
          try {
            const data = await metrics.timed(
              { kind: 'mcp', tool: name, keyless: !!ctx.keyless, ua: String(ctx.headers['user-agent'] || '').slice(0, 180) },
              () => dispatchTool(ctx, name, args)
            );
            return ctx.json(jsonRpc(id, { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data }));
          } catch (e) {
            // MCP 规范：工具执行失败用 result.isError=true 返回（部分宿主对 JSON-RPC error 渲染为空）
            return ctx.json(jsonRpc(id, { content: [{ type: 'text', text: 'tool error: ' + String(e.message || 'failed').slice(0, 500) }], isError: true }));
          }
        }
        return ctx.json(jsonRpcErr(id, -32601, 'method not found: ' + (msg.method || '')));
      } catch (e) {
        const code = e.httpStatus === 401 ? -32001 : (e.httpStatus === 429 ? -32002 : -32000);
        return ctx.json(jsonRpcErr(id, code, e.message || 'internal'));
      }
    } }
  ];
}

module.exports = { routes, TOOLS };
