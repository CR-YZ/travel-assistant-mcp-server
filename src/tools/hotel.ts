import { kvGet, kvSet, kvAvailable } from "../kv";
import { queryKey, cacheGet, cacheSet, cacheTtlSeconds } from "./cache";

const SERPAPI_BASE = "https://serpapi.com/search";

function getSerpApiKey(): string {
  const key = process.env.SERPAPI_KEY;
  if (!key) throw new Error("SERPAPI_KEY environment variable is required");
  return key;
}

export async function searchHotels(params: {
  location: string;
  check_in_date: string;
  check_out_date: string;
  adults?: number;
  currency?: string;
  max_results?: number;
}): Promise<object> {
  const apiKey = getSerpApiKey();
  const searchParams: Record<string, string | number> = {
    engine: "google_hotels",
    api_key: apiKey,
    q: params.location,
    check_in_date: params.check_in_date,
    check_out_date: params.check_out_date,
    adults: params.adults ?? 2,
    currency: params.currency ?? "USD",
    gl: "us",
    hl: "en",
  };
  const ttl = cacheTtlSeconds();
  const ckey = queryKey("search:hotels", {
    engine: "google_hotels",
    location: params.location,
    check_in_date: params.check_in_date,
    check_out_date: params.check_out_date,
    adults: params.adults ?? 2,
    currency: params.currency ?? "USD",
    max_results: params.max_results ?? 20,
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
  const maxResults = params.max_results ?? 20;
  const properties = (data.properties as object[])?.slice(0, maxResults) ?? [];
  const searchId = `${params.location.replace(/\s/g, "_")}_${params.check_in_date}_${params.check_out_date}_${Date.now()}`;
  const processed = {
    search_metadata: {
      search_id: searchId,
      location: params.location,
      check_in_date: params.check_in_date,
      check_out_date: params.check_out_date,
      guests: { adults: params.adults ?? 2, children: 0 },
      currency: params.currency ?? "USD",
      search_timestamp: new Date().toISOString(),
    },
    properties,
    search_information: data.search_information ?? {},
    brands: data.brands ?? [],
  };
  if (kvAvailable()) await kvSet(`hotel:${searchId}`, processed);
  const prices = properties
    .map((p) => (p as Record<string, Record<string, number>>)?.rate_per_night?.extracted_lowest)
    .filter((n): n is number => typeof n === "number");
  const result = {
    search_id: searchId,
    total_properties: properties.length,
    location: params.location,
    dates: `${params.check_in_date} to ${params.check_out_date}`,
    guests: `${params.adults ?? 2} adults`,
    price_range:
      prices.length > 0
        ? { min_price: Math.min(...prices), max_price: Math.max(...prices), currency: params.currency ?? "USD" }
        : null,
    search_parameters: processed.search_metadata,
  };
  // 仅缓存正常结果；失败结果(含 error 字段)不缓存。
  await cacheSet(ckey, result, ttl);
  return { ...result, cache_status: "miss" };
}

export async function getHotelDetails(searchId: string): Promise<string> {
  if (!kvAvailable()) {
    return "Vercel KV is not configured. Set KV_REST_API_URL and KV_REST_API_TOKEN to use get_hotel_details.";
  }
  const data = await kvGet<Record<string, unknown>>(`hotel:${searchId}`);
  if (!data) return `No hotel search found with ID: ${searchId}`;
  return JSON.stringify(data, null, 2);
}

export async function filterHotelsByPrice(
  searchId: string,
  maxPrice?: number,
  minPrice?: number
): Promise<string> {
  if (!kvAvailable()) {
    return "Vercel KV is not configured. Set KV_REST_API_URL and KV_REST_API_TOKEN to use filter_hotels_by_price.";
  }
  const data = await kvGet<Record<string, unknown>>(`hotel:${searchId}`);
  if (!data) return `No hotel search found with ID: ${searchId}`;
  const properties = (data.properties as Array<Record<string, unknown>>) ?? [];
  const filtered = properties.filter((h) => {
    const rate = h.rate_per_night as Record<string, number> | undefined;
    const price = rate?.extracted_lowest ?? 0;
    if (minPrice != null && price < minPrice) return false;
    if (maxPrice != null && price > maxPrice) return false;
    return true;
  });
  return JSON.stringify(
    {
      search_id: searchId,
      filters_applied: { min_price: minPrice, max_price: maxPrice },
      filtered_properties: filtered,
      total_filtered: filtered.length,
    },
    null,
    2
  );
}

export async function getPropertyDetails(params: {
  property_token: string;
  currency?: string;
  country?: string;
  language?: string;
}): Promise<string> {
  const apiKey = getSerpApiKey();
  const url = new URL(SERPAPI_BASE);
  url.searchParams.set("engine", "google_hotels");
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("property_token", params.property_token);
  url.searchParams.set("currency", params.currency ?? "USD");
  url.searchParams.set("gl", params.country ?? "us");
  url.searchParams.set("hl", params.language ?? "en");
  const res = await fetch(url.toString());
  if (!res.ok) return `API request failed: ${res.statusText}`;
  const data = (await res.json()) as Record<string, unknown>;
  return JSON.stringify(data, null, 2);
}

export async function filterHotelsByRating(
  searchId: string,
  minRating: number
): Promise<string> {
  if (!kvAvailable()) {
    return "Vercel KV is not configured. Set KV_REST_API_URL and KV_REST_API_TOKEN to use filter_hotels_by_rating.";
  }
  const data = await kvGet<Record<string, unknown>>(`hotel:${searchId}`);
  if (!data) return `No hotel search found with ID: ${searchId}`;
  const properties = (data.properties as Array<Record<string, unknown>>) ?? [];
  const filtered = properties.filter((h) => {
    const rating = Number(h.overall_rating ?? 0);
    return rating >= minRating;
  });
  return JSON.stringify(
    {
      search_id: searchId,
      filters_applied: { min_rating: minRating },
      filtered_properties: filtered,
      total_filtered: filtered.length,
    },
    null,
    2
  );
}

export async function filterHotelsByAmenities(
  searchId: string,
  requiredAmenities: string[]
): Promise<string> {
  if (!kvAvailable()) {
    return "Vercel KV is not configured. Set KV_REST_API_URL and KV_REST_API_TOKEN to use filter_hotels_by_amenities.";
  }
  const data = await kvGet<Record<string, unknown>>(`hotel:${searchId}`);
  if (!data) return `No hotel search found with ID: ${searchId}`;
  const properties = (data.properties as Array<Record<string, unknown>>) ?? [];
  const filtered = properties.filter((h) => {
    const amenities = (h.amenities ?? []) as string[];
    const lower = amenities.map((a) => String(a).toLowerCase());
    return requiredAmenities.every((req) => lower.some((a) => a.includes(req.toLowerCase())));
  });
  return JSON.stringify(
    {
      search_id: searchId,
      filters_applied: { required_amenities: requiredAmenities },
      filtered_properties: filtered,
      total_filtered: filtered.length,
    },
    null,
    2
  );
}

export async function filterHotelsByClass(
  searchId: string,
  hotelClasses: number[]
): Promise<string> {
  if (!kvAvailable()) {
    return "Vercel KV is not configured. Set KV_REST_API_URL and KV_REST_API_TOKEN to use filter_hotels_by_class.";
  }
  const data = await kvGet<Record<string, unknown>>(`hotel:${searchId}`);
  if (!data) return `No hotel search found with ID: ${searchId}`;
  const properties = (data.properties as Array<Record<string, unknown>>) ?? [];
  const classSet = new Set(hotelClasses);
  const filtered = properties.filter((h) => {
    const cls = Number(h.extracted_hotel_class ?? h.hotel_class ?? 0);
    return classSet.has(cls);
  });
  return JSON.stringify(
    {
      search_id: searchId,
      filters_applied: { hotel_classes: hotelClasses },
      filtered_properties: filtered,
      total_filtered: filtered.length,
    },
    null,
    2
  );
}
