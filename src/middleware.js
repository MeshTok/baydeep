'use strict';
// 开放分层中间件（镜像 agentmall middleware.js）：
//   t0_free 30 req/min、t1_std 60 req/min 令牌桶；keyless 只读层独立 IP 令牌桶（30/min）。
const { ERR, sha256 } = require('./util');
const keys = require('./services/keys');

const TIERS = { // req/min
  t0_free: 30, t1_std: 60, t2_burst: 240
};
const buckets = new Map(); // keyId -> {tokens, last}
function takeToken(keyId, tier) {
  const cap = TIERS[tier] || 60;
  const now = Date.now();
  let b = buckets.get(keyId);
  if (!b) { b = { tokens: cap, last: now }; buckets.set(keyId, b); }
  const refill = ((now - b.last) / 60000) * cap;
  b.tokens = Math.min(cap, b.tokens + refill);
  b.last = now;
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}
if (buckets.size > 20000) buckets.clear();

// keyless IP 令牌桶（与 agentmall mcp.js ipAllowed 同构）
const ipBuckets = new Map();
function ipAllowed(ip) {
  const now = Date.now();
  let b = ipBuckets.get(ip);
  if (!b) { b = { tokens: 30, last: now }; ipBuckets.set(ip, b); }
  if (ipBuckets.size > 5000) ipBuckets.clear();
  const refill = ((now - b.last) / 60000) * 30;
  b.tokens = Math.min(30, b.tokens + refill);
  b.last = now;
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

function rawKeyOf(ctx) {
  const h = ctx.headers || {};
  const auth = h.authorization || '';
  return h['x-api-key'] || String(auth).replace(/^Bearer\s+/i, '');
}

// REST 用：必须持有效 key（ak_bd_ 前缀）
function agentAuth(ctx) {
  const raw = rawKeyOf(ctx);
  if (!raw || !raw.startsWith('ak_')) throw ERR.UNAUTHORIZED('missing agent key');
  const key = findByHash(raw);
  if (!key) throw ERR.UNAUTHORIZED('invalid agent key');
  if (!takeToken(key.id, key.rate_tier)) throw ERR.RATE_LIMITED();
  ctx.agentKey = key;
  return key;
}

function findByHash(raw) { return keys.findByRaw(raw); }

// MCP 用：ak_ key → agentAuth；无 key → 只读白名单放行（IP 限流），否则 401 + 领 key 指引
function keylessGate(ctx, isOpen) {
  const raw = rawKeyOf(ctx);
  if (raw && raw.startsWith('ak_')) return agentAuth(ctx);
  if (isOpen(ctx)) { ctx.keyless = true; return null; }
  throw ERR.UNAUTHORIZED('this operation needs a free API key — POST ' +
    require('./config').PUBLIC_BASE_URL + '/v1/trial (no signup, never expires; read-only tools work without any key, 30 req/min per IP)');
}

function errorPayload(ctx, err) {
  const isApi = err && err.code && err.httpStatus;
  return {
    schema: 'v1',
    code: isApi ? err.code : 'INTERNAL',
    msg: (err && err.message) || 'error',
    data: null,
    agent_ref: ctx && ctx.agentKey ? ctx.agentKey.agent_id : null
  };
}

function errorHandler(ctx, err) {
  // 畸形 JSON → 干净 400（国内 2026-10-26 同款教训：扫描器 junk 不刷栈）
  const isApi = err instanceof Error && err.code && err.httpStatus;
  const status = isApi ? err.httpStatus : (err && err.httpStatus) || 500;
  if (!isApi) console.error('[baydeep] unhandled', err);
  ctx.res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  ctx.res.end(JSON.stringify(errorPayload(ctx, err)));
}

function errorWrap(fn) {
  return (ctx) => Promise.resolve(fn(ctx)).catch((e) => errorHandler(ctx, e));
}

module.exports = { ERR, agentAuth, keylessGate, ipAllowed, errorWrap, errorHandler, errorPayload, sha256, TIERS };
