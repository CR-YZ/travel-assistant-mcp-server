const NOMINATIM_BASE = "https://nominatim.openstreetmap.org";

/** Nominatim requires a valid User-Agent. Rate limit: 1 req/sec. */
const HEADERS = {
  "User-Agent": "TravelAssistantMCP/1.0 (travel-planning)",
  Accept: "application/json",
};

export async function geocodeLocation(params: {
  location: string;
  exactly_one?: boolean;
  country_codes?: string;
}): Promise<object> {
  const url = new URL(`${NOMINATIM_BASE}/search`);
  url.searchParams.set("q", params.location);
  url.searchParams.set("format", "json");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", params.exactly_one !== false ? "1" : "10");
  if (params.country_codes) url.searchParams.set("countrycodes", params.country_codes);
  const res = await fetch(url.toString(), { headers: HEADERS });
  if (!res.ok) return { success: false, error: `Geocoding failed: ${res.statusText}`, query: params.location };
  const data = (await res.json()) as Array<Record<string, unknown>>;
  if (!data?.length) {
    return { success: false, error: `No coordinates found for location: ${params.location}`, query: params.location };
  }
  const one = data[0];
  const lat = Number(one.lat);
  const lon = Number(one.lon);
  const displayName = String(one.display_name ?? "");
  return {
    success: true,
    query: params.location,
    multiple_results: data.length > 1,
    location_data: {
      latitude: lat,
      longitude: lon,
      display_name: displayName,
      raw_data: one,
    },
    timestamp: new Date().toISOString(),
  };
}

export async function reverseGeocode(params: {
  latitude: number;
  longitude: number;
}): Promise<object> {
  const url = new URL(`${NOMINATIM_BASE}/reverse`);
  url.searchParams.set("lat", String(params.latitude));
  url.searchParams.set("lon", String(params.longitude));
  url.searchParams.set("format", "json");
  const res = await fetch(url.toString(), { headers: HEADERS });
  if (!res.ok) {
    return {
      success: false,
      error: `Reverse geocoding failed: ${res.statusText}`,
      coordinates: { latitude: params.latitude, longitude: params.longitude },
    };
  }
  const data = (await res.json()) as Record<string, unknown>;
  return {
    success: true,
    coordinates: { latitude: params.latitude, longitude: params.longitude },
    address: data.display_name ?? "",
    raw_data: data,
    timestamp: new Date().toISOString(),
  };
}

/** 经纬度 → 城市名（用于定位作默认出发地）；失败返回 null。 */
export async function extractCityFromLocation(latitude: number, longitude: number): Promise<string | null> {
  try {
    const r = (await reverseGeocode({ latitude, longitude })) as Record<string, any>;
    if (!r || r.success !== true) return null;
    const addr = (r.raw_data && r.raw_data.address) || {};
    const city = addr.city ?? addr.town ?? addr.municipality ?? addr.county ?? addr.state_district ?? addr.state ?? addr.country;
    return city && typeof city === "string" ? city : null;
  } catch {
    return null;
  }
}

/** Haversine distance in km. */
function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export async function batchGeocode(locations: string[]): Promise<object> {
  const results: object[] = [];
  let successful = 0;
  let failed = 0;
  for (const location of locations) {
    const result = await geocodeLocation({ location });
    results.push(result);
    if ((result as Record<string, unknown>).success) successful++;
    else failed++;
  }
  return {
    batch_id: `batch_${Date.now()}`,
    total_locations: locations.length,
    successful,
    failed,
    results,
  };
}

export function calculateDistance(params: {
  lat1: number;
  lon1: number;
  lat2: number;
  lon2: number;
  unit?: string;
}): object {
  const km = haversineKm(params.lat1, params.lon1, params.lat2, params.lon2);
  const unit = (params.unit ?? "km").toLowerCase();
  let distance: number;
  if (unit === "miles") distance = km / 1.60934;
  else if (unit === "nm") distance = km / 1.852;
  else distance = km;
  return {
    success: true,
    distance: Math.round(distance * 100) / 100,
    unit: unit === "nm" ? "nm" : unit === "miles" ? "miles" : "km",
    point1: { latitude: params.lat1, longitude: params.lon1 },
    point2: { latitude: params.lat2, longitude: params.lon2 },
    calculation_method: "geodesic",
  };
}
