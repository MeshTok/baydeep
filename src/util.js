'use strict';
const crypto = require('crypto');
// 错误码与 agentmall util.js 同构（baydeep 网关并入/对接时零转换）
class ApiError extends Error {
  constructor(code, msg, httpStatus = 400) { super(msg); this.code = code; this.httpStatus = httpStatus; }
}
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const randHex = (n) => crypto.randomBytes(n).toString('hex');
// 密钥形态与 agentmall genAgentKey 同构（前缀换 baydeep），明文只此一次展示、落库只存 sha256
function genAgentKey() {
  const raw = 'ak_bd_' + randHex(16);
  return { raw, hash: sha256(raw), prefix: raw.slice(0, 11) };
}
const ERR = {
  INVALID_PARAM: (m) => new ApiError('INVALID_PARAM', m || 'invalid parameter', 400),
  UNAUTHORIZED: (m) => new ApiError('UNAUTHORIZED', m || 'unauthorized', 401),
  RATE_LIMITED: () => new ApiError('RATE_LIMITED', 'rate limited', 429),
  NOT_FOUND: (m) => new ApiError('NOT_FOUND', m || 'not found', 404),
  UPSTREAM_ERROR: (m) => new ApiError('UPSTREAM_ERROR', m || 'upstream fulfillment error', 502),
  INTERNAL: (m) => new ApiError('INTERNAL', m || 'internal error', 500)
};

module.exports = { ApiError, ERR, sha256, randHex, genAgentKey };
