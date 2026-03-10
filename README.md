# Travel Assistant MCP Server

A **Next.js** MCP (Model Context Protocol) server that provides travel planning tools: flights, hotels, events, geocoding, weather (NWS), and finance. Use it from Cursor, Claude Desktop, or any MCP client that supports Streamable HTTP.

![MCP](https://img.shields.io/badge/MCP-Compatible-blue)
![Next.js](https://img.shields.io/badge/Next.js-14-black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)
![License](https://img.shields.io/badge/License-MIT-yellow)

## Overview

Single HTTP MCP endpoint at `/api/mcp` exposing:

| Category   | Tools |
|-----------|--------|
| **Flight** | `search_flights`, `get_flight_details`, `filter_flights_by_price`, `filter_flights_by_airline` |
| **Hotel**  | `search_hotels`, `get_hotel_details`, `get_property_details`, `filter_hotels_by_price`, `filter_hotels_by_rating`, `filter_hotels_by_amenities`, `filter_hotels_by_class` |
| **Event**  | `search_events`, `get_event_details`, `filter_events_by_date`, `filter_events_by_type`, `filter_events_by_venue` |
| **Geocoder** | `geocode_location`, `reverse_geocode`, `calculate_distance`, `batch_geocode` |
| **Weather** (US, NWS) | `get_location_info`, `get_current_conditions`, `get_weather_forecast` (daily/hourly), `get_weather_alerts` |
| **Finance** | `convert_currency`, `lookup_stock`, `get_market_overview`, `get_historical_data`, `get_finance_details`, `filter_stocks_by_price_movement` |

**Prompts** (when the client supports MCP prompts): `event_discovery`, `event_comparison`, `travel_planning`, `flight_comparison`, `hotel_planning`, `hotel_comparison`, `stock_analysis`, `weather_planning`, `location_analysis`.

Tools that take a `search_id` (e.g. `get_flight_details`, `filter_flights_by_price`) need **Vercel KV**; without KV, search tools still return summaries and the detail/filter tools report that KV is not configured.

## Project structure

```
├── app/api/mcp/route.ts   # MCP handler: tools + prompts
├── src/
│   ├── servers/           # Tool implementations (event, flight, finance, geocoder, hotel, weather)
│   ├── tools/             # Re-exports from servers (used by route)
│   ├── prompts/           # Prompt templates
│   └── kv.ts              # Optional Vercel KV for storing search results
├── servers/               # Optional Python MCP servers (reference)
├── .env.example
├── package.json
└── vercel.json
```

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

| Command       | Description        |
|--------------|--------------------|
| `npm run dev`   | Start dev server (port 3000) |
| `npm run build` | Production build   |
| `npm run start` | Start production server |

## Optional: Python reference servers

The `servers/` directory contains standalone Python MCP servers (event, flight, finance, geocoder, hotel, weather) that mirror the tool set. They are optional; the **Next.js app is the main deployable server**. To run the Python servers locally with Claude Desktop, use UV and point each server’s `main.py` (or equivalent) in your MCP config; see each `servers/<name>_server/README.md` for details.

## Troubleshooting

- **"SERPAPI_KEY environment variable is required"**  
  Set `SERPAPI_KEY` in `.env.local` (local) or in Vercel environment variables.

- **"Vercel KV is not configured"**  
  Detail/filter tools need KV. Either create a Vercel KV store and set `KV_REST_API_URL` and `KV_REST_API_TOKEN`, or use only the search tools (they work without KV and return summaries).

- **Weather tools**  
  NWS APIs cover the US only. Use `geocode_location` first to get coordinates if you have a city name.

## License

MIT. See [LICENSE](LICENSE) if present.
