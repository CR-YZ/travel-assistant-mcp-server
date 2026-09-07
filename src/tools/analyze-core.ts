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
}

export interface TravelAnalysisResult {
  normalized: unknown[];
  anomaly: unknown;
  trip_plan: unknown | null;
  usd_cny_rate: number | null;
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

  let realEvents: Array<{ title: string; price?: { amount?: number } | null; venue?: string }> | undefined;
  if (intent && !opts.skipEvents) {
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

  const cityCost = intent != null ? await getLivingCost(intent.destination, { usd_cny_rate: usdCny }) : undefined;
  const tripPlan = intent
    ? buildTripPlan(intent, {
        flights: opts.flights,
        hotels: opts.hotels,
        anomalyReport: { results: anomaly.results },
        cityCost,
        events: realEvents,
      })
    : undefined;

  return { normalized, anomaly, trip_plan: tripPlan ?? null, usd_cny_rate: usdCny ?? null };
}
