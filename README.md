# BayDeep — Agent 电商网关（海外）

> The e-commerce plugin for AI agents. 商品搜索、比价、购买链接、订单履约——淘宝/京东/拼多多 → 任何 AI Agent。
> 设计文档：agentmall 仓 DESIGN-海外Agent电商网关调研-20261014.md 与 DESIGN-Agent电商网关-20261014.md（副本在 docs/）

## 🌐 Remote MCP Server (live)

**Endpoint**: `https://mcp.baydeep.com/mcp` (Streamable HTTP) · REST: `https://api.baydeep.com/v1`

11 tools: `catalog_overview` (what we sell) · `shelf_search` · `shelf_item` · `flight_search` · `search_products` · `hot_products` · `product_detail` · `convert_link` · `affiliate_orders` · `categories` · `mint_free_key` (zero-signup API key). 5,000+ live products (AliExpress affiliate) + flight fares (Travelpayouts/Aviasales, 40 routes). Consumers shop at [leapbest.com](https://leapbest.com).

```json
{
  "mcpServers": {
    "baydeep": {
      "url": "https://mcp.baydeep.com/mcp"
    }
  }
}
```

## 域名与品牌

- 主域：**baydeep.com**（Deep 家族：FlowDeep 对话 / WorkDeep 办公 / **BayDeep 购物网关**）
- 保留：leapbest.com（未来消费者端 deals 站）
- 端点规划：mcp.baydeep.com（MCP）/ api.baydeep.com（REST）

## 目录结构（2026-11-09 起）

- docs/ — 设计文档与平台调研
- src/adapters/ — L1 平台适配器（照抄 agentmall tbk/jd/pdd.js 模式：call 签名 + normGoods 统一商品协议 + searchGoods/goodsDetail/convertLink/orderDetails）
- src/config.js — env 驱动配置（零依赖 .env 加载）
- src/util.js — 错误码/key 生成（与 agentmall util.js ERR 同构）
- src/store.js — 零依赖 JSON 文件存储（keys/shelf，原子写+防抖落盘；上量后换 pg）
- src/services/ — keys / trial / shelf（货架）/ metrics（调用测量，镜像 agentmall mcp_calls）
- src/middleware.js — 分层限流（t0_free 30rpm / t1_std 60rpm 令牌桶 + keyless IP 30/min）
- src/server.js — 零依赖 HTTP 骨架（CORS/路由/错误协议，替代 express）
- src/routes/v1.js — REST（辅面）· src/routes/mcp.js — MCP JSON-RPC（主面）
- src/index.js — 网关入口 · src/jobs.js — 货架同步任务（独立进程）
- scripts/seed-shelf.js — MOCK 模式货架种子
- test/smoke.js — L1 冒烟 · test/smoke-l2.js — L2 端到端冒烟（18 断言）
- website/ — 官网静态页（部署于硅谷服务器 nginx）

## 站点部署（2026-10-23 上线，硅谷 49.51.201.95）

| 站点 | 内容 | 状态 |
|---|---|---|
| https://baydeep.com | 开发者向英文落地页（价值主张/能力/流程/Deep 家族）+ /llms.txt（GEO） | ✅ HTTPS 200（Let's Encrypt） |
| https://leapbest.com | 消费者 deals 站 coming-soon 占位 | ✅ HTTPS 200 |

部署模式照抄 flowdeep.ai：`/var/www/<域名>` 静态根 + `sites-enabled/<域名>.conf` + certbot（`certonly --nginx`），改页就更新 website/ 再 scp。

## 开发进度

| 项 | 状态 |
|---|---|
| adapters/aliexpress.js（搜索/热销/详情/转链/类目/订单） | ✅ 代码完成 + **真实联调通过**（2026-11-09 晚） |
| L2 网关（统一商品库/开放分层/MCP+REST） | ✅ 真实数据端到端通过：货架 593 件真实商品，trial key→search/shelf/item/MCP 全链路 OK |
| 真实 API 联调 | ✅ AppKey `558366`（BayDeep Agent Gateway，Default 包 Active），凭据在 .env（gitignored） |
| Portals tracking id（转链归因） | ✅ **已完成**（2026-11-09）：主号 `default` + 池号 `baydeep_dev1/baydeep_dev2`（已入 .env）；**转链实测通过**（批量 s.click 短链） |
| Advanced API（hotproduct 热销榜） | ⏳ 待申请：App Overview → API Permission Group → Advanced API Apply（要填 Portals 注册邮箱） |
| 订单接口参数 | ⚠️ 方法名已实测为 `order.get`，但参数格式 406 待官方文档核对（有订单流量后再调） |
| 网关部署（硅谷服务器 node/pm2 → mcp/api.baydeep.com） | ✅ **已上线**（2026-11-09，pm2:8821 + nginx + Let's Encrypt；shelf 5022） |

### 真实联调实录（2026-11-09，AppKey 558366）

- ✅ `categories`：564 类目
- ✅ `searchGoods`：真实商品（价格/佣金率正常回传，佣金 7% > 3% 分成门槛）
- ✅ `goodsDetail`：**方法名实测为 `aliexpress.affiliate.productdetail.get`**（文档旧名 `product.detail.get` 报 InvalidApiPath）
- ⏳ `convertLink`：参数实测为 `source_values`（`urls` 已废弃）+ **tracking_id 官方强制必填**——适配器已按新参数实现并在缺 tracking id 时本地拦截
- ❌ `hotProducts`：`InsufficientPermission`——在 Advanced 包，需申请（申请时填 Portals 注册邮箱）
- ⚠️ `orderDetails`：方法名实测为 `aliexpress.affiliate.order.get`，406 参数待核
- 货架：`jobs.syncOnce` 一轮 **593 件真实商品**入库；2026-11-09 `scripts/expand-shelf.js`（93 词 ×2 页）扩充至 **5022 件**，服务器每日 03:30 cron 自动续扩
- 适配器自带 node<18 fetch/AbortSignal polyfill——**本机 node16 即可跑网关与联调**（服务器无需升级）

### L2 网关（2026-11-09 落地，agentmall 架构海外镜像，零依赖 node>=16 直跑）

**开放分层**（与国内源头淘同构 + agent 原生增强）：

| 层 | 门槛 | 能力 |
|---|---|---|
| 公开只读 | 无（IP 30/min） | MCP initialize/tools/list + shelf_search/shelf_item（本地货架，不烧平台配额） |
| 免费 key | **零注册**：MCP 内直接调 `mint_free_key` 工具自助领取（agent 无需离开协议通道）；HTTP 兼容 `POST /v1/trial`。永久有效 | 全 9 工具 + AliExpress 实时扇出 + tracking_id 归因 |
| 绑定提现 | 控制台（结算里程碑落地） | 分成提现（**成交额 3%**，仅佣金率 **>3%** 的商品参与——`settlement.js` 统一口径） |

**MCP 工具**（9 个）：`mint_free_key`（无 key 自助领 key，agent 无注册闭环的入口）· `shelf_search` / `shelf_item`（无 key）· `search_products` / `hot_products` / `product_detail` / `convert_link` / `affiliate_orders` / `categories`（key）

**归因**：AliExpress 联盟只有 tracking_id 一级归因（无 jd subUnionId/pdd customParameters 子位）→ 每个 agent_key 创建时从 `ALIEXPRESS_TRACKING_IDS` 池领一个号，转链/搜索/订单全带它，订单按号回滤到 key；池留空则共享主号（`/v1/me` 返回 attribution 模式说明）。

**存储**：data/ 下 JSON 文件（keys.json / shelf.json + mcp_calls.ndjson 测量流），原子写+防抖落盘，进程退出 flush；货架 10 万级商品内存索引足够，上量换 pg（agentmall 同款）。

**本地运行**：

```bash
node test/smoke-l2.js    # 端到端冒烟（固定 MOCK，node>=16，23 断言；.env 为真实模式也不受影响）
node scripts/seed-shelf.js && node src/index.js   # 起网关（默认 127.0.0.1:8787）
node test/live-call.js   # 真实 API 快速联调（搜索+类目）
node test/live-probe.js  # L1 六方法能力探测（真实凭据下哪些可用/被挡）
node src/jobs.js         # 货架定时同步（真实模式：每小时 hot 榜+关键词池）
```

**端点**：`POST /mcp`（JSON-RPC）· `POST /mcp/trial` · `GET /v1/search|hot|item/:id|orders|categories|shelf|me` · `POST /v1/trial|convert` · `GET /healthz`

### 真实联调步骤（AppKey 已配好，.env 里 MOCK_MODE=false）

```bash
node test/live-probe.js   # 一眼看全六个方法可用性
node src/jobs.js          # 货架真实数据同步（tracking id 不影响搜索/详情/货架）
# 转链需先建 tracking id：portals.aliexpress.com → Tracking ID → 填入 .env ALIEXPRESS_TRACKING_ID
```

## 联盟账号进度（2026-10-23 注册清单移交用户执行）

| 平台 | 注册入口 | 状态 |
|---|---|---|
| AliExpress Portals（联盟） | https://portals.aliexpress.com | 🔄 用户注册中（10-23 实测：unly1130@gmail.com 已有账号壳，用「Use confirmation code instead」邮箱确认码登录，无需密码） |
| AliExpress 开放平台（AppKey） | https://openservice.aliexpress.com | 🔄 用户注册中：开发者类型=Dropshipping/Affiliates → Affiliates (individual)，Country=China，数据处理地=United States，合规四题全 No；创建应用后申请「aliexpress.affiliate」产品包权限 |
| Payoneer（收 eBay 等） | https://www.payoneer.com | ⏳ 待注册 |
| WorldFirst 万里汇（收阿里系） | https://www.worldfirst.com | ⏳ 待注册 |
| eBay ePN | https://partnernetwork.ebay.com | ⏳ 待注册（Payoneer 通道已核实） |
| Temu affiliate | https://affiliate.temu.com | ⏳ 待注册 |
| TikTok Shop 联盟 | https://partner.tiktokshop.com | ⏳ 待评估（seller-gated） |

## 开发者价值主张

> Monetize your AI agent — earn 3% on every purchase (commission-eligible items, commission rate >3%). 一个 MCP/REST 接入百万级商品池。
