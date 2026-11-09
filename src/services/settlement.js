'use strict';
// 开发者分成规则（2026-11-09 用户令，替代设计稿 5% 方案）：
//   分成比例 = 成交额 3%；门槛 = 仅佣金率 >3% 的商品参与分成（低佣商品平台佣金覆盖不了成本，不参与）。
//   口径：订单佣金率 ≈ commission_amount / order_amount（AliExpress 订单接口不回佣金率字段，用两额比值还原）；
//   佣金字段缺失时 share_eligible=null（无法判定，不计入分成汇总）。
//   ⚠️ agent 侧永不向消费者出现返利/返现话术（红线 §四.3）——分成是开发者的经营收入。
const SHARE_RATE = 0.03;        // 开发者分成 3%
const MIN_COMMISSION_PCT = 3;   // 商品佣金率须 >3% 才参与

// 单笔订单装饰：还原佣金率 → 是否参与分成 → 该笔开发者分成额
function decorateOrder(o) {
  const amt = o.pay_price, comm = o.commission;
  let rate = null, eligible = null;
  if (amt != null && comm != null && Number(amt) > 0) {
    const rawPct = (Number(comm) / Number(amt)) * 100;
    rate = Math.round(rawPct * 100) / 100;          // 展示用两位百分数
    eligible = rawPct > MIN_COMMISSION_PCT;         // 门槛用原始比值判（先取整会吃掉 3.0002% 这类边界）
  }
  return {
    ...o,
    commission_rate_pct: rate,
    share_eligible: eligible,
    share_amount: eligible ? Math.round(Number(amt) * SHARE_RATE * 100) / 100 : 0
  };
}

// 分页汇总：开发者当页分成合计（结算面月结的数据源）
function summarize(list) {
  const rows = (list || []).filter((o) => o.share_eligible === true);
  return {
    share_rate_pct: SHARE_RATE * 100,
    min_commission_pct: MIN_COMMISSION_PCT,
    orders_total: (list || []).length,
    share_eligible_orders: rows.length,
    purchase_amount_eligible: Math.round(rows.reduce((s, o) => s + (Number(o.pay_price) || 0), 0) * 100) / 100,
    share_amount_total: Math.round(rows.reduce((s, o) => s + (o.share_amount || 0), 0) * 100) / 100,
    note: 'share applies only to orders whose product commission rate > ' + MIN_COMMISSION_PCT + '%; monthly settlement (billing milestone pending)'
  };
}

// 订单列表统一出口：装饰每笔 + 附当页汇总
function decorateOrderPage(r) {
  if (!r || !Array.isArray(r.list)) return r; // MOCK 信封等非列表形态原样透传
  return { ...r, list: r.list.map(decorateOrder), share_summary: summarize(r.list) };
}

module.exports = { SHARE_RATE, MIN_COMMISSION_PCT, decorateOrder, summarize, decorateOrderPage };
