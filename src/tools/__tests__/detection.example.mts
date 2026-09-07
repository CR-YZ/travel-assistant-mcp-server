/**
 * detection.example.mts —— 自测 / 用法示例（跑通 normalize + anomaly 核心逻辑）
 *
 * 运行方式（Node >= 23.6 原生 TS 支持）：
 *   node src/tools/__tests__/detection.example.mts
 *
 * 注意：本文件用 .mts 后缀以强制 ESM，并显式带 .ts 扩展名导入相对模块；
 * 运行时会输出一条 MODULE_TYPELESS_PACKAGE_JSON 警告，属预期、无副作用。
 *
 * 目的：验证 price-normalize + anomaly 的「到手价 / hidden_gap / 三档判定 / 中文判决」符合
 * 《04-tech-data-plan.md》第 3/4 节的示例语义。
 */

import {
  normalizePrice,
  normalizeHotelTotalRate,
  normalizeHotelRatePerNight,
  normalizeMany,
} from "../price-normalize.ts";
import { detectAnomalies, effectiveTotal } from "../anomaly.ts";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

function banner(title: string): void {
  console.log(`\n===== ${title} =====`);
}

/* ------------------------------------------------------------------ *
 * 1) price-normalize：归一化
 * ------------------------------------------------------------------ */
banner("price-normalize 归一化");

// 酒店 total_rate（整段）：before_taxes_fees 当 base，lowest 当含税标价。
const hotelProp = {
  currency: "CNY",
  total_rate: { before_taxes_fees: 625, lowest: 1055 },
  rate_per_night: { before_taxes_fees: 625, lowest: 1055 },
};
const norm = normalizeHotelTotalRate(hotelProp);
console.log("酒店 total_rate 归一化:", JSON.stringify(norm));
assert(norm.components.base.value === 625, "酒店 base 应为 625");
assert(norm.components.taxes_fees.value === 430, "酒店 税+服务费 应为 430");
assert(norm.total_all_in === 1055, "酒店 到手价 应为 1055");
assert(norm.hidden_gap === 430, "酒店 hidden_gap 应为 430（税+捆绑）");

// rate_per_night（每晚）适配器：用 lowest 当含税标价。
const nightly = normalizeHotelRatePerNight(hotelProp);
console.log("酒店 rate_per_night 归一化 total_all_in:", nightly.total_all_in);
assert(nightly.total_all_in === 1055, "rate_per_night 归一化 到手价 应为 1055");

// 显式成分输入（裸价 + 行李 + 服务费 + 自选加购）。
const explicit = normalizePrice({
  currency: "CNY",
  base: 388,
  taxes_fees: 96,
  baggage: 0,
  booking_extra: 0,
  bundle: 0,
});
console.log("显式成分归一化:", JSON.stringify(explicit));
assert(explicit.subtotal_before_tax === 388, "subtotal_before_tax 应为 388");
assert(explicit.total_all_in === 484, "total_all_in 应为 484");
assert(explicit.hidden_gap === 96, "hidden_gap 应为 96");

// 航班：price 视为含税总价做 base。
const flightNorm = normalizePrice({ currency: "CNY", base: 1200, baggage: 200 });
console.log("航班归一化:", JSON.stringify(flightNorm));
assert(flightNorm.total_all_in === 1400, "航班 到手价 应为 1400");

// 多卖家批量归一化。
const many = normalizeMany([
  { source: "google", currency: "CNY", before_taxes_fees: 625, lowest: 1055 },
  { source: "google", currency: "CNY", before_taxes_fees: 700, lowest: 890 },
]);
assert(many.length === 2, "批量归一化应为 2 条");
console.log("批量归一化 total_all_in:", many.map((m) => m.total_all_in));

/* ------------------------------------------------------------------ *
 * 2) anomaly：异常检测（含 doc 示例的「同程 430 vs 正常 180」）
 * ------------------------------------------------------------------ */
banner("anomaly 异常检测");

const anchor = 809; // 可信锚点基准价

const candidates = [
  {
    id: "ctrip",
    channel: "携程",
    currency: "CNY",
    base: 650,
    taxes_fees: 180,
    total_all_in: 830,
    listed_price: 810, // 830/810 → 2.5% 跳变，不触发
  },
  {
    id: "tongcheng",
    channel: "同程",
    currency: "CNY",
    base: 625,
    taxes_fees: 430,
    total_all_in: 1055,
    listed_price: 1020, // (1055-1020)/1020 → 3.4% 不触发
    // 期望：税费注水 (430 是 180 的 2.4 倍) + 偏离锚点 (>30%) → danger
  },
  {
    id: "feizhu",
    channel: "飞猪",
    currency: "CNY",
    base: 680,
    taxes_fees: 180,
    total_all_in: 860,
    listed_price: 780, // (860-780)/780 → 10.3% 跳变 → caution
    has_default_addon: true,
    addon_items: [{ name: "延误险", price: 58, is_default: true }],
  },
  {
    id: "qunar",
    channel: "去哪儿",
    currency: "CNY",
    base: 700,
    taxes_fees: 190,
    total_all_in: 890,
    listed_price: 890,
  },
];

const report = detectAnomalies(candidates, anchor);
console.log("锚点价:", report.anchor_price);
console.log("汇总:", JSON.stringify(report.summary));
console.log("建议:", report.recommendation);

for (const r of report.results) {
  console.log(`\n${r.emoji} [${r.severity}] ${r.channel} → ${r.verdict}`);
  console.log(`   判决: ${r.judgement}`);
  console.log(`   触发规则: ${r.rules.map((x) => `${x.rule}(${x.severity})`).join(", ") || "无"}`);
}

// 断言关键语义
const byChannel = new Map(report.results.map((r) => [r.channel, r]));
assert(byChannel.get("同程")!.severity === "danger", "同程应判为 danger");
assert(byChannel.get("同程")!.judgement.includes("2.4 倍"), "同程判决应包含『2.4 倍』");
assert(byChannel.get("携程")!.severity === "clean", "携程应判为 clean");
assert(byChannel.get("飞猪")!.severity === "caution", "飞猪应判为 caution（跳变+搭售）");
assert(byChannel.get("去哪儿")!.severity === "clean", "去哪儿应判为 clean");

// effectiveTotal 独立校验
assert(effectiveTotal({ channel: "x", total_all_in: 1055 }) === 1055, "effectiveTotal 取 total_all_in");

// 无锚点时自动用中位数（应仍能跑通，不抛错）
const noAnchor = detectAnomalies(candidates);
assert(noAnchor.results.length === 4, "无锚点时仍应返回 4 条");
console.log("\n[无锚点] 自动锚点:", noAnchor.anchor_price);

console.log("\n✅ 全部断言通过：normalize / anomaly 核心逻辑符合文档语义。");
