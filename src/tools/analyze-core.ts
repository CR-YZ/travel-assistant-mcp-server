/**
 * analyze-core.ts —— 共享的「归一化 + 异常 + 行程预算」管线核心
 *
 * 被 MCP 工具 analyze_travel 与 search_analyze 复用：
 * search_analyze 先做真实的 SerpAPI 搜索并把结果映射成 candidates，再走本核心，
 * 这样「真实搜索 → 候选映射 → 分析」与「直接喂候选 → 分析」得到一致的输出/行为。
 */
import { normalizeMany } from "./price-normalize";
import { detectAnomalies } from "./anomaly";
import { buildTripPlan, type TripIntent } from "./itinerary";
import { getLivingCost } from "./cost-of-living";
import * as finance from "./finance";
import * as event from "./event";
import { llmConfigured, aiInsight, polishTrip } from "./llm";

export interface AnalysisCandidate {
  channel: string;
  currency?: string;
  base?: number;
  before_taxes_fees?: number;
  lowest?: number;
  total_rate?: number;
  taxes_fees?: number;
  baggage?: number;
  booking_extra?: number;
  bundle?: number;
  listed_price?: number;
  has_default_addon?: boolean;
  addon_items?: Array<{ name: string; price: number; is_default?: boolean }>;
}

export interface AnalysisOptions {
  flights?: Array<{ channel: string; airline?: string; flight_no?: string; price: number; currency?: string }>;
  hotels?: Array<{ channel: string; name: string; nightly_rate: number; currency?: string; rating?: number }>;
  events?: Array<{ title: string; venue?: string; price?: { amount?: number; currency?: string } | null }>;
  /** 传入 true 时不拉真实活动票价（用于仅比价的轻量调用）；默认有 intent 时拉取。 */
  skipEvents?: boolean;
  /** 是否生成付费成品（行程+预算+避坑）。'insight'=只出洞察(免费)；'full'=完整成品。默认 'full'。 */
  deliverable?: "full" | "insight";
}

export interface TravelAnalysisResult {
  normalized: unknown[];
  anomaly: unknown;
  trip_plan: unknown | null;
  usd_cny_rate: number | null;
  /** LLM 生成的 AI 解读/行程润色（未配置或失败时无此字段）。 */
  ai?: Record<string, unknown>;
}

/**
 * 核心管线：candidates → normalize(真实到手价+hidden_gap) → anomaly(🚨/⚠️/✅)
 *            + (有 intent 时) 行程/预算/避坑 + 实时汇率 + 真实活动票价。
 */
export async function runAnalysis(
  candidates: AnalysisCandidate[],
  anchor_price: number | undefined,
  intent: TripIntent | undefined,
  opts: AnalysisOptions = {}
): Promise<TravelAnalysisResult> {
  const normalized = normalizeMany(
    candidates.map((c) => ({
      source: c.channel,
      currency: c.currency ?? "CNY",
      base: c.base,
      before_taxes_fees: c.before_taxes_fees,
      lowest: c.lowest,
      total_rate: c.total_rate,
      taxes_fees: c.taxes_fees,
      baggage: c.baggage,
      booking_extra: c.booking_extra,
      bundle: c.bundle,
    }))
  );
  const candidateMap = normalized.map((n) => ({
    channel: n.source,
    currency: n.currency,
    base: n.components.base.value,
    taxes_fees: n.components.taxes_fees.value,
    baggage: n.components.baggage.value,
    booking_extra: n.components.booking_extra.value,
    bundle: n.components.bundle.value,
    total_all_in: n.total_all_in,
  }));
  const anomalyCandidates = candidateMap.map((n, i) => {
    const raw = candidates[i] ?? {};
    return {
      ...n,
      channel: raw.channel ?? n.channel,
      listed_price: raw.listed_price,
      has_default_addon: raw.has_default_addon,
      addon_items: raw.addon_items,
    };
  });
  const anomaly = detectAnomalies(anomalyCandidates, anchor_price);

  let usdCny: number | undefined;
  try {
    const rateRes = (await finance.convertCurrency({ from_currency: "USD", to_currency: "CNY" })) as {
      exchange_rate?: number;
    };
    if (rateRes && rateRes.exchange_rate && rateRes.exchange_rate > 0) usdCny = rateRes.exchange_rate;
  } catch {
    /* 汇率拉取失败 → 用静态备选 */
  }

  const deliverable = opts.deliverable ?? "full";

  // 付费成品（逐日行程 + 预算 + 完整避坑）才做这步；免费洞察不做，省搜索/LLM成本。
  let tripPlan: ReturnType<typeof buildTripPlan> | undefined;
  if (deliverable === "full" && intent) {
    let realEvents: Array<{ title: string; price?: { amount?: number } | null; venue?: string }> | undefined;
    if (!opts.skipEvents) {
      try {
        const ev = (await event.searchEvents({
          query: "attractions",
          location: intent.destination,
          max_results: 8,
        })) as { sample_events?: Array<{ title: string; price?: { amount?: number } | null; venue?: string }> };
        realEvents = ev?.sample_events ?? undefined;
      } catch {
        /* 活动拉取失败 → 门票用城市成本估算 */
      }
    }
    const cityCost = await getLivingCost(intent.destination, { usd_cny_rate: usdCny });
    tripPlan = buildTripPlan(intent, {
      flights: opts.flights,
      hotels: opts.hotels,
      anomalyReport: { results: anomaly.results },
      cityCost,
      events: realEvents,
    });
  }

  const result: TravelAnalysisResult = {
    normalized,
    anomaly,
    trip_plan: deliverable === "full" ? (tripPlan ?? null) : null,
    usd_cny_rate: usdCny ?? null,
  };

  // 启用 LLM 时：AI 解读(免费·始终)；行程润色(付费成品才做)。
  if (llmConfigured()) {
    const ai: Record<string, unknown> = {};
    try {
      const insight = await aiInsight(anomaly as Record<string, any>);
      if (insight) {
        (anomaly as Record<string, any>).recommendation = insight; // 比价/验价屏直接用 AI 解读
        ai.insight = insight;
      }
    } catch {
      /* 规则文案兜底 */
    }
    if (deliverable === "full") {
      try {
        const pol = await polishTrip(tripPlan as Record<string, any>);
        if (pol) {
          ai.summary = pol.summary;
          ai.dayNotes = pol.dayNotes;
        }
      } catch {
        /* 规则文案兜底 */
      }
    }
    if (Object.keys(ai).length > 0) result.ai = ai;
  }

  return result;
}
