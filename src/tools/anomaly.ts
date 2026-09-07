/**
 * anomaly.ts —— 异常检测引擎（差异化核心）
 *
 * 对齐《04-tech-data-plan.md》第 4 节规则表，用「真实成分」做基准，识别注水/捆绑/跳变：
 *
 * | 规则        | 触发条件                                      | 判定 |
 * |-------------|-----------------------------------------------|------|
 * | 税费注水    | 某平台 taxes_fees > 其他平台中位数 ×2          | 🚨 danger |
 * | 默认搭售    | 检测到默认勾选的保险/延误/接送                 | ⚠️ caution |
 * | 标价跳变    | 列表价 vs 支付价跳变 >10%                     | ⚠️ caution |
 * | 偏离锚点    | 某渠道总价 vs 可信锚点价差异常（严重偏高）      | 🚨 danger |
 *
 * 输出：给每条候选打 clean / caution / danger 三档，并输出面向用户的中文判决字符串。
 *
 * 本模块是纯函数，不触碰网络；输入通常来自 price-normalize 的归一化结果或
 * search_flights / search_hotels 的候选对象（见 SRC_TOOLS_NOTES.md）。
 */

import { z } from "zod";

/* ------------------------------------------------------------------ *
 * 阈值与规则常量
 * ------------------------------------------------------------------ */

/** 税费注水：某平台 taxes_fees 超过其他平台中位数的倍数。 */
export const TAX_INFLATION_MULTIPLIER = 2;
/** 标价跳变：列表价 → 支付价超过 10% 即提示。 */
export const PRICE_JUMP_THRESHOLD = 0.1;
/** 偏离锚点：总价高于可信锚点 30% 视为严重偏高（danger）。 */
export const ANCHOR_DANGER_PCT = 0.3;
/** 偏离锚点：总价高于可信锚点 15% 视为偏高（caution）。 */
export const ANCHOR_CAUTION_PCT = 0.15;

/** 严重等级排序权重（用于把最危规则排在判决字符串首位）。 */
const SEVERITY_RANK: Record<Severity, number> = {
  danger: 3,
  caution: 2,
  clean: 1,
};

/** 默认搭售关键词（命中即判定为默认勾选附加服务）。 */
const ADDON_KEYWORDS = [
  "保险",
  "延误",
  "接送",
  "意外险",
  "取消险",
  "延保",
  "会员",
  "优选",
  "服务费",
];

export const RuleKey = {
  TAX_INFLATION: "tax_inflation",
  DEFAULT_ADDON: "default_addon",
  PRICE_JUMP: "price_jump",
  ANCHOR_DEVIATION: "anchor_deviation",
} as const;

export type RuleKey = (typeof RuleKey)[keyof typeof RuleKey];

export const Severity = {
  CLEAN: "clean",
  CAUTION: "caution",
  DANGER: "danger",
} as const;

export type Severity = (typeof Severity)[keyof typeof Severity];

/** 严重等级 → 语义标牌。 */
export const SEVERITY_EMOJI: Record<Severity, string> = {
  clean: "✅",
  caution: "⚠️",
  danger: "🚨",
};

export const SEVERITY_VERDICT: Record<Severity, string> = {
  clean: "价格正常，推荐",
  caution: "有疑点，核对后再付",
  danger: "疑似注水，别买",
};

/* ------------------------------------------------------------------ *
 * Zod schema
 * ------------------------------------------------------------------ */

/** 单项默认搭售内容。 */
export const AddonItemSchema = z.object({
  name: z.string(),
  price: z.number(),
  is_default: z.boolean().optional(),
});
export type AddonItem = z.infer<typeof AddonItemSchema>;

/** 参与异常检测的单条候选（通常是归一化后的价格对象 + 列表/支付价 + 搭售信息）。 */
export const AnomalyCandidateSchema = z.object({
  id: z.string().optional(),
  channel: z.string(),
  currency: z.string().optional(),
  base: z.number().optional(),
  taxes_fees: z.number().optional(),
  baggage: z.number().optional(),
  booking_extra: z.number().optional(),
  bundle: z.number().optional(),
  /** 支付价/到手价（= total_all_in）。 */
  total_all_in: z.number().optional(),
  /** 列表价/标价（用于标价跳变）。 */
  listed_price: z.number().optional(),
  /** 是否默认勾选附加服务。 */
  has_default_addon: z.boolean().optional(),
  addon_items: z.array(AddonItemSchema).optional(),
});
export type AnomalyCandidate = z.infer<typeof AnomalyCandidateSchema>;

/** 单条触发规则。 */
export const TriggeredRuleSchema = z.object({
  rule: z.enum([RuleKey.TAX_INFLATION, RuleKey.DEFAULT_ADDON, RuleKey.PRICE_JUMP, RuleKey.ANCHOR_DEVIATION]),
  severity: z.enum([Severity.CLEAN, Severity.CAUTION, Severity.DANGER]),
  message: z.string(),
});
export type TriggeredRule = z.infer<typeof TriggeredRuleSchema>;

/** 每条候选的判定结果。 */
export const AnomalyVerdictSchema = z.object({
  id: z.string(),
  channel: z.string(),
  currency: z.string().optional(),
  severity: z.enum([Severity.CLEAN, Severity.CAUTION, Severity.DANGER]),
  emoji: z.string(),
  /** 短标签，如“价格正常，推荐”。 */
  verdict: z.string(),
  /** 面向用户的中文判决字符串（含 emoji 前缀）。 */
  judgement: z.string(),
  total_all_in: z.number(),
  rules: z.array(TriggeredRuleSchema),
});
export type AnomalyVerdict = z.infer<typeof AnomalyVerdictSchema>;

/** 完整异常检测报告。 */
export const AnomalyReportSchema = z.object({
  anchor_price: z.number().optional(),
  rules_skipped: z.array(z.string()),
  results: z.array(AnomalyVerdictSchema),
  summary: z.object({
    clean: z.number(),
    caution: z.number(),
    danger: z.number(),
  }),
  /** 总体建议（优先给出一条最稳渠道）。 */
  recommendation: z.string(),
});

export type AnomalyReport = z.infer<typeof AnomalyReportSchema>;

/* ------------------------------------------------------------------ *
 * 工具函数
 * ------------------------------------------------------------------ */

function median(nums: number[]): number {
  const list = nums.filter((n) => Number.isFinite(n) && n > 0);
  if (list.length === 0) return 0;
  const sorted = [...list].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** 候选的有效总价（优先 total_all_in，其次成分求和，再退回列表价）。 */
export function effectiveTotal(c: AnomalyCandidate): number {
  if (c.total_all_in != null) return c.total_all_in;
  const sum =
    (c.base ?? 0) + (c.taxes_fees ?? 0) + (c.baggage ?? 0) + (c.booking_extra ?? 0);
  if (sum > 0) return round2(sum);
  return c.listed_price ?? 0;
}

function pickSeverity(severities: Severity[]): Severity {
  if (severities.includes("danger")) return "danger";
  if (severities.includes("caution")) return "caution";
  return "clean";
}

/* ------------------------------------------------------------------ *
 * 核心检测
 * ------------------------------------------------------------------ */

/**
 * 检测一组候选价格的异常，返回每条的 severity + 面向用户的中文判决字符串。
 *
 * @param prices      候选价格列表（可来自 normalized 结果或 SerpAPI 候选）。
 * @param anchorPrice 可信锚点价（可选）。传 price_insights.lowest_price；
 *                    不传则用候选总价的中位数作为锚点。
 * @returns AnomalyReport
 */
export function detectAnomalies(
  prices: AnomalyCandidate[],
  anchorPrice?: number
): AnomalyReport {
  const rulesSkipped: string[] = [];
  const totals = prices.map(effectiveTotal).filter((t) => t > 0);
  // 锚点：优先外部可信锚点，否则用候选总价中位数。
  const anchor = anchorPrice ?? median(totals);

  const results: AnomalyVerdict[] = prices.map((candidate, idx) => {
    const id = candidate.id ?? candidate.channel ?? `candidate_${idx}`;
    const total = effectiveTotal(candidate);
    const rules: TriggeredRule[] = [];
    const severities: Severity[] = [];

    // 1) 税费注水：某平台 taxes_fees > 其他平台中位数 ×2 → danger
    const othersTaxes = prices
      .filter((p, i) => i !== idx)
      .map((p) => p.taxes_fees ?? 0)
      .filter((t) => t > 0);
    const normalTax = median(othersTaxes);
    const taxes = candidate.taxes_fees ?? 0;
    if (normalTax > 0 && taxes > normalTax * TAX_INFLATION_MULTIPLIER) {
      const ratio = taxes / normalTax;
      const msg = `${SEVERITY_EMOJI.danger} ${candidate.channel}机建+燃油 ¥${round2(
        taxes
      )} 是正常 ¥${round2(normalTax)} 的 ${ratio.toFixed(1)} 倍，疑似注水，别买。`;
      rules.push({ rule: RuleKey.TAX_INFLATION, severity: "danger", message: msg });
      severities.push("danger");
    } else if (othersTaxes.length === 0 && taxes > 0) {
      // 没有其他平台可对比（其余为空/无税）—— 标记为需人工核实的 caution。
      const msg = `${SEVERITY_EMOJI.caution} ${candidate.channel}机建+燃油 ¥${round2(
        taxes
      )} 缺少可比基准，建议核对是否含税。`;
      rules.push({ rule: RuleKey.TAX_INFLATION, severity: "caution", message: msg });
      severities.push("caution");
    }

    // 2) 默认搭售：检测到默认勾选的保险/延误/接送 → caution
    const defaultAddons = (candidate.addon_items ?? []).filter(
      (i) => i.is_default !== false && ADDON_KEYWORDS.some((k) => i.name.includes(k))
    );
    if (candidate.has_default_addon === true || defaultAddons.length > 0) {
      const target = defaultAddons[0];
      const name = target?.name ?? "附加服务";
      const price = round2(target?.price ?? candidate.bundle ?? 0);
      const msg = `${SEVERITY_EMOJI.caution} ${candidate.channel}默认搭售${name} ¥${price}，点掉再付。`;
      rules.push({ rule: RuleKey.DEFAULT_ADDON, severity: "caution", message: msg });
      severities.push("caution");
    }

    // 3) 标价跳变：列表价 vs 支付价跳变 >10% → caution
    const listed = candidate.listed_price;
    const pay = candidate.total_all_in != null ? candidate.total_all_in : total;
    if (
      listed != null &&
      listed > 0 &&
      pay > 0 &&
      pay !== listed
    ) {
      const jump = (pay - listed) / listed;
      if (jump > PRICE_JUMP_THRESHOLD) {
        const msg = `${SEVERITY_EMOJI.caution} ${candidate.channel}从列表 ¥${round2(
          listed
        )} 跳到支付 ¥${round2(pay)}（+${(jump * 100).toFixed(1)}%），核对跳变来源。`;
        rules.push({ rule: RuleKey.PRICE_JUMP, severity: "caution", message: msg });
        severities.push("caution");
      }
    }

    // 4) 偏离锚点：某渠道总价 vs 可信锚点价差异常（严重偏高）→ danger
    if (anchor > 0 && total > 0) {
      const dev = (total - anchor) / anchor;
      if (dev > ANCHOR_DANGER_PCT) {
        const msg = `${SEVERITY_EMOJI.danger} ${candidate.channel}总价 ¥${round2(
          total
        )} 比可信锚点 ¥${round2(anchor)} 偏高 ${(dev * 100).toFixed(
          1
        )}%，不划算。`;
        rules.push({ rule: RuleKey.ANCHOR_DEVIATION, severity: "danger", message: msg });
        severities.push("danger");
      } else if (dev > ANCHOR_CAUTION_PCT) {
        const msg = `${SEVERITY_EMOJI.caution} ${candidate.channel}总价 ¥${round2(
          total
        )} 比可信锚点 ¥${round2(anchor)} 偏高 ${(dev * 100).toFixed(1)}%，可多平台比价。`;
        rules.push({ rule: RuleKey.ANCHOR_DEVIATION, severity: "caution", message: msg });
        severities.push("caution");
      }
    }

    const severity = pickSeverity(severities);
    const emoji = SEVERITY_EMOJI[severity];

    // 判决字符串：danger/caution 用最高危规则的 message，否则用正常文案。
    const judgement =
      severity === "clean"
        ? `✅ ${candidate.channel} ¥${round2(total)} 价格正常，可作为首选。`
        : rules
            .slice()
            .sort((a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0))[0]
            .message;

    return {
      id,
      channel: candidate.channel,
      currency: candidate.currency,
      severity,
      emoji,
      verdict: SEVERITY_VERDICT[severity],
      judgement,
      total_all_in: round2(total),
      rules,
    };
  });

  const summary = {
    clean: results.filter((r) => r.severity === "clean").length,
    caution: results.filter((r) => r.severity === "caution").length,
    danger: results.filter((r) => r.severity === "danger").length,
  };

  // 总体建议：优先推荐最便宜且干净（clean）的渠道；否则给最便宜的，但要提醒避坑。
  const cleaned = results.filter((r) => r.severity === "clean");
  const sorted = [...results].sort((a, b) => a.total_all_in - b.total_all_in);
  const best = cleaned.length > 0 ? cleaned.sort((a, b) => a.total_all_in - b.total_all_in)[0] : sorted[0];
  let recommendation: string;
  if (!best) {
    recommendation = "暂无有效候选，建议重新搜索。";
  } else if (best.severity === "clean") {
    recommendation = `推荐 ${best.channel} ¥${best.total_all_in}（${best.verdict}）。`;
  } else {
    recommendation = `若必须下单可选 ${best.channel} ¥${best.total_all_in}，但请先核对异常提示（${SEVERITY_EMOJI[best.severity]} ${best.verdict}）。`;
  }

  return {
    anchor_price: anchor > 0 ? round2(anchor) : undefined,
    rules_skipped: rulesSkipped,
    results,
    summary,
    recommendation,
  };
}
