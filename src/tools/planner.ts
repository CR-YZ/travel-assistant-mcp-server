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
import { cityToAirport } from "./geo";
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
  const adults = intent.travelers ?? 2;
  const flightCandidates: AnalysisCandidate[] = [];
  const hotelCandidates: AnalysisCandidate[] = [];
  const flights: Array<{ channel: string; airline?: string; price: number; currency?: string }> = [];
  const hotels: Array<{ channel: string; name: string; nightly_rate: number; currency?: string }> = [];

  const dep = cityToAirport(intent.origin);
  const arr = cityToAirport(intent.destination);

  // 机票（有机票码则查，用于比价/异常主展示）
  if (dep && arr) {
    const fr = (await searchFlightsFull({
      departure_id: dep, arrival_id: arr,
      outbound_date: intent.start_date, return_date: intent.end_date,
      adults, currency, max_results: 6,
    })) as { error?: string; best_flights?: unknown[]; other_flights?: unknown[] };
    if (!fr.error) {
      const cn = flightsToCandidates((fr.best_flights ?? []) as never[], (fr.other_flights ?? []) as never[], currency);
      flightCandidates.push(...cn);
      // 过滤 ¥0 占位/未出票航班，避免预算机票价异常
      cn.filter((c) => (c.base ?? 0) > 0).forEach((c) => flights.push({ channel: c.channel, airline: c.channel, price: c.base ?? 0, currency: c.currency }));
    }
  }

  // 酒店（始终查，用于预算账本·住宿）
  if (intent.destination) {
    const hr = (await searchHotelsFull({
      location: intent.destination,
      check_in_date: intent.start_date, check_out_date: intent.end_date ?? intent.start_date,
      adults, currency, max_results: 6,
    })) as { error?: string; properties?: unknown[] };
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
