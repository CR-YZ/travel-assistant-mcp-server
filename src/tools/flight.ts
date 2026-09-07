import { kvGet, kvSet, kvAvailable } from "../kv";
import { queryKey, cacheGet, cacheSet, cacheTtlSeconds } from "./cache";

const SERPAPI_BASE = "https://serpapi.com/search";

function getSerpApiKey(): string {
  const key = process.env.SERPAPI_KEY;
  if (!key) throw new Error("SERPAPI_KEY environment variable is required");
  return key;
}

export async function searchFlights(params: {
  departure_id: string;
  arrival_id: string;
  outbound_date: string;
  return_date?: string;
  trip_type?: number;
  adults?: number;
  currency?: string;
  max_results?: number;
}): Promise<object> {
  const apiKey = getSerpApiKey();
  const tripType = params.trip_type ?? 1;
  const searchParams: Record<string, string | number> = {
    engine: "google_flights",
    api_key: apiKey,
    departure_id: params.departure_id,
    arrival_id: params.arrival_id,
    outbound_date: params.outbound_date,
    type: tripType,
    adults: params.adults ?? 1,
    currency: params.currency ?? "USD",
    gl: "us",
    hl: "en",
  };
  if (tripType === 1 && params.return_date) {
    searchParams.return_date = params.return_date;
  } else if (tripType === 1 && !params.return_date) {
    return { error: "Return date is required for round trip flights" };
  }

  const ttl = cacheTtlSeconds();
  const ckey = queryKey("search:flights", {
    engine: "google_flights",
    departure_id: params.departure_id,
    arrival_id: params.arrival_id,
    outbound_date: params.outbound_date,
    return_date: params.return_date,
    type: tripType,
    adults: params.adults ?? 1,
    currency: params.currency ?? "USD",
    max_results: params.max_results ?? 10,
  }, ttl);

  // 命中缓存直接返回，不再消耗 SerpAPI 搜索次数。
  const cachedVal = await cacheGet<object>(ckey);
  if (cachedVal) return { ...cachedVal, cache_status: "hit" };

  const url = new URL(SERPAPI_BASE);
  Object.entries(searchParams).forEach(([k, v]) =>
    url.searchParams.set(k, String(v))
  );
  const res = await fetch(url.toString());
  if (!res.ok) return { error: `API request failed: ${res.statusText}` };
  const data = (await res.json()) as Record<string, unknown>;
  const searchId = `${params.departure_id}_${params.arrival_id}_${params.outbound_date}${params.return_date ? `_${params.return_date}` : ""}_${Date.now()}`;
  const maxResults = params.max_results ?? 10;
  const processed = {
    search_metadata: {
      search_id: searchId,
      departure: params.departure_id,
      arrival: params.arrival_id,
      outbound_date: params.outbound_date,
      return_date: params.return_date,
      trip_type: tripType === 1 ? "Round trip" : tripType === 2 ? "One way" : "Multi-city",
      currency: params.currency ?? "USD",
      search_timestamp: new Date().toISOString(),
    },
    best_flights: (data.best_flights as object[])?.slice(0, maxResults) ?? [],
    other_flights: (data.other_flights as object[])?.slice(0, maxResults) ?? [],
    price_insights: data.price_insights ?? {},
    airports: data.airports ?? [],
  };
  if (kvAvailable()) await kvSet(`flight:${searchId}`, processed);
  const result = {
    search_id: searchId,
    total_best_flights: processed.best_flights.length,
    total_other_flights: processed.other_flights.length,
    price_range: {
      lowest_price: (processed.price_insights as Record<string, unknown>)?.lowest_price,
      currency: params.currency ?? "USD",
    },
    search_parameters: processed.search_metadata,
  };
  // 仅缓存正常结果；带 error 字段的失败结果不缓存，避免把瞬时错误写死。
  await cacheSet(ckey, result, ttl);
  return { ...result, cache_status: "miss" };
}

export async function getFlightDetails(searchId: string): Promise<string> {
  if (!kvAvailable()) {
    return "Vercel KV is not configured. Set KV_REST_API_URL and KV_REST_API_TOKEN to use get_flight_details.";
  }
  const data = await kvGet<Record<string, unknown>>(`flight:${searchId}`);
  if (!data) return `No flight search found with ID: ${searchId}`;
  return JSON.stringify(data, null, 2);
}

export async function filterFlightsByPrice(
  searchId: string,
  maxPrice?: number,
  minPrice?: number
): Promise<string> {
  if (!kvAvailable()) {
    return "Vercel KV is not configured. Set KV_REST_API_URL and KV_REST_API_TOKEN to use filter_flights_by_price.";
  }
  const data = await kvGet<Record<string, unknown>>(`flight:${searchId}`);
  if (!data) return `No flight search found with ID: ${searchId}`;
  const best = (data.best_flights as Array<Record<string, unknown>>) ?? [];
  const other = (data.other_flights as Array<Record<string, unknown>>) ?? [];
  const filter = (f: Record<string, unknown>) => {
    const price = Number(f.price ?? 0);
    if (minPrice != null && price < minPrice) return false;
    if (maxPrice != null && price > maxPrice) return false;
    return true;
  };
  const filteredBest = best.filter(filter);
  const filteredOther = other.filter(filter);
  return JSON.stringify(
    {
      search_id: searchId,
      filters_applied: { min_price: minPrice, max_price: maxPrice },
      filtered_best_flights: filteredBest,
      filtered_other_flights: filteredOther,
      total_filtered: filteredBest.length + filteredOther.length,
    },
    null,
    2
  );
}

export async function filterFlightsByAirline(
  searchId: string,
  airlines: string[]
): Promise<string> {
  if (!kvAvailable()) {
    return "Vercel KV is not configured. Set KV_REST_API_URL and KV_REST_API_TOKEN to use filter_flights_by_airline.";
  }
  const data = await kvGet<Record<string, unknown>>(`flight:${searchId}`);
  if (!data) return `No flight search found with ID: ${searchId}`;
  const best = (data.best_flights as Array<Record<string, unknown>>) ?? [];
  const other = (data.other_flights as Array<Record<string, unknown>>) ?? [];
  const airlineSet = new Set(airlines.map((a) => a.toLowerCase()));
  const match = (f: Record<string, unknown>) => {
    const legs = (f.flights ?? []) as Array<Record<string, unknown>>;
    const flightAirlines = new Set(legs.map((leg) => String(leg.airline ?? "").toLowerCase()));
    return [...airlineSet].some((a) => flightAirlines.has(a));
  };
  const filteredBest = best.filter(match);
  const filteredOther = other.filter(match);
  return JSON.stringify(
    {
      search_id: searchId,
      filters_applied: { airlines },
      filtered_best_flights: filteredBest,
      filtered_other_flights: filteredOther,
      total_filtered: filteredBest.length + filteredOther.length,
    },
    null,
    2
  );
}
