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
    })) as { error?: string; best_flights?: unknown[]; other_flights?: unknown[] };
    if (!fr.error) {
      const all = flightsToCandidates((fr.best_flights ?? []) as never[], (fr.other_flights ?? []) as never[], currency, adults);
      // 过滤 ¥0 占位/未出票航班：既不入比价候选，也不进预算机票价
      const ok = all.filter((c) => (c.base ?? 0) > 0);
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
