'use strict';
// 零依赖 JSON 文件存储（照抄 baydeep 零依赖路线：本机/服务器无需 npm install 即可跑 L2）。
// collections：keys（agent_keys）/ shelf（统一商品库）。
//   - 读：启动时全量载入内存（10 万级商品 ≈ 数十 MB，单实例足够；上 pg 时替换本文件即可）
//   - 写：内存即写 + 防抖原子落盘（tmp + rename），进程退出 flushAll 兜底
const fs = require('fs');
const path = require('path');
const config = require('./config');

const _collections = new Map();
const _timers = new Map();

function fileOf(name) { return path.join(config.DATA_DIR, name + '.json'); }

function load(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(fileOf(name), 'utf8'));
  } catch { return fallback; }
}

function flush(name, coll) {
  try {
    fs.mkdirSync(config.DATA_DIR, { recursive: true });
    const tmp = fileOf(name) + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(coll.data));
    fs.renameSync(tmp, fileOf(name));
  } catch (e) {
    console.error('[store] flush ' + name + ' failed:', e.message);
  }
}

// 防抖落盘：高频写（货架同步批量 upsert）只在静默 300ms 后写一次
function save(name) {
  const coll = _collections.get(name);
  if (!coll) return;
  clearTimeout(_timers.get(name));
  _timers.set(name, setTimeout(() => { _timers.delete(name); flush(name, coll); }, 300));
}

function flushAll() {
  for (const [name, coll] of _collections) { clearTimeout(_timers.get(name)); flush(name, coll); }
}

function collection(name, fallback) {
  if (_collections.has(name)) return _collections.get(name);
  const coll = { data: load(name, fallback), dirty: false };
  _collections.set(name, coll);
  return coll;
}

process.on('SIGINT', () => { flushAll(); process.exit(0); });
process.on('SIGTERM', () => { flushAll(); process.exit(0); });

module.exports = { collection, save, flushAll };
