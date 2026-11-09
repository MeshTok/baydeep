'use strict';
// agent key 管理（镜像 agentmall services/agentkeys.js 语义，存储换文件货架 store）：
//   - 一个 agent_id 家族一把 key（重复领=换新明文，家族不变，与国内 ON CONFLICT(agent_id) 行为一致）
//   - 明文只此一次展示，落盘只存 sha256 + 11 位前缀
//   - 创建时从 tracking id 池领一个归因号（AliExpress 只有 tracking_id 一级归因，
//     没有 jd subUnionId / pdd customParameters 那种子位——按开发者归因靠池号，订单按号回滤）
const config = require('../config');
const { genAgentKey } = require('../util');
const store = require('../store');

const coll = store.collection('keys', { keys: [] });

function findByRaw(raw) {
  const h = require('../util').sha256(String(raw || ''));
  return coll.data.keys.find((k) => k.key_hash === h && k.status === 'active') || null;
}

function findById(id) { return coll.data.keys.find((k) => k.id === id) || null; }

// tracking id 池分配：取当前在用 key 最少的号（keyless 共享默认主号，不占池）
function pickTrackingId() {
  const pool = config.ALIEXPRESS.TRACKING_IDS;
  if (!pool.length) return null;
  const used = new Map(pool.map((t) => [t, 0]));
  for (const k of coll.data.keys) {
    if (k.status === 'active' && k.tracking_id && used.has(k.tracking_id)) used.set(k.tracking_id, used.get(k.tracking_id) + 1);
  }
  let best = pool[0];
  for (const t of pool) if (used.get(t) < used.get(best)) best = t;
  return best;
}

function createKey({ agent_id, name, platform, rate_tier, default_client_ref }) {
  const { raw, hash, prefix } = genAgentKey();
  const now = new Date().toISOString();
  const existing = coll.data.keys.find((k) => k.agent_id === agent_id);
  let row;
  if (existing) {
    // 家族重领：换明文/哈希，其余身份与归因号保持（历史佣金跟随家族）
    Object.assign(existing, {
      key_hash: hash, key_prefix: prefix, status: 'active',
      rate_tier: rate_tier || existing.rate_tier || 't0_free',
      default_client_ref: default_client_ref || existing.default_client_ref || null,
      updated_at: now
    });
    row = existing;
  } else {
    row = {
      id: coll.data.keys.reduce((m, k) => Math.max(m, k.id || 0), 0) + 1,
      agent_id, name: name || agent_id, platform: platform || 'other',
      key_hash: hash, key_prefix: prefix, rate_tier: rate_tier || 't0_free',
      tracking_id: pickTrackingId(),
      default_client_ref: default_client_ref || null,
      status: 'active', created_at: now, updated_at: now
    };
    coll.data.keys.push(row);
  }
  store.save('keys');
  return { ...row, key: raw }; // 明文只此一次
}

function setKeyStatus(agentId, status) {
  const k = coll.data.keys.find((x) => x.agent_id === agentId);
  if (k) { k.status = status; k.updated_at = new Date().toISOString(); store.save('keys'); }
  return k || null;
}

module.exports = { findByRaw, findById, createKey, setKeyStatus };
