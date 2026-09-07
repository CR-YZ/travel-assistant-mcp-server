/**
 * planner.ts —— 给定行程意图，执行「自动搜索 → 候选映射 → 分析」。
 * 被 plan_from_text（首次一句话）与 plan_followup（多轮追问）复用，避免重复。
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
  cid?: string; // 兼容
  intent?: TripIntent;
  result?: unknown;
  search?: { kind: "flights" | "hotels"; route?: string };
}

/** 依据意图搜索(机票优先，缺机场码则酒店)并跑分析。 */
export async function searchAndAnalyze(intent: TripIntent): Promise<PlanResult> {
  const currency = "CNY";
  const adults = intent.travelers ?? 2;
  const candidates: AnalysisCandidate[] = [];
  const flights: Array<{ channel: string; airline?: string; price: number; currency?: string }> = [];
  const hotels: Array<{ channel: string; name: string; nightly_rate: number; currency?: string }> = [];

  const dep = cityToAirport(intent.origin);
  const arr = cityToAirport(intent.destination);
  let kind: "flights" | "hotels" = "hotels";
  let route: string | undefined;

  if (dep && arr) {
    kind = "flights";
    route = `${dep}→${arr}`;
    const fr = (await searchFlightsFull({
      departure_id: dep, arrival_id: arr,
      outbound_date: intent.start_date, return_date: intent.end_date,
      adults, currency, max_results: 6,
    })) as { error?: string; best_flights?: unknown[]; other_flights?: unknown[] };
    if (!fr.error) {
      const cn = flightsToCandidates((fr.best_flights ?? []) as never[], (fr.other_flights ?? []) as never[], currency);
      candidates.push(...cn);
      cn.forEach((c) => flights.push({ channel: c.channel, airline: c.channel, price: c.base ?? 0, currency: c.currency }));
    }
  } else {
    route = intent.destination;
    const hr = (await searchHotelsFull({
      location: intent.destination,
      check_in_date: intent.start_date, check_out_date: intent.end_date ?? intent.start_date,
      adults, currency, max_results: 6,
    })) as { error?: string; properties?: unknown[] };
    if (!hr.error) {
      const cn = hotelsToCandidates((hr.properties ?? []) as never[], currency);
      candidates.push(...cn);
      cn.forEach((c) => hotels.push({ channel: c.channel, name: c.channel, nightly_rate: c.base ?? 0, currency: c.currency }));
    }
  }

  if (candidates.length === 0) {
    return { ok: false, error: `未能获取到「${intent.destination}」的可选价格，请换目的地/日期或补充机场码。`, intent };
  }
  const result = await runAnalysis(candidates, undefined, intent, { flights, hotels });
  return { ok: true, intent, result, search: { kind, route } };
}
