import { kvGet, kvSet, kvAvailable } from "../kv";

const SERPAPI_BASE = "https://serpapi.com/search";

function getSerpApiKey(): string {
  const key = process.env.SERPAPI_KEY;
  if (!key) throw new Error("SERPAPI_KEY environment variable is required");
  return key;
}

export async function searchEvents(params: {
  query: string;
  location?: string;
  date_filter?: string;
  event_type?: string;
  max_results?: number;
}): Promise<object> {
  const apiKey = getSerpApiKey();
  const q = params.location ? `${params.query} in ${params.location}` : params.query;
  const searchParams: Record<string, string> = {
    engine: "google_events",
    api_key: apiKey,
    q,
    hl: "en",
    gl: "us",
  };
  const htichips: string[] = [];
  if (params.date_filter) htichips.push(`date:${params.date_filter}`);
  if (params.event_type) htichips.push(`event_type:${params.event_type}`);
  if (htichips.length) searchParams.htichips = htichips.join(",");
  const url = new URL(SERPAPI_BASE);
  Object.entries(searchParams).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString());
  if (!res.ok) return { error: `API request failed: ${res.statusText}` };
  const data = (await res.json()) as Record<string, unknown>;
  const maxResults = params.max_results ?? 20;
  const eventsResults = (data.events_results as object[])?.slice(0, maxResults) ?? [];
  const searchId = `${params.query.replace(/\s/g, "_")}_${params.location ?? "global"}_${Date.now()}`;
  const processed = {
    search_metadata: {
      search_id: searchId,
      query: params.query,
      location: params.location,
      date_filter: params.date_filter,
      event_type: params.event_type,
      search_timestamp: new Date().toISOString(),
      total_results: eventsResults.length,
    },
    events_results: eventsResults,
  };
  if (kvAvailable()) await kvSet(`event:${searchId}`, processed);
  const sample = eventsResults.slice(0, 3).map((e) => {
    const ev = e as Record<string, unknown>;
    const venue = ev.venue as Record<string, unknown> | undefined;
    // google_events 结果可能带票价（event.offer / price / ticket info）。
    const price = (() => {
      const offer = (ev.offer ?? ev.price ?? ev.ticket_info) as
        | { price?: number | string; currency?: string; price_low?: number; price_high?: number }
        | number
        | string
        | undefined;
      if (typeof offer === "number") return { amount: offer };
      if (typeof offer === "string") return { amount: Number(offer) || undefined, raw: offer };
      if (offer && typeof offer === "object") {
        const amount = offer.price ?? offer.price_low ?? offer.price_high;
        return { amount: typeof amount === "number" ? amount : undefined, currency: offer.currency };
      }
      return undefined;
    })();
    return {
      title: ev.title ?? "N/A",
      date: (ev.date as Record<string, unknown>)?.when ?? "N/A",
      venue: venue?.name ?? "N/A",
      price,
    };
  });
  return {
    search_id: searchId,
    total_events: eventsResults.length,
    query: params.query,
    location: params.location,
    filters_applied: { date_filter: params.date_filter },
    sample_events: sample,
    search_parameters: processed.search_metadata,
  };
}

export async function getEventDetails(searchId: string): Promise<string> {
  if (!kvAvailable()) {
    return "Vercel KV is not configured. Set KV_REST_API_URL and KV_REST_API_TOKEN to use get_event_details.";
  }
  const data = await kvGet<Record<string, unknown>>(`event:${searchId}`);
  if (!data) return `No event search found with ID: ${searchId}`;
  return JSON.stringify(data, null, 2);
}

export async function filterEventsByDate(
  searchId: string,
  dateRange?: string,
  specificDate?: string
): Promise<string> {
  if (!kvAvailable()) {
    return "Vercel KV is not configured. Set KV_REST_API_URL and KV_REST_API_TOKEN to use filter_events_by_date.";
  }
  const data = await kvGet<Record<string, unknown>>(`event:${searchId}`);
  if (!data) return `No event search found with ID: ${searchId}`;
  const events = (data.events_results as Array<Record<string, unknown>>) ?? [];
  const filtered = events.filter((event) => {
    const dateWhen = String((event.date as Record<string, unknown>)?.when ?? "").toLowerCase();
    if (dateRange) return dateWhen.includes(dateRange.toLowerCase());
    if (specificDate) return dateWhen.includes(specificDate);
    return true;
  });
  return JSON.stringify(
    {
      search_id: searchId,
      filters_applied: { date_range: dateRange, specific_date: specificDate },
      filtered_events: filtered,
      total_filtered: filtered.length,
    },
    null,
    2
  );
}

export async function filterEventsByType(
  searchId: string,
  eventTypes: string[]
): Promise<string> {
  if (!kvAvailable()) {
    return "Vercel KV is not configured. Set KV_REST_API_URL and KV_REST_API_TOKEN to use filter_events_by_type.";
  }
  const data = await kvGet<Record<string, unknown>>(`event:${searchId}`);
  if (!data) return `No event search found with ID: ${searchId}`;
  const events = (data.events_results as Array<Record<string, unknown>>) ?? [];
  const typesLower = eventTypes.map((t) => t.toLowerCase());
  const filtered = events.filter((event) => {
    const title = String(event.title ?? "").toLowerCase();
    const desc = String(event.description ?? "").toLowerCase();
    return typesLower.some((t) => title.includes(t) || desc.includes(t));
  });
  return JSON.stringify(
    {
      search_id: searchId,
      filters_applied: { event_types: eventTypes },
      filtered_events: filtered,
      total_filtered: filtered.length,
    },
    null,
    2
  );
}

export async function filterEventsByVenue(
  searchId: string,
  venueNames: string[]
): Promise<string> {
  if (!kvAvailable()) {
    return "Vercel KV is not configured. Set KV_REST_API_URL and KV_REST_API_TOKEN to use filter_events_by_venue.";
  }
  const data = await kvGet<Record<string, unknown>>(`event:${searchId}`);
  if (!data) return `No event search found with ID: ${searchId}`;
  const events = (data.events_results as Array<Record<string, unknown>>) ?? [];
  const filtered = events.filter((event) => {
    const venue = event.venue as Record<string, unknown> | undefined;
    const name = String(venue?.name ?? "").toLowerCase();
    return venueNames.some((v) => name.includes(v.toLowerCase()));
  });
  return JSON.stringify(
    {
      search_id: searchId,
      filters_applied: { venue_names: venueNames },
      filtered_events: filtered,
      total_filtered: filtered.length,
    },
    null,
    2
  );
}
