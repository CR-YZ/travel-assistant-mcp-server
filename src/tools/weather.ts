const NWS_BASE = "https://api.weather.gov";
const HEADERS = {
  "User-Agent": "TravelAssistantMCP/1.0 (travel-planning)",
  Accept: "application/geo+json, application/json",
};

export async function getLocationInfo(lat: number, lon: number): Promise<object> {
  const res = await fetch(`${NWS_BASE}/points/${lat},${lon}`, { headers: HEADERS });
  if (!res.ok) return { error: `Failed to get location info: ${res.statusText}` };
  const data = (await res.json()) as Record<string, unknown>;
  const props = (data.properties ?? {}) as Record<string, unknown>;
  const relLoc = (props.relativeLocation ?? {}) as Record<string, unknown>;
  const relProps = (relLoc.properties ?? {}) as Record<string, unknown>;
  return {
    location: { latitude: lat, longitude: lon, city: relProps.city ?? "Unknown", state: relProps.state ?? "Unknown" },
    grid: { office: props.cwa, gridX: props.gridX, gridY: props.gridY },
    forecast_endpoints: {
      forecast: props.forecast,
      forecast_hourly: props.forecastHourly,
    },
    observation_stations: props.observationStations,
    time_zone: props.timeZone,
  };
}

export async function getCurrentConditions(lat: number, lon: number): Promise<object> {
  const locationInfo = await getLocationInfo(lat, lon);
  if ("error" in locationInfo) return locationInfo;
  const stationsUrl = (locationInfo as Record<string, unknown>).observation_stations as string;
  if (!stationsUrl) return { error: "No observation stations found for this location" };
  const stationsRes = await fetch(stationsUrl, { headers: HEADERS });
  if (!stationsRes.ok) return { error: "Failed to fetch observation stations" };
  const stationsData = (await stationsRes.json()) as Record<string, unknown>;
  const features = (stationsData.features ?? []) as Array<Record<string, unknown>>;
  const firstStation = features[0];
  if (!firstStation) return { error: "No stations available" };
  const stationId = (firstStation.properties as Record<string, unknown>)?.stationIdentifier as string;
  const observationsRes = await fetch(
    `${NWS_BASE}/stations/${stationId}/observations/latest`,
    { headers: HEADERS }
  );
  if (!observationsRes.ok) return { error: "Failed to fetch current conditions" };
  const obs = (await observationsRes.json()) as Record<string, unknown>;
  const obsProps = (obs.properties ?? {}) as Record<string, unknown>;
  return {
    location: (locationInfo as Record<string, unknown>).location,
    temperature: obsProps.temperature,
    dewpoint: obsProps.dewpoint,
    windSpeed: obsProps.windSpeed,
    windDirection: obsProps.windDirection,
    visibility: obsProps.visibility,
    textDescription: obsProps.textDescription,
    timestamp: obsProps.timestamp,
  };
}

export async function getWeatherForecast(
  lat: number,
  lon: number,
  hourly = false
): Promise<object> {
  const locationInfo = await getLocationInfo(lat, lon);
  if ("error" in locationInfo) return locationInfo;
  const forecastEndpoints = (locationInfo as Record<string, unknown>).forecast_endpoints as Record<string, string>;
  const url = hourly ? forecastEndpoints?.forecast_hourly : forecastEndpoints?.forecast;
  if (!url) return { error: "No forecast URL for this location" };
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) return { error: `Failed to get forecast: ${res.statusText}` };
  const data = (await res.json()) as Record<string, unknown>;
  const periods = ((data.properties ?? {}) as Record<string, unknown>).periods as Array<Record<string, unknown>>;
  const maxPeriods = hourly ? 24 : 14;
  return {
    location: (locationInfo as Record<string, unknown>).location,
    forecast_type: hourly ? "hourly" : "daily",
    periods: (periods ?? []).slice(0, maxPeriods).map((p) => ({
      name: p.name,
      temperature: p.temperature,
      temperatureUnit: p.temperatureUnit,
      windSpeed: p.windSpeed,
      shortForecast: p.shortForecast,
      detailedForecast: p.detailedForecast,
      startTime: p.startTime,
      endTime: p.endTime,
    })),
  };
}

export async function getWeatherAlerts(params: {
  area?: string;
  region?: string;
  zone?: string;
  point?: [number, number];
  active_only?: boolean;
  urgency?: string;
  severity?: string;
  certainty?: string;
}): Promise<object> {
  const active = params.active_only !== false;
  const endpoint = active ? `${NWS_BASE}/alerts/active` : `${NWS_BASE}/alerts`;
  const searchParams = new URLSearchParams();
  if (params.area) searchParams.set("area", params.area);
  if (params.region) searchParams.set("region", params.region);
  if (params.zone) searchParams.set("zone", params.zone);
  if (params.point) searchParams.set("point", `${params.point[0]},${params.point[1]}`);
  if (params.urgency) searchParams.set("urgency", params.urgency);
  if (params.severity) searchParams.set("severity", params.severity);
  if (params.certainty) searchParams.set("certainty", params.certainty);
  const qs = searchParams.toString();
  const url = qs ? `${endpoint}?${qs}` : endpoint;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) return { error: `Failed to get alerts: ${res.statusText}` };
  const data = (await res.json()) as Record<string, unknown>;
  const features = (data.features ?? []) as Array<Record<string, unknown>>;
  const alerts = features.map((f) => {
    const props = (f.properties ?? {}) as Record<string, unknown>;
    return {
      id: props.id,
      area_desc: props.areaDesc,
      sent: props.sent,
      effective: props.effective,
      expires: props.expires,
      severity: props.severity,
      certainty: props.certainty,
      urgency: props.urgency,
      headline: props.headline,
      description: props.description,
      event: props.event,
    };
  });
  return {
    search_parameters: {
      area: params.area,
      region: params.region,
      zone: params.zone,
      point: params.point,
      active_only: active,
      urgency: params.urgency,
      severity: params.severity,
      certainty: params.certainty,
    },
    total_alerts: alerts.length,
    alerts,
  };
}
