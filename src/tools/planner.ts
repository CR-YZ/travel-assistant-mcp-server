/**
 * planner.ts —— 给定行程意图，执行「自动搜索(机票+酒店) → 候选映射 → 分析」。
 * 被 plan_from_text（首次一句话）与 plan_followup（多轮追问）复用，避免重复。
 *
 * 说明：机票候选用于「比价/异常」主展示；酒店候选用于「预算账本·住宿」，
 * 两者都会查询，使完整行程预算里机票/酒店都有真实数据。
 */
import { searchFlightsFull } from "./flight";
import { searchHotelsFull } from "./hotel";
import { flightsToCandidates, hotelsToCandidates } from "./map-candidates";
import { runAnalysis, type AnalysisCandidate } from "./analyze-core";
import { cityToAirport, cityToEnglish } from "./geo";
import { airportCodeFor } from "./airport-code";
import type { TripIntent } from "./itinerary";

/** 按航司配对「去程单程最低 + 回程单程最低」，得每个航司的真实往返价（保留航司差异）。
 *  单程值是 SerpAPI 真实数据；同一航司去程/回程真实价相加得该航司往返价。
 *  返回 [{ airline, price }]，price 为该航司往返真实价；返回空数组表示无法取到。 */
async function airlineRoundTrip(
  dep: string, arr: string,
  start_date: string, end_date: string,
  adults: number, currency: string
): Promise<Array<{ airline: string; price: number }>> {
  const legPrice = async (d: string, a: string, date: string): Promise<Map<string, number>> => {
    const r = (await searchFlightsFull({
      departure_id: d, arrival_id: a,
      outbound_date: date, trip_type: 2, adults, currency, max_results: 10,
    })) as { error?: string; best_flights?: unknown[]; other_flights?: unknown[] };
    const map = new Map<string, number>();
    if (r.error) return map;
    const all = [...((r.best_flights ?? []) as any[]), ...((r.other_flights ?? []) as any[])];
    for (const f of all) {
      const air = (f.airline || (f.flights && f.flights[0] && f.flights[0].airline) || "").trim();
      const p = Number(f.price) || 0;
      if (air && p > 0) {
        const cur = map.get(air);
        if (cur == null || p < cur) map.set(air, p);
      }
    }
    return map;
  };
  const outMap = await legPrice(dep, arr, start_date);
  const retMap = await legPrice(arr, dep, end_date);
  const out: Array<{ airline: string; price: number }> = [];
  for (const [air, op] of outMap) {
    const rp = retMap.get(air);
    if (rp != null) out.push({ airline: air, price: Math.round(op + rp) });
  }
  return out;
}

export interface PlanResult {
  ok: boolean;
  error?: string;
  intent?: TripIntent;
  result?: unknown;
  search?: { kind: "flights" | "hotels"; route?: string; flights: number; hotels: number };
}

export async function searchAndAnalyze(intent: TripIntent, deliverable: "full" | "insight" = "full"): Promise<PlanResult> {
  const currency = "CNY";
  const adults = intent.travelers ?? 1;
  const flightCandidates: AnalysisCandidate[] = [];
  const hotelCandidates: AnalysisCandidate[] = [];
  const flights: Array<{ channel: string; airline?: string; price: number; currency?: string }> = [];
  const hotels: Array<{ channel: string; name: string; nightly_rate: number; currency?: string }> = [];

  const dep = cityToAirport(intent.origin);
  // 目的地机场码：白名单优先，查不到再走 Tavily 兜底（配置了 TAVILY_API_KEY 时）
  const arr = await airportCodeFor(intent.destination);

  // 机票（有机票码则查，用于比价/异常主展示）
  if (dep && arr) {
    const fr = (await searchFlightsFull({
      departure_id: dep, arrival_id: arr,
      outbound_date: intent.start_date, return_date: intent.end_date,
      adults, currency, max_results: 6,
    })) as { error?: string; best_flights?: unknown[]; other_flights?: unknown[]; price_insights?: { lowest_price?: number; typical_price_range?: [number, number] } };
    if (!fr.error) {
      const all = flightsToCandidates((fr.best_flights ?? []) as never[], (fr.other_flights ?? []) as never[], currency, adults);
      // 过滤 ¥0 占位/未出票航班：既不入比价候选，也不进预算机票价
      let ok = all.filter((c) => (c.base ?? 0) > 0);

      // 用 SerpAPI price_insights.lowest_price（权威最低价）作为最低候选基准，避免显示虚高。
      // 这是数据源给的可信 lowest（如上海→西安 ¥1030），不是缩放。
      const lowest = (fr.price_insights && typeof fr.price_insights.lowest_price === "number") ? fr.price_insights.lowest_price : 0;
      const curMin = ok.length ? Math.min(...ok.map((c) => c.base ?? 0)) : 0;
      if (lowest > 0 && (curMin === 0 || lowest < curMin)) {
        const lowestPerPerson = Math.round(lowest / Math.max(1, adults));
        ok.push({ channel: "实时最低（参考）", currency, base: lowestPerPerson, taxes_fees: 0, listed_price: lowestPerPerson, baggage: 0, booking_extra: 0, bundle: 0 });
        ok.sort((a, b) => (a.base ?? 0) - (b.base ?? 0));
      }

      // 只针对真实异常：SerpAPI 往返(type=1)对部分航线返回明显虚高的往返价（如成都→西安 ¥5040，
      // 而真实单程去程¥913+回程¥886≈¥1799）。若往返最低价 > 真实单程之和×1.8（远超正常1.3-1.5倍），
      // 则用「各航司去程单程 + 回程单程」的真实配对价重建候选，保留航司间价格差异（不缩放、直接累加）。
      const roundtripMin = ok.length ? Math.min(...ok.map((c) => c.base ?? 0)) : 0;
      const airlines = await airlineRoundTrip(dep, arr, intent.start_date, intent.end_date, adults, currency);
      const realMin = airlines.length ? Math.min(...airlines.map((a) => a.price)) : 0;
      if (realMin > 0 && roundtripMin > realMin * 1.8) {
        // 剔除单程累加价明显过高的航司（> 最便宜 ×2 的异常坑位，如深航/山东），只保留合理区间
        const cap = realMin * 2;
        const kept = airlines.filter((a) => a.price <= cap);
        // 用每个航司的真实「去程单程 + 回程单程」价重建候选（真实数据累加，保留差异）
        ok = kept.map((a) => ({
          channel: a.airline + "（去程+回程单程）",
          currency, base: a.price, taxes_fees: 0, listed_price: a.price, baggage: 0, booking_extra: 0, bundle: 0,
        }));
      }

      flightCandidates.push(...ok);
      ok.forEach((c) => flights.push({ channel: c.channel, airline: c.channel, price: c.base ?? 0, currency: c.currency }));
    }
  }

  // 酒店（始终查，用于预算账本·住宿；中文名查不到回退英文名，境外城市常需英文）
  if (intent.destination) {
    let hr = (await searchHotelsFull({
      location: intent.destination,
      check_in_date: intent.start_date, check_out_date: intent.end_date ?? intent.start_date,
      adults, currency, max_results: 6,
    })) as { error?: string; properties?: unknown[] };
    if ((hr.error || (hr.properties?.length ?? 0) === 0)) {
      const en = cityToEnglish(intent.destination);
      if (en && en !== intent.destination) {
        hr = (await searchHotelsFull({
          location: en,
          check_in_date: intent.start_date, check_out_date: intent.end_date ?? intent.start_date,
          adults, currency, max_results: 6,
        })) as { error?: string; properties?: unknown[] };
      }
    }
    if (!hr.error) {
      const cn = hotelsToCandidates((hr.properties ?? []) as never[], currency);
      hotelCandidates.push(...cn);
      cn.forEach((c) => hotels.push({ channel: c.channel, name: c.channel, nightly_rate: c.base ?? 0, currency: c.currency }));
    }
  }

  const candidates = flightCandidates.length > 0 ? flightCandidates : hotelCandidates;
  if (candidates.length === 0) {
    return { ok: false, error: `未能获取到「${intent.destination}」的可选价格，请换目的地/日期。`, intent };
  }

  const result = await runAnalysis(candidates, undefined, intent, { flights, hotels, deliverable });
  return {
    ok: true,
    intent,
    result,
    search: {
      kind: flightCandidates.length > 0 ? "flights" : "hotels",
      route: dep && arr ? `${dep}→${arr}` : intent.destination,
      flights: flights.length,
      hotels: hotels.length,
    },
  };
}
