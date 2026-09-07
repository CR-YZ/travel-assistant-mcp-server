# Travel Assistant MCP Server

A **Next.js** MCP (Model Context Protocol) server that provides travel planning tools: flights, hotels, events, geocoding, weather (NWS), and finance. Use it from Cursor, Claude Desktop, or any MCP client that supports Streamable HTTP.

![MCP](https://img.shields.io/badge/MCP-Compatible-blue)
![Next.js](https://img.shields.io/badge/Next.js-14-black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)
![License](https://img.shields.io/badge/License-MIT-yellow)

## Overview

Single HTTP MCP endpoint at **`/api/mcp`** exposing:

| Category   | Tools |
|-----------|--------|
| **Flight** | `search_flights`, `get_flight_details`, `filter_flights_by_price`, `filter_flights_by_airline` |
| **Hotel**  | `search_hotels`, `get_hotel_details`, `get_property_details`, `filter_hotels_by_price`, `filter_hotels_by_rating`, `filter_hotels_by_amenities`, `filter_hotels_by_class` |
| **Event**  | `search_events`, `get_event_details`, `filter_events_by_date`, `filter_events_by_type`, `filter_events_by_venue` |
| **Geocoder** | `geocode_location`, `reverse_geocode`, `calculate_distance`, `batch_geocode` |
| **Weather** (US, NWS) | `get_location_info`, `get_current_conditions`, `get_weather_forecast` (daily/hourly), `get_weather_alerts` |
| **Finance** | `convert_currency`, `lookup_stock`, `get_market_overview`, `get_historical_data`, `get_finance_details`, `filter_stocks_by_price_movement` |

**Prompts** (when the client supports MCP prompts): `event_discovery`, `event_comparison`, `travel_planning`, `flight_comparison`, `hotel_planning`, `hotel_comparison`, `stock_analysis`, `weather_planning`, `location_analysis`.

Tools that take a `search_id` (e.g. `get_flight_details`, `filter_flights_by_price`) require **Vercel KV**. Without KV, search tools still return summaries; detail/filter tools will report that KV is not configured.

## Project structure

```
mcp_travelassistant/
├── app/
│   └── api/mcp/route.ts    # MCP handler: tool + prompt registration
├── src/
│   ├── tools/              # Tool implementations
│   │   ├── cache.ts        # SerpAPI 查询结果缓存层（成本控制，§5/§8）
│   │   ├── event.ts
│   │   ├── flight.ts
│   │   ├── finance.ts
│   │   ├── geocoder.ts
│   │   ├── hotel.ts
│   │   ├── weather.ts
│   │   ├── price-normalize.ts / anomaly.ts / itinerary.ts / cost-of-living.ts / city-cost.ts
│   │   └── __tests__/      # detection.example.mts / cache.example.mts / cache.integration.example.mts
│   ├── prompts/index.ts    # Prompt templates
│   └── kv.ts               # Vercel KV 存取（search_id 续接 + 缓存后端）
├── .env.example
├── next.config.js
├── package.json
├── tsconfig.json
└── vercel.json
```

**Tech stack:** Next.js 14, TypeScript, [mcp-handler](https://www.npmjs.com/package/mcp-handler), Zod, optional [Vercel KV](https://vercel.com/storage/kv).

## Prerequisites

- **Node.js 18+**
- **[SerpAPI key](https://serpapi.com/)** for flights, hotels, events, finance
- **Optional:** [Vercel KV](https://vercel.com/storage/kv) for `get_*_details` and `filter_*` tools

## Quick start

```bash
git clone <repo-url>
cd mcp_travelassistant
npm install
```

Copy `.env.example` to `.env.local` and set at least:

```bash
SERPAPI_KEY=your_serpapi_key_here
```

Optional (for detail/filter tools):

```bash
KV_REST_API_URL=https://...
KV_REST_API_TOKEN=...
```

Optional (cache TTL, seconds; clamped to 1h–24h):

```bash
CACHE_TTL_SECONDS=3600
```

Optional (free daily analysis limit for expensive tools, default 2):

```bash
FREE_DAILY_LIMIT=2
```

Optional (**real WeChat Pay**; without these the unlock flow runs in **mock** mode):

```bash
WECHAT_APPID=...
WECHAT_MCHID=...
WECHAT_PAY_SERIAL_NO=...
WECHAT_PAY_API_V3_KEY=...
WECHAT_PAY_MCH_PRIVATE_KEY=...
WECHAT_PAY_NOTIFY_URL=https://<your-project>.vercel.app/api/pay
WECHAT_CODE2SESSION_SECRET=...
```

### Caching (cost control)

`search_flights` / `search_hotels` are cached by normalized query params via `src/tools/cache.ts`.
- **Backend:** Vercel KV (Upstash Redis) when `KV_REST_API_URL`/`KV_REST_API_TOKEN` are set; otherwise a process-local in-memory cache.
- **Hit behavior:** the same query within the TTL returns instantly (`cache_status: "hit"`) and does **not** consume another SerpAPI search — this is how the product keeps per-user cost low (《04-tech-data-plan.md》§5).
- Responses include `cache_status: "hit" | "miss"` so callers can observe hit rate; failures (with an `error` field) are not cached.

### Free-user rate limiting (cost control)

`analyze_travel` / `generate_trip_plan` (the expensive, multi-SerpAPI-call tools) are quota-gated per client per day via `src/quota.ts`:

- **Limit:** `FREE_DAILY_LIMIT` (default **2**), reset on UTC day boundary.
- **Count store:** Vercel KV (atomic `incr`) when configured; otherwise in-memory.
- **Identity:** `x-client-id` / `x-user-id` request header → `arguments.user_id` → fallback `anon`.
- **On exceed:** returns a normal JSON-RPC result `{ quota_exceeded: true, limit, remaining: 0, message }` (HTTP 200) so the UI can show the ¥10 paywall. Free search / compare / anomaly hints stay unlimited (per PRD).

### Real search (`search_analyze`)

`search_analyze` does a real SerpAPI search (`search_flights` / `search_hotels`) → maps results into candidates → runs the same `normalize + anomaly + trip_plan` pipeline in one call (`src/tools/analyze-core.ts` + `src/tools/map-candidates.ts`). The frontend passes `route` (airport codes + dates) and/or `hotel` (location + dates). This replaces demo candidates with real search prices.

### Payment (WeChat Pay, ¥10 unlock)

- **Endpoint:** `POST /api/pay` (create order) and `GET /api/pay?order_id=...` (verify paid), implemented in `src/payment.ts` (`app/api/pay/route.ts`).
- **Real mode:** when `WECHAT_*` env vars are present, uses WeChat Pay API v3 (JSAPI unified order + RSA-signed `wx.requestPayment` params). Requires `openid` (from `wx.login` → `code2session`).
- **Mock mode:** without merchant credentials it returns `mock: true` with a simulated prepay/paySign, and `verify` returns `paid: true` — so the demo unlock flow works end-to-end without real money. This is clearly labelled (not a real transaction).

Run locally:

```bash
npm run dev
```

MCP endpoint: **http://localhost:3000/api/mcp**

## Deploy on Vercel

1. Push to GitHub and [import the project on Vercel](https://vercel.com/new).
2. In **Project → Settings → Environment Variables**, add:
   - `SERPAPI_KEY` (required)
   - `KV_REST_API_URL` and `KV_REST_API_TOKEN` (optional, for detail/filter tools)
3. Deploy. Your MCP URL will be:

   ```
   https://<your-project>.vercel.app/api/mcp
   ```

The API route is configured with `maxDuration: 60` in `vercel.json` for longer tool runs.

## Use with MCP clients

**Cursor (Streamable HTTP)**  
In Cursor settings (MCP), add:

```json
{
  "mcpServers": {
    "travel-assistant": {
      "url": "https://<your-project>.vercel.app/api/mcp"
    }
  }
}
```

For local dev, use `http://localhost:3000/api/mcp`.

**Claude Desktop / stdio clients**  
Use [mcp-remote](https://www.npmjs.com/package/mcp-remote) to bridge HTTP to stdio:

```json
{
  "mcpServers": {
    "travel-assistant": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://<your-project>.vercel.app/api/mcp"]
    }
  }
}
```

## Example request

*"Plan a trip from Reston, VA to Banff, Alberta June 7–14, 2025. Find flights, hotels in Banff, events there, and weather. Budget $5000 USD; convert CAD to USD."*

The assistant can chain: `geocode_location` → `search_flights` / `search_hotels` / `search_events` → `get_weather_forecast` → `convert_currency` and synthesize a day-by-day itinerary with costs in USD.

## Scripts

| Command         | Description                |
|----------------|----------------------------|
| `npm run dev`  | Start dev server (port 3000) |
| `npm run build`| Production build           |
| `npm run start`| Start production server    |

## Troubleshooting

- **"SERPAPI_KEY environment variable is required"**  
  Set `SERPAPI_KEY` in `.env.local` (local) or in Vercel environment variables.

- **"Vercel KV is not configured"**  
  Detail/filter tools need KV. Create a Vercel KV store and set `KV_REST_API_URL` and `KV_REST_API_TOKEN`, or use only the search tools (they work without KV and return summaries).

- **Weather tools**  
  NWS APIs cover the US only. Use `geocode_location` first to get coordinates if you have a city name.

## License

MIT.
