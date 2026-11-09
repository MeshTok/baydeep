'use strict';
// L2 网关端到端冒烟（MOCK 模式，node>=16 可跑——自带 http 客户端，不依赖 fetch）：
//   开放层（无 key 健康检查/握手/工具列表/货架搜索）→ trial 领 key → key 层（REST 实时面 + MCP 归因面）。
//   数据落 os.tmpdir 隔离目录，不污染开发数据。
const http = require('http');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = path.join(os.tmpdir(), 'baydeep-smoke-' + Date.now());
process.env.MOCK_MODE = 'true'; // 冒烟固定 MOCK（本机 .env 若为真实模式也不受影响）

const { start } = require('../src/index');
const config = require('../src/config');
require('../scripts/seed-shelf'); // 灌种子货架（同 DATA_DIR）

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}

function req(port, method, p, { body, key } = {}) {
  return new Promise((resolve, reject) => {
    const data = body != null ? JSON.stringify(body) : null;
    const r = http.request({
      host: '127.0.0.1', port, path: p, method,
      headers: {
        ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}),
        ...(key ? { 'x-api-key': key } : {})
      }
    }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => { let j = null; try { j = JSON.parse(buf); } catch {} resolve({ status: res.statusCode, json: j, raw: buf }); });
    });
    r.on('error', reject);
    r.setTimeout(10000, () => { r.destroy(new Error('timeout')); });
    if (data) r.write(data);
    r.end();
  });
}

(async () => {
  console.log('MOCK_MODE =', config.MOCK_MODE, ' DATA_DIR =', config.DATA_DIR);

  console.log('--- 分成规则（3%，佣金率 >3% 参与）---');
  const settlement = require('../src/services/settlement');
  let d = settlement.decorateOrder({ pay_price: 100, commission: 5 });   // 佣金率 5% → 参与
  ok(d.share_eligible === true && d.share_amount === 3 && d.commission_rate_pct === 5, '订单佣金率 5% → 参与分成，分成额 $3');
  d = settlement.decorateOrder({ pay_price: 100, commission: 2 });       // 佣金率 2% → 不参与
  ok(d.share_eligible === false && d.share_amount === 0, '订单佣金率 2% → 不参与，分成 $0');
  d = settlement.decorateOrder({ pay_price: 50, commission: 1.5001 });   // 佣金率 3.0002% → 参与边界
  ok(d.share_eligible === true, '佣金率 3.0002%（>3% 边界）→ 参与');
  d = settlement.decorateOrder({ pay_price: 50, commission: 1.5 });      // 恰好 3% → 不参与（须大于）
  ok(d.share_eligible === false, '佣金率恰 3%（不大于）→ 不参与');
  const sum = settlement.summarize([settlement.decorateOrder({ pay_price: 100, commission: 5 }), settlement.decorateOrder({ pay_price: 100, commission: 2 })]);
  ok(sum.share_eligible_orders === 1 && sum.share_amount_total === 3, '分成汇总：1 笔参与，合计 $3');

  const { server, port } = await start({ port: 0, host: '127.0.0.1' });
  console.log('test server on 127.0.0.1:' + port + '\n');

  const rpc = (p, msg, key) => req(port, 'POST', p, { body: msg, key });

  console.log('--- 开放层（无 key）---');
  let r = await req(port, 'GET', '/healthz');
  ok(r.status === 200 && r.json.data && r.json.data.status === 'ok' && r.json.data.mock === true, 'GET /healthz 200 + mock');

  r = await rpc('/mcp', { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
  ok(r.status === 200 && r.json.result && r.json.result.serverInfo.name === 'baydeep-gateway' && r.json.result.instructions.includes('3%') && r.json.result.instructions.includes('>3%'), 'MCP initialize（含 instructions：3% 分成 + >3% 佣金门槛）');

  r = await rpc('/mcp', { jsonrpc: '2.0', id: 2, method: 'notifications/initialized' });
  ok(r.status === 202, 'MCP notifications/initialized → 202');

  r = await rpc('/mcp', { jsonrpc: '2.0', id: 3, method: 'tools/list' });
  const tools = (r.json.result && r.json.result.tools) || [];
  ok(tools.length === 9 && tools.some((t) => t.name === 'shelf_search') && tools.some((t) => t.name === 'search_products') && tools.some((t) => t.name === 'mint_free_key'), 'MCP tools/list 9 个工具（含自助领 key）');

  r = await rpc('/mcp', { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'shelf_search', arguments: { q: 'bluetooth earphones', page_size: 10 } } });
  const sc = r.json.result && r.json.result.structuredContent;
  // 种子里标题含 bluetooth 的有 3 条（两副耳机 + LED 灯带），耳机（双词命中）排在最前
  ok(r.json.result && !r.json.result.isError && sc && sc.total === 3
    && sc.items[0].goods_id === '1001002' && sc.items[1].goods_id === '1001001',
    'MCP 无 key shelf_search（3 条命中，耳机双词命中排最前）', JSON.stringify(sc && sc.items && sc.items.map((i) => i.goods_id)));

  r = await rpc('/mcp', { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'search_products', arguments: { q: 'led light' } } });
  ok(r.json.result && r.json.result.isError === true && /mint_free_key/.test(r.json.result.content[0].text), 'MCP 无 key 实时工具被 quota-guard 挡下（isError + mint_free_key 指引）');

  // agent 无注册闭环：MCP 内自助领 key → 用 key 调实时工具（yuantoutao 开放层同构 + agent 原生增强）
  r = await rpc('/mcp', { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'mint_free_key', arguments: { client_ref: 'agent-self-serve' } } });
  const minted = r.json.result && r.json.result.structuredContent;
  ok(!r.json.result.isError && minted && minted.key && minted.key.startsWith('ak_bd_') && minted.tier === 't0_free',
    'MCP 无 key 调 mint_free_key 自助领 key（无注册，永久有效）');
  const selfKey = minted && minted.key;
  r = await rpc('/mcp', { jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'search_products', arguments: { q: 'usb c cable' } } }, selfKey);
  ok(r.json.result && !r.json.result.isError && r.json.result.structuredContent && r.json.result.structuredContent.__mock === true,
    'MCP 用自领 key 调实时工具成功（agent 全程无注册闭环）');
  r = await rpc('/mcp', { jsonrpc: '2.0', id: 11, method: 'tools/list' });
  const toolNames = ((r.json.result && r.json.result.tools) || []).map((t) => t.name);
  ok(toolNames.includes('mint_free_key'), 'tools/list 含 mint_free_key（agent 首个可见工具）');

  r = await req(port, 'GET', '/v1/search?q=x');
  ok(r.status === 401 && r.json.code === 'UNAUTHORIZED', 'REST /v1/search 无 key → 401');

  r = await req(port, 'GET', '/v1/shelf?q=phone');
  ok(r.status === 200 && r.json.data.total >= 1, 'REST 无 key /v1/shelf 搜索（seed 命中）');

  console.log('\n--- trial 领 key + key 层 ---');
  r = await req(port, 'POST', '/v1/trial', { body: { client_ref: 'user-1' } });
  const key = r.json && r.json.data && r.json.data.key;
  ok(r.status === 201 && key && key.startsWith('ak_bd_') && r.json.data.tier === 't0_free' && r.json.data.expires === 'never', 'POST /v1/trial 领 key（ak_bd_，永久）');
  ok(r.json.data.agent_id.startsWith('trial-'), '  agent_id 家族 trial-<ipHash>');

  r = await req(port, 'GET', '/v1/me', { key });
  ok(r.status === 200 && r.json.data.tier === 't0_free' && r.json.agent_ref === r.json.data.agent_id, 'GET /v1/me（key 身份 + agent_ref 回显）');

  r = await rpc('/mcp', { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'search_products', arguments: { q: 'smart watch' } } }, key);
  const mockEnv = r.json.result && r.json.result.structuredContent;
  ok(r.json.result && !r.json.result.isError && mockEnv && mockEnv.__mock === true && mockEnv.biz.keywords === 'smart watch', 'MCP 有 key search_products → MOCK 信封（透传签名前参数）');

  r = await req(port, 'GET', '/v1/search?q=smart%20watch&page_size=5', { key });
  ok(r.status === 200 && r.json.code === 'OK' && r.json.data.__mock === true, 'REST 有 key /v1/search → MOCK 信封');

  r = await req(port, 'POST', '/v1/convert', { key, body: { urls: ['https://www.aliexpress.com/item/1001001.html'] } });
  ok(r.status === 200 && r.json.data.__mock === true, 'REST /v1/convert（转链面）');

  const end = new Date().toISOString(), startAt = new Date(Date.now() - 86400e3).toISOString();
  r = await req(port, 'GET', '/v1/orders?start_time=' + startAt + '&end_time=' + end, { key });
  ok(r.status === 200 && r.json.data.__mock === true, 'REST /v1/orders（结算面，MOCK）');

  r = await rpc('/mcp', { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'shelf_item', arguments: { goods_id: '1001003' } } });
  ok(r.json.result && !r.json.result.isError && r.json.result.structuredContent && r.json.result.structuredContent.goods_id === '1001003', 'MCP 无 key shelf_item 详情');

  r = await rpc('/mcp', { jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'nope' } }, key);
  ok(r.json.result && r.json.result.isError === true && /unknown tool/.test(r.json.result.content[0].text), '未知工具 → isError');

  r = await req(port, 'GET', '/v1/hot', { key: 'ak_bd_deadbeefdeadbeefdeadbeefdeadbeef' });
  ok(r.status === 401, '伪造 key → 401');

  server.close();
  console.log('\nsmoke-l2: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('❌', e); process.exit(1); });
