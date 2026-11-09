'use strict';
// 调用测量（镜像 agentmall mcp_calls 表——044 决策海外同构）：NDJSON 追加落盘，fire-and-forget 不阻塞。
// 用途：搜索量/成功率/工具误用率/渠道识别（UA），后续控制台与结算看板的数据源。
const fs = require('fs');
const path = require('path');
const config = require('../config');

function log(row) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...row }) + '\n';
  fs.appendFile(path.join(config.DATA_DIR, 'mcp_calls.ndjson'), line, () => {});
}

// 包一层调用计时：fn 通常抛错或返回，is_error/err_brief 自动记
async function timed(row0, fn) {
  const t0 = Date.now();
  try {
    const data = await fn();
    log({ ...row0, latency_ms: Math.min(Date.now() - t0, 600000), is_error: false });
    return data;
  } catch (e) {
    log({ ...row0, latency_ms: Math.min(Date.now() - t0, 600000), is_error: true, err_brief: String(e.message || 'failed').slice(0, 200) });
    throw e;
  }
}

module.exports = { log, timed };
