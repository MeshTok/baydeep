'use strict';
const path = require('path');
const fs = require('fs');

// 零依赖 .env 加载（本机无独立 npm；L2 网关上 NJ 后可换 dotenv，行为一致：不覆盖已存在的 env）
const envPath = path.join(__dirname, '..', '.env');
try {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* 无 .env 则走默认值（MOCK_MODE） */ }

const MOCK_MODE = String(process.env.MOCK_MODE || 'true') === 'true';

module.exports = {
  MOCK_MODE,
  // ---- L2 网关 ----
  PORT: parseInt(process.env.PORT || '8787', 10),
  HOST: process.env.HOST || '127.0.0.1',
  DATA_DIR: process.env.DATA_DIR || require('path').join(__dirname, '..', 'data'),
  PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL || 'https://api.baydeep.com',
  TRIAL_SALT: process.env.TRIAL_SALT || 'baydeep-trial-v1',
  MINT_PER_IP_PER_DAY: parseInt(process.env.MINT_PER_IP_PER_DAY || '5', 10),
  // 货架同步（jobs.js：真实模式下每小时拉 hot + 关键词池入库）
  SYNC_INTERVAL_MIN: parseInt(process.env.SYNC_INTERVAL_MIN || '60', 10),
  SYNC_KEYWORDS: (process.env.SYNC_KEYWORDS || 'bluetooth earphones,smart watch,phone case,led light,home organizer,car accessories,kitchen gadgets,fitness tracker,usb c charger,mini projector,pet supplies,camping gear')
    .split(',').map((s) => s.trim()).filter(Boolean),
  SHELF_MAX: parseInt(process.env.SHELF_MAX || '100000', 10),
  ALIEXPRESS: {
    APP_KEY: process.env.ALIEXPRESS_APP_KEY || '',
    APP_SECRET: process.env.ALIEXPRESS_APP_SECRET || '',
    // Portals tracking id（归因子号，转链/搜索链接都带它才算佣金）
    TRACKING_ID: process.env.ALIEXPRESS_TRACKING_ID || '',
    // 按开发者归因的 tracking id 池（逗号分隔；Portals 后台逐个创建）。
    // AliExpress 联盟链路只有 tracking_id 一级归因（无 jd subUnionId/pdd customParameters 的子位），
    // 所以每个 agent_key 领一个池中 tracking_id，订单按 tracking_id 回滤到 key。
    TRACKING_IDS: (process.env.ALIEXPRESS_TRACKING_IDS || '').split(',').map((s) => s.trim()).filter(Boolean),
    SHIP_TO: process.env.ALIEXPRESS_SHIP_TO || 'US',
    TARGET_CURRENCY: process.env.ALIEXPRESS_TARGET_CURRENCY || 'USD',
    TARGET_LANGUAGE: process.env.ALIEXPRESS_TARGET_LANGUAGE || 'EN',
    SIGN_METHOD: process.env.ALIEXPRESS_SIGN_METHOD || 'hmac-sha256' // hmac-sha256 | md5
  }
};
