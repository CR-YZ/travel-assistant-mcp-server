/**
 * map-candidates.ts —— 把 SerpAPI 搜索结果映射为 analyze_travel / search_analyze 的候选价
 *
 * 对齐《07-frontend-integration.md》§5 端到端链路：search_flights/search_hotels 原始结果
 * → 映射成 candidates → analyze_travel。
 *
 * 已知缺口（文档 §7）：SerpAPI flights 的 price 是含税总价，无 before_taxes_fees 拆分，
 * 因此机票候选的 taxes_fees 一般视为 0、hidden_gap 偏小；酒店天然有 total_rate 拆分明细，
 * 检测更准。
 */
import type { AnalysisCandidate } from "./analyze-core";

type Flight = Record<string, any>;
type HotelProperty = Record<string, any>;

/** 把可能带货币符号/千分位的字符串转成数字（如 "CN¥1,309" → 1309）。失败回 0。 */
function num(v: unknown): number {
  const s = String(v ?? "");
  const n = Number(s.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** 从航班数组（best_flights[]/other_flights[]）映射候选；channel 用「航司 + 航班号」。 */
export function flightsToCandidates(bestFlights: Flight[], otherFlights: Flight[], currency = "CNY"): AnalysisCandidate[] {
  const all = [...(bestFlights ?? []), ...(otherFlights ?? [])];
  return all.slice(0, 10).map((f, i) => {
    const legs = f.flights ?? [];
    const first = legs[0] ?? {};
    const airline = f.airline ?? first.airline ?? `航班${i + 1}`;
    const flightNo = first.flight_number ?? "";
    const price = num(f.price);
    return {
      channel: `${airline} ${flightNo}`.trim() || `航班${i + 1}`,
      currency,
      base: price,       // 含税总价 → 当 base；无裸价拆分（已知缺口）
      taxes_fees: 0,
      listed_price: price,
      baggage: 0,
      booking_extra: 0,
      bundle: 0,
    };
  });
}

/** 从酒店属性数组（properties[]）映射候选；channel 用酒店名。 */
export function hotelsToCandidates(properties: HotelProperty[], currency = "CNY"): AnalysisCandidate[] {
  return (properties ?? []).slice(0, 10).map((p) => {
    const name = p.name ?? "酒店";
    const rate = (p.rate_per_night ?? {}) as Record<string, unknown>;
    const total = (p.total_rate ?? {}) as Record<string, unknown>;
    const base = num(total.before_taxes_fees ?? rate.before_taxes_fees ?? rate.extracted_lowest ?? rate.lowest ?? total.lowest ?? 0);
    const lowest = num(total.lowest ?? rate.extracted_lowest ?? rate.lowest ?? base);
    const taxes = base > 0 && lowest > base ? Math.round(lowest - base) : 0;
    return {
      channel: name,
      currency,
      base,
      taxes_fees: taxes,
      listed_price: lowest > 0 ? lowest : undefined,
      baggage: 0,
      booking_extra: 0,
      bundle: 0,
      has_default_addon: false,
    };
  });
}
