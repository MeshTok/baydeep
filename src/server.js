'use strict';
// 零依赖 HTTP 骨架（替代 agentmall 的 express——本机/服务器无 npm 也可跑 L2，语义对齐）：
//   - 路由表：method + '/v1/item/:id' 形式路径模板
//   - ctx：{method, path, params, query, body, headers, ip, res, agentKey, keyless}
//   - 全响应带 CORS（开放给浏览器型 agent，与国内 mcp.js 同款决策）
//   - 响应协议 {schema:'v1', code, msg, data, agent_ref}
const http = require('http');
const { ERR, errorHandler, errorPayload } = require('./middleware');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, Idempotency-Key, Mcp-Session-Id, Mcp-Protocol-Version',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id'
};

function compile(pattern) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:[A-Za-z_]+/g, (m) => { keys.push(m.slice(1)); return '([^/]+)'; }) + '/?$');
  return { re, keys };
}

function ipOf(req) {
  return req.headers['x-real-ip'] || req.socket && req.socket.remoteAddress || '';
}

function readBody(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(ERR.INVALID_PARAM('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function createApp(routes) {
  const compiled = routes.map((r) => ({ ...r, ...compile(r.pattern) }));
  return async function app(req, res) {
    const ctx = {
      method: req.method,
      headers: req.headers,
      ip: ipOf(req),
      res,
      agentKey: null,
      keyless: false,
      json(payload, status = 200, headers = {}) {
        res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...CORS, ...headers });
        res.end(JSON.stringify(payload));
      }
    };
    const u = new URL(req.url, 'http://local');
    ctx.path = u.pathname.replace(/\/+$/, '') || '/';
    ctx.query = Object.fromEntries(u.searchParams);
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
    for (const route of compiled) {
      if (route.method !== req.method) continue;
      const m = ctx.path.match(route.re);
      if (!m) continue;
      ctx.params = {};
      route.keys.forEach((k, i) => { ctx.params[k] = decodeURIComponent(m[i + 1]); });
      if (route.needsBody) {
        try {
          const raw = await readBody(req);
          ctx.body = raw ? JSON.parse(raw) : {};
        } catch (e) {
          if (e instanceof SyntaxError) return errorHandler(ctx, Object.assign(new Error('invalid JSON body'), { code: 'BAD_JSON', httpStatus: 400 }));
          return errorHandler(ctx, e);
        }
      }
      try {
        return await route.handler(ctx);
      } catch (e) {
        return errorHandler(ctx, e);
      }
    }
    return ctx.json(errorPayload(ctx, ERR.NOT_FOUND('no route: ' + req.method + ' ' + ctx.path)), 404);
  };
}

function createServer(app) {
  return http.createServer((req, res) => { Promise.resolve(app(req, res)).catch((e) => { try { errorHandler({ res, headers: req.headers }, e); } catch {} }); });
}

module.exports = { createApp, createServer, CORS };
