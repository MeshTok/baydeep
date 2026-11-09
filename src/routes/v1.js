'use strict';
// REST v1（同语义 REST 辅面——MCP 主、REST 辅，与国内协议面一致）。
// 响应统一 {schema:'v1', code:'OK', msg:'', data, agent_ref}；开放分层：
//   无 key：/healthz /v1/trial /v1/shelf*（IP 30/min）；其余全部要 key（实时扇出烧平台配额）。
const ali = require('../adapters/aliexpress');
const config = require('../config');
const { ERR } = require('../util');
const { agentAuth, ipAllowed } = require('../middleware');
const shelf = require('../services/shelf');
const trial = require('../services/trial');
const settlement = require('../services/settlement');
const metrics = require('../services/metrics');

function ok(ctx, data, status = 200) {
  return ctx.json({ schema: 'v1', code: 'OK', msg: '', data, agent_ref: ctx.agentKey ? ctx.agentKey.agent_id : null }, status);
}

// 每次实时调用的归因装载：key 有池号用池号，否则平台默认主号
function trackingOf(ctx) {
  return (ctx.agentKey && ctx.agentKey.tracking_id) || config.ALIEXPRESS.TRACKING_ID || undefined;
}

// client_ref 回填（048 同构）：agent 未显式传 → 用领 key 时的安装级标识
function clientRefOf(ctx, explicit) {
  return explicit || (ctx.agentKey && ctx.agentKey.default_client_ref) || undefined;
}

function routes() {
  return [
    { method: 'GET', pattern: '/healthz', handler: (ctx) => ok(ctx, { status: 'ok', mock: config.MOCK_MODE, shelf: shelf.stats(), ts: new Date().toISOString() }) },

    // ---- 开放层：无 key（IP 30/min） ----
    { method: 'POST', pattern: '/v1/trial', needsBody: true, handler: (ctx) => {
      if (!ipAllowed('trial:' + ctx.ip)) throw ERR.RATE_LIMITED();
      return ok(ctx, trial.mintTrial(ctx.ip, (ctx.body || {}).client_ref), 201);
    } },
    { method: 'GET', pattern: '/v1/shelf', handler: (ctx) => {
      if (!(ctx.headers['x-api-key'] || ctx.headers.authorization) && !ipAllowed(ctx.ip)) throw ERR.RATE_LIMITED();
      if (ctx.headers['x-api-key'] || ctx.headers.authorization) agentAuth(ctx);
      return ok(ctx, shelf.searchShelf(ctx.query));
    } },
    { method: 'GET', pattern: '/v1/shelf/:goodsId', handler: (ctx) => {
      if (!(ctx.headers['x-api-key'] || ctx.headers.authorization) && !ipAllowed(ctx.ip)) throw ERR.RATE_LIMITED();
      if (ctx.headers['x-api-key'] || ctx.headers.authorization) agentAuth(ctx);
      const it = shelf.getItem(ctx.params.goodsId);
      if (!it) throw ERR.NOT_FOUND('item not on shelf');
      return ok(ctx, it);
    } },

    // ---- key 层：全工具 + 实时扇出 + 归因 ----
    { method: 'GET', pattern: '/v1/me', handler: (ctx) => {
      agentAuth(ctx);
      const k = ctx.agentKey;
      return ok(ctx, {
        agent_id: k.agent_id, tier: k.rate_tier, created_at: k.created_at,
        tracking_id: k.tracking_id || null, attribution: k.tracking_id ? 'per-key' : 'shared default',
        default_client_ref: k.default_client_ref || null,
        share: '3% of attributed purchase volume; only orders whose product commission rate >3% participate (see /v1/orders share_summary). Settlement lands with billing milestone.'
      });
    } },
    { method: 'GET', pattern: '/v1/search', handler: async (ctx) => {
      agentAuth(ctx);
      if (!ctx.query.q) throw ERR.INVALID_PARAM('q required');
      return ok(ctx, await metrics.timed({ kind: 'rest', tool: 'search_products', keyed: true, ua: String(ctx.headers['user-agent'] || '').slice(0, 180) }, () =>
        ali.searchGoods(ctx.query.q, {
          page: ctx.query.page, pageSize: ctx.query.page_size, sort: ctx.query.sort,
          categoryId: ctx.query.category_id, shipTo: ctx.query.ship_to,
          currency: ctx.query.currency, language: ctx.query.language,
          trackingId: trackingOf(ctx)
        })));
    } },
    { method: 'GET', pattern: '/v1/hot', handler: async (ctx) => {
      agentAuth(ctx);
      return ok(ctx, await metrics.timed({ kind: 'rest', tool: 'hot_products', keyed: true, ua: String(ctx.headers['user-agent'] || '').slice(0, 180) }, () =>
        ali.hotProducts({
          page: ctx.query.page, pageSize: ctx.query.page_size, categoryId: ctx.query.category_id,
          shipTo: ctx.query.ship_to, currency: ctx.query.currency, language: ctx.query.language,
          trackingId: trackingOf(ctx)
        })));
    } },
    { method: 'GET', pattern: '/v1/item/:goodsId', handler: async (ctx) => {
      agentAuth(ctx);
      return ok(ctx, await metrics.timed({ kind: 'rest', tool: 'product_detail', keyed: true, ua: String(ctx.headers['user-agent'] || '').slice(0, 180) }, () =>
        ali.goodsDetail(ctx.params.goodsId, { trackingId: trackingOf(ctx) })));
    } },
    { method: 'POST', pattern: '/v1/convert', needsBody: true, handler: async (ctx) => {
      agentAuth(ctx);
      const urls = (ctx.body || {}).urls;
      if (!urls || (!Array.isArray(urls) && typeof urls !== 'string')) throw ERR.INVALID_PARAM('urls (string or array) required');
      return ok(ctx, await metrics.timed({ kind: 'rest', tool: 'convert_link', keyed: true, ua: String(ctx.headers['user-agent'] || '').slice(0, 180) }, () =>
        ali.convertLink(urls, { trackingId: trackingOf(ctx), linkType: (ctx.body || {}).link_type })));
    } },
    { method: 'GET', pattern: '/v1/orders', handler: async (ctx) => {
      agentAuth(ctx);
      return ok(ctx, await metrics.timed({ kind: 'rest', tool: 'affiliate_orders', keyed: true, ua: String(ctx.headers['user-agent'] || '').slice(0, 180) }, async () => {
        const r = await ali.orderDetails({
          startTime: ctx.query.start_time, endTime: ctx.query.end_time,
          status: ctx.query.status, page: ctx.query.page, pageSize: ctx.query.page_size
        });
        // 按 key 的 tracking id 回滤（池号模式=按开发者归因；共享主号模式原样返回并说明）
        if (ctx.agentKey.tracking_id && Array.isArray(r.list)) {
          r.list = r.list.filter((o) => o.tracking_id === ctx.agentKey.tracking_id);
        }
        r.client_ref = clientRefOf(ctx, ctx.query.client_ref) || null;
        return settlement.decorateOrderPage(r); // 3% 分成装饰 + 当页分成汇总
      }));
    } },
    { method: 'GET', pattern: '/v1/categories', handler: async (ctx) => {
      agentAuth(ctx);
      return ok(ctx, await ali.categories({ trackingId: trackingOf(ctx) }));
    } }
  ];
}

module.exports = { routes, ok };
