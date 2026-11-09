'use strict';
// BayDeep L2 网关入口：REST(/v1) + MCP(/mcp) 同进程（国内 index.js 语义，骨架零依赖）
const config = require('./config');
const { createApp, createServer } = require('./server');
const v1 = require('./routes/v1');
const mcp = require('./routes/mcp');

function buildApp() {
  return createApp([...v1.routes(), ...mcp.routes()]);
}

// opts.port=0 时由系统分配（测试用）；resolve({server, port})
function start(opts = {}) {
  const server = createServer(buildApp());
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port || config.PORT, opts.host || config.HOST, () => resolve({ server, port: server.address().port }));
  });
}

if (require.main === module) {
  start().then(({ port }) => {
    console.log('[baydeep] gateway on http://' + config.HOST + ':' + port + '  MOCK_MODE=' + config.MOCK_MODE + '  shelf=' + JSON.stringify(require('./services/shelf').stats()));
    console.log('[baydeep] endpoints: POST /mcp (JSON-RPC)  GET /v1/search|hot|item|orders  POST /v1/trial|convert');
  }).catch((e) => { console.error('[baydeep] boot failed:', e.message); process.exit(1); });
}

module.exports = { buildApp, start };
