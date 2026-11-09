'use strict';
// 免注册开放层（镜像 agentmall services/trial.js——2026-10-14 开放分层同构海外）：
//   free key：永不过期、全工具开放、30 req/min；唯一门槛=提现需绑定开发者账号（控制台/结算面后续挂）。
//   IP 限发仅防灌水（默认 5 把/IP/日）。
const crypto = require('crypto');
const config = require('../config');
const { ERR } = require('../util');
const keys = require('./keys');

const CLIENT_REF_RE = /^[A-Za-z0-9-]{1,40}$/;

function ipHash(ip) {
  return crypto.createHmac('sha256', config.TRIAL_SALT).update(String(ip || 'unknown')).digest('hex').slice(0, 16);
}
function familyId(ip) { return 'trial-' + ipHash(ip); }

const mints = new Map(); // day:ip -> count（单实例进程内存足够，与国内一致）
function mintLimited(ip) {
  const day = new Date().toISOString().slice(0, 10);
  const k = day + ':' + ip;
  const n = (mints.get(k) || 0) + 1;
  mints.set(k, n);
  if (mints.size > 5000) for (const [kk] of mints) if (!kk.startsWith(day)) mints.delete(kk);
  return n <= config.MINT_PER_IP_PER_DAY;
}

function mintTrial(ip, clientRef) {
  if (!mintLimited(ip)) {
    throw Object.assign(new Error('trial key mint limit reached today (' + config.MINT_PER_IP_PER_DAY + '/IP). Your earlier keys remain valid forever.'),
      { code: 'RATE_LIMITED', httpStatus: 429 });
  }
  const agentId = familyId(ip);
  // default_client_ref（国内 048 同构）：领 key 时可自带终端用户标识，调用未显式传时服务端回填
  const validRef = CLIENT_REF_RE.test(String(clientRef || '')) ? String(clientRef).slice(0, 40) : null;
  const k = keys.createKey({ agent_id: agentId, name: 'free (no-signup)', platform: 'trial', rate_tier: 't0_free', default_client_ref: validRef });
  return {
    key: k.key,
    agent_id: agentId,
    tier: 't0_free',
    rate_limit: '30 req/min',
    expires: 'never',
    tools: 'all tools enabled',
    tracking_id: k.tracking_id || null,
    attribution: k.tracking_id
      ? 'purchases via this key\'s links carry tracking_id=' + k.tracking_id + ' — orders come back filtered to your key'
      : 'shared default tracking id (per-key attribution activates once a tracking id pool is configured)',
    upgrade: {
      why: 'bind a developer account to withdraw your share (3% of attributed purchase volume; only orders on products with commission rate >3% participate)',
      note: 'settlement/console endpoint lands with the L2 billing milestone'
    }
  };
}

module.exports = { mintTrial, familyId, CLIENT_REF_RE };
