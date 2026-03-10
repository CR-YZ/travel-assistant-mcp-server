import { kvGet, kvSet, kvAvailable } from "../kv";

const SERPAPI_BASE = "https://serpapi.com/search";
const KV_PREFIX = "finance:";

function getSerpApiKey(): string {
  const key = process.env.SERPAPI_KEY;
  if (!key) throw new Error("SERPAPI_KEY environment variable is required");
  return key;
}

export async function convertCurrency(params: {
  from_currency: string;
  to_currency: string;
  amount?: number;
}): Promise<object> {
  const apiKey = getSerpApiKey();
  const query = `${params.from_currency.toUpperCase()}-${params.to_currency.toUpperCase()}`;
  const url = new URL(SERPAPI_BASE);
  url.searchParams.set("engine", "google_finance");
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("q", query);
  url.searchParams.set("hl", "en");
  const res = await fetch(url.toString());
  if (!res.ok) return { error: `API request failed: ${res.statusText}` };
  const data = (await res.json()) as Record<string, unknown>;
  const summary = (data.summary ?? {}) as Record<string, unknown>;
  const rate = Number(summary.extracted_price ?? 0);
  const amount = params.amount ?? 1;
  const searchId = `currency_${params.from_currency.toLowerCase()}_${params.to_currency.toLowerCase()}_${Date.now()}`;
  const toStore = {
    search_metadata: { search_id: searchId, search_type: "currency", from_currency: params.from_currency.toUpperCase(), to_currency: params.to_currency.toUpperCase(), amount, search_timestamp: new Date().toISOString() },
    summary: data.summary,
    graph: data.graph,
    markets: data.markets,
  };
  if (kvAvailable()) await kvSet(KV_PREFIX + searchId, toStore);
  return {
    search_id: searchId,
    from_currency: params.from_currency.toUpperCase(),
    to_currency: params.to_currency.toUpperCase(),
    original_amount: amount,
    exchange_rate: rate,
    converted_amount: amount * rate,
    rate_change: summary.price_movement ?? {},
    last_updated: new Date().toISOString(),
  };
}

export async function lookupStock(params: {
  symbol: string;
  exchange?: string;
  window?: string;
}): Promise<object> {
  const apiKey = getSerpApiKey();
  let query = params.symbol.toUpperCase();
  if (params.exchange) query += `:${params.exchange.toUpperCase()}`;
  const url = new URL(SERPAPI_BASE);
  url.searchParams.set("engine", "google_finance");
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("q", query);
  url.searchParams.set("hl", "en");
  if (params.window) url.searchParams.set("window", params.window.toUpperCase());
  const res = await fetch(url.toString());
  if (!res.ok) return { error: `API request failed: ${res.statusText}` };
  const data = (await res.json()) as Record<string, unknown>;
  const summary = (data.summary ?? {}) as Record<string, unknown>;
  const searchId = `stock_${params.symbol.toLowerCase()}${params.exchange ? `_${params.exchange.toLowerCase()}` : ""}_${Date.now()}`;
  const toStore = {
    search_metadata: { search_id: searchId, search_type: "stock", symbol: params.symbol.toUpperCase(), exchange: params.exchange, window: params.window, search_timestamp: new Date().toISOString() },
    summary: data.summary,
    graph: data.graph,
    knowledge_graph: data.knowledge_graph,
    news_results: data.news_results,
    financials: data.financials,
    key_events: data.key_events,
  };
  if (kvAvailable()) await kvSet(KV_PREFIX + searchId, toStore);
  return {
    search_id: searchId,
    symbol: params.symbol.toUpperCase(),
    company_name: summary.title ?? "N/A",
    exchange: summary.exchange ?? params.exchange ?? "N/A",
    current_price: summary.extracted_price ?? 0,
    currency: summary.currency ?? "USD",
    price_movement: summary.price_movement ?? {},
    market_status: summary.market ?? {},
    last_updated: new Date().toISOString(),
  };
}

export async function getMarketOverview(): Promise<object> {
  const apiKey = getSerpApiKey();
  const url = new URL(SERPAPI_BASE);
  url.searchParams.set("engine", "google_finance");
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("q", "GOOGL:NASDAQ");
  url.searchParams.set("hl", "en");
  const res = await fetch(url.toString());
  if (!res.ok) return { error: `API request failed: ${res.statusText}` };
  const data = (await res.json()) as Record<string, unknown>;
  const markets = (data.markets ?? {}) as Record<string, unknown>;
  const searchId = `market_overview_${Date.now()}`;
  const toStore = {
    search_metadata: { search_id: searchId, search_type: "market_overview", search_timestamp: new Date().toISOString() },
    markets,
  };
  if (kvAvailable()) await kvSet(KV_PREFIX + searchId, toStore);
  return {
    search_id: searchId,
    us_markets: (markets.us as unknown[])?.slice(0, 5) ?? [],
    european_markets: (markets.europe as unknown[])?.slice(0, 5) ?? [],
    asian_markets: (markets.asia as unknown[])?.slice(0, 5) ?? [],
    major_currencies: (markets.currencies as unknown[])?.slice(0, 10) ?? [],
    cryptocurrencies: (markets.crypto as unknown[])?.slice(0, 10) ?? [],
    futures: (markets.futures as unknown[])?.slice(0, 5) ?? [],
    last_updated: new Date().toISOString(),
  };
}

export async function getHistoricalData(params: {
  symbol: string;
  exchange?: string;
  window?: string;
}): Promise<object> {
  const apiKey = getSerpApiKey();
  let query = params.symbol.toUpperCase();
  if (params.exchange) query += `:${params.exchange.toUpperCase()}`;
  const url = new URL(SERPAPI_BASE);
  url.searchParams.set("engine", "google_finance");
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("q", query);
  url.searchParams.set("window", (params.window ?? "1Y").toUpperCase());
  url.searchParams.set("hl", "en");
  const res = await fetch(url.toString());
  if (!res.ok) return { error: `API request failed: ${res.statusText}` };
  const data = (await res.json()) as Record<string, unknown>;
  const graph = (data.graph ?? []) as Array<Record<string, unknown>>;
  const keyEvents = (data.key_events ?? []) as unknown[];
  const searchId = `historical_${params.symbol.toLowerCase()}${params.exchange ? `_${params.exchange.toLowerCase()}` : ""}_${(params.window ?? "1Y").toLowerCase()}_${Date.now()}`;
  const toStore = {
    search_metadata: { search_id: searchId, search_type: "historical", symbol: params.symbol.toUpperCase(), exchange: params.exchange, window: params.window ?? "1Y", search_timestamp: new Date().toISOString() },
    summary: data.summary,
    graph,
    key_events: keyEvents,
    data_points: graph.length,
  };
  if (kvAvailable()) await kvSet(KV_PREFIX + searchId, toStore);
  const prices = graph.map((p) => Number(p.price)).filter((n) => !Number.isNaN(n));
  const statistics =
    prices.length > 0
      ? {
          min_price: Math.min(...prices),
          max_price: Math.max(...prices),
          avg_price: prices.reduce((a, b) => a + b, 0) / prices.length,
          price_range: Math.max(...prices) - Math.min(...prices),
          total_data_points: prices.length,
        }
      : {};
  return {
    search_id: searchId,
    symbol: params.symbol.toUpperCase(),
    window: (params.window ?? "1Y").toUpperCase(),
    statistics,
    key_events_count: keyEvents.length,
    has_data: graph.length > 0,
    last_updated: new Date().toISOString(),
  };
}

export async function getFinanceDetails(searchId: string): Promise<string> {
  if (!kvAvailable()) {
    return "Vercel KV is not configured. Set KV_REST_API_URL and KV_REST_API_TOKEN to use get_finance_details.";
  }
  const data = await kvGet<Record<string, unknown>>(KV_PREFIX + searchId);
  if (!data) return `No finance search found with ID: ${searchId}`;
  return JSON.stringify(data, null, 2);
}

export async function filterStocksByPriceMovement(
  searchId: string,
  minPercentage?: number,
  maxPercentage?: number,
  movementType?: string
): Promise<string> {
  if (!kvAvailable()) {
    return "Vercel KV is not configured. Set KV_REST_API_URL and KV_REST_API_TOKEN to use filter_stocks_by_price_movement.";
  }
  const data = await kvGet<Record<string, unknown>>(KV_PREFIX + searchId);
  if (!data) return `No finance search found with ID: ${searchId}`;
  const markets = (data.markets ?? {}) as Record<string, unknown[]>;
  const filter = (item: Record<string, unknown>) => {
    const pm = (item.price_movement ?? {}) as Record<string, unknown>;
    const pct = Math.abs(Number(pm.percentage ?? 0));
    const movement = String(pm.movement ?? "");
    if (minPercentage != null && pct < minPercentage) return false;
    if (maxPercentage != null && pct > maxPercentage) return false;
    if (movementType && movement !== movementType) return false;
    return true;
  };
  const filteredMarkets: Record<string, unknown[]> = {};
  for (const [region, items] of Object.entries(markets)) {
    if (Array.isArray(items)) {
      const filtered = items.filter((i) => filter(i as Record<string, unknown>));
      if (filtered.length) filteredMarkets[region] = filtered;
    }
  }
  return JSON.stringify(
    {
      search_id: searchId,
      filters_applied: { min_percentage: minPercentage, max_percentage: maxPercentage, movement_type: movementType },
      filtered_markets: filteredMarkets,
      total_filtered: Object.values(filteredMarkets).reduce((s, a) => s + a.length, 0),
    },
    null,
    2
  );
}
