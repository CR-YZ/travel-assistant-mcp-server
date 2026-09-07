/**
 * map-candidates.ts —— 把 SerpAPI 搜索结果映射为 analyze_travel / search_analyze 的候选价
 *
 * 对齐《07-frontend-integration.md》§5 端到端链路：search_flights/search_hotels 原始结果
 * → 映射成 candidates → analyze_travel。
 *
 * 已知缺口（文档 §7）：SerpAPI flights 的 price 是含税总价，无 before_taxes_fees 拆分，
 * 因此机票候选的 taxes_fees 一般视为 0、hidden_gap 偏小；酒店天然有 total_rate 拆分明细，
 * 检测更准。
 *
 * 注意（已修正）：SerpAPI google_flights 的 price 是「N 人整单价」（随 adults 翻倍），
 * flightsToCandidates 这里按 travelers 折算成「每人价」，保证异常检测 / 预算 / 前端展示
 * 都基于每人单价。
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

/** 从航班数组（best_flights[]/other_flights[]）映射候选；channel 用「航司 + 航班号」。
 *  price 是整单总价，按 travelers 折算成每人价。
 *  直飞优先：候选先按「是否直飞」排序（直飞在前），同类别内再按价格升序。
 *  中转航班加「·转」标注（并注明经停城市），避免把中转高价当直飞价误导用户。 */
export function flightsToCandidates(bestFlights: Flight[], otherFlights: Flight[], currency = "CNY", travelers = 1): AnalysisCandidate[] {
  // 人数至少 1，避免除零/负
  const n = Math.max(1, Math.round(travelers || 1));
  const all = [...(bestFlights ?? []), ...(otherFlights ?? [])];
  const mapped = all.slice(0, 15).map((f, i) => {
    const legs = f.flights ?? [];
    const first = legs[0] ?? {};
    const airline = f.airline ?? first.airline ?? `航班${i + 1}`;
    const flightNo = first.flight_number ?? "";
    const isDirect = legs.length <= 1;
    const total = num(f.price);
    const price = total > 0 ? Math.round(total / n) : 0;
    // 中转标注：经停城市（去重、非空）
    const via = isDirect
      ? ""
      : "·转" + legs.slice(0, -1).map((l: any) => (l.arrival_airport && (l.arrival_airport.name || l.arrival_airport.code)) || "").filter(Boolean).join("/");
    const baseName = `${airline} ${flightNo}`.trim() || `航班${i + 1}`;
    return {
      channel: baseName + via,
      currency,
      base: price,       // 每人含税总价 → 当 base；无裸价拆分（已知缺口）
      taxes_fees: 0,
      listed_price: price,
      baggage: 0,
      booking_extra: 0,
      bundle: 0,
      _isDirect: isDirect, // 排序用
      _price: price,       // 排序用
    };
  });
  // 直飞优先，同类别内按价格升序
  mapped.sort((a, b) => (Number(b._isDirect) - Number(a._isDirect)) || (a._price - b._price));
  return mapped.slice(0, 10).map(({ _isDirect, _price, ...c }) => c);
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
