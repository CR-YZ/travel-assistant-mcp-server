import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import * as flight from "@/src/tools/flight";
import * as hotel from "@/src/tools/hotel";
import * as event from "@/src/tools/event";
import * as geocoder from "@/src/tools/geocoder";
import * as weather from "@/src/tools/weather";
import * as finance from "@/src/tools/finance";
import * as prompts from "@/src/prompts";
import { normalizeMany, normalizePrice, PriceInputSchema } from "@/src/tools/price-normalize";
import { detectAnomalies, effectiveTotal, AnomalyCandidateSchema } from "@/src/tools/anomaly";
import { buildTripPlan, TripIntentSchema } from "@/src/tools/itinerary";
import { getLivingCost } from "@/src/tools/cost-of-living";
import { consumeDailyQuota } from "@/src/quota";
import { runAnalysis, type AnalysisCandidate } from "@/src/tools/analyze-core";
import { flightsToCandidates, hotelsToCandidates } from "@/src/tools/map-candidates";
import { parseTripIntent, applyTripUpdate, chatTurn } from "@/src/tools/nlu";
import { searchAndAnalyze } from "@/src/tools/planner";
import { nearestCityFromLocation } from "@/src/tools/geo";

function textContent(value: object | string): { type: "text"; text: string } {
  return {
    type: "text",
    text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
  };
}

function promptMessage(role: "user" | "assistant", text: string) {
  return { role, content: { type: "text" as const, text } };
}

/** 出发地：文本解析的 origin 优先；否则用定位→就近主要城市（无网络）；再否则 Nominatim；最后回退上海。 */
async function resolveOrigin(originFromText: string | undefined, location?: { latitude?: number; longitude?: number }): Promise<string> {
  if (originFromText && originFromText.trim()) return originFromText;
  if (location && typeof location.latitude === "number" && typeof location.longitude === "number") {
    const near = nearestCityFromLocation(location.latitude, location.longitude);
    if (near) return near;
    try {
      const city = await geocoder.extractCityFromLocation(location.latitude, location.longitude);
      if (city) return city;
    } catch { /* 反解析失败 → 回退 */ }
  }
  return "上海";
}

function buildServer(): McpServer {
  const server = new McpServer({
    name: "travel-assistant",
    version: "1.0.0",
  });
    // --- Flight ---
    server.registerTool(
      "search_flights",
      {
        title: "Search Flights",
        description:
          "Search for flights using SerpAPI Google Flights. Returns search_id for get_flight_details and filter_flights_by_price.",
        inputSchema: {
          departure_id: z.string().describe("Departure airport code e.g. LAX, JFK"),
          arrival_id: z.string().describe("Arrival airport code e.g. CDG, YYC"),
          outbound_date: z.string().describe("Departure date YYYY-MM-DD"),
          return_date: z.string().optional().describe("Return date for round trip"),
          trip_type: z.number().int().min(1).max(3).optional().default(1),
          adults: z.number().int().min(1).optional().default(1),
          currency: z.string().optional().default("USD"),
          max_results: z.number().int().min(1).optional().default(10),
        },
      },
      async (args) => {
        const result = await flight.searchFlights(args);
        return { content: [textContent(result)] };
      }
    );
    server.registerTool(
      "get_flight_details",
      {
        title: "Get Flight Details",
        description: "Get detailed flight search results by search_id (requires Vercel KV).",
        inputSchema: {
          search_id: z.string().describe("Search ID from search_flights"),
        },
      },
      async ({ search_id }) => {
        const result = await flight.getFlightDetails(search_id);
        return { content: [textContent(result)] };
      }
    );
    server.registerTool(
      "filter_flights_by_price",
      {
        title: "Filter Flights by Price",
        description: "Filter a flight search by price range (requires Vercel KV).",
        inputSchema: {
          search_id: z.string(),
          max_price: z.number().optional(),
          min_price: z.number().optional(),
        },
      },
      async (args) => {
        const result = await flight.filterFlightsByPrice(
          args.search_id,
          args.max_price,
          args.min_price
        );
        return { content: [textContent(result)] };
      }
    );
    server.registerTool(
      "filter_flights_by_airline",
      {
        title: "Filter Flights by Airline",
        description: "Filter a flight search by airline names or codes (requires Vercel KV).",
        inputSchema: {
          search_id: z.string(),
          airlines: z.array(z.string()).describe("e.g. ['United', 'Delta']"),
        },
      },
      async (args) => {
        const result = await flight.filterFlightsByAirline(args.search_id, args.airlines);
        return { content: [textContent(result)] };
      }
    );

    // --- Hotel ---
    server.registerTool(
      "search_hotels",
      {
        title: "Search Hotels",
        description: "Search for hotels using SerpAPI Google Hotels.",
        inputSchema: {
          location: z.string().describe("Location e.g. New York, Banff"),
          check_in_date: z.string().describe("Check-in YYYY-MM-DD"),
          check_out_date: z.string().describe("Check-out YYYY-MM-DD"),
          adults: z.number().int().min(1).optional().default(2),
          currency: z.string().optional().default("USD"),
          max_results: z.number().int().min(1).optional().default(20),
        },
      },
      async (args) => {
        const result = await hotel.searchHotels(args);
        return { content: [textContent(result)] };
      }
    );
    server.registerTool(
      "get_hotel_details",
      {
        title: "Get Hotel Details",
        description: "Get detailed hotel search results by search_id (requires Vercel KV).",
        inputSchema: { search_id: z.string() },
      },
      async ({ search_id }) => {
        const result = await hotel.getHotelDetails(search_id);
        return { content: [textContent(result)] };
      }
    );
    server.registerTool(
      "filter_hotels_by_price",
      {
        title: "Filter Hotels by Price",
        description: "Filter hotel search by price range (requires Vercel KV).",
        inputSchema: {
          search_id: z.string(),
          max_price: z.number().optional(),
          min_price: z.number().optional(),
        },
      },
      async (args) => {
        const result = await hotel.filterHotelsByPrice(
          args.search_id,
          args.max_price,
          args.min_price
        );
        return { content: [textContent(result)] };
      }
    );
    server.registerTool(
      "get_property_details",
      {
        title: "Get Property Details",
        description: "Get detailed information for a specific property by token from hotel search.",
        inputSchema: {
          property_token: z.string(),
          currency: z.string().optional().default("USD"),
          country: z.string().optional().default("us"),
          language: z.string().optional().default("en"),
        },
      },
      async (args) => {
        const result = await hotel.getPropertyDetails(args);
        return { content: [textContent(result)] };
      }
    );
    server.registerTool(
      "filter_hotels_by_rating",
      {
        title: "Filter Hotels by Rating",
        description: "Filter hotel search by minimum rating (requires Vercel KV).",
        inputSchema: {
          search_id: z.string(),
          min_rating: z.number().min(0).max(5).optional().default(4),
        },
      },
      async (args) => {
        const result = await hotel.filterHotelsByRating(args.search_id, args.min_rating);
        return { content: [textContent(result)] };
      }
    );
    server.registerTool(
      "filter_hotels_by_amenities",
      {
        title: "Filter Hotels by Amenities",
        description: "Filter hotel search by required amenities (requires Vercel KV).",
        inputSchema: {
          search_id: z.string(),
          required_amenities: z.array(z.string()).describe("e.g. ['Free Wi-Fi', 'Pool', 'Spa']"),
        },
      },
      async (args) => {
        const result = await hotel.filterHotelsByAmenities(
          args.search_id,
          args.required_amenities
        );
        return { content: [textContent(result)] };
      }
    );
    server.registerTool(
      "filter_hotels_by_class",
      {
        title: "Filter Hotels by Class",
        description: "Filter hotel search by star rating/class (requires Vercel KV).",
        inputSchema: {
          search_id: z.string(),
          hotel_classes: z.array(z.number().int().min(2).max(5)).describe("e.g. [4, 5] for 4-5 star"),
        },
      },
      async (args) => {
        const result = await hotel.filterHotelsByClass(args.search_id, args.hotel_classes);
        return { content: [textContent(result)] };
      }
    );

    // --- Event ---
    server.registerTool(
      "search_events",
      {
        title: "Search Events",
        description: "Search for local events using SerpAPI Google Events.",
        inputSchema: {
          query: z.string().describe("Event query e.g. concerts, festivals"),
          location: z.string().optional(),
          date_filter: z.string().optional().describe("today, week, month, etc."),
          event_type: z.string().optional().describe("e.g. Virtual-Event for online events"),
          max_results: z.number().int().min(1).optional().default(20),
        },
      },
      async (args) => {
        const result = await event.searchEvents(args);
        return { content: [textContent(result)] };
      }
    );
    server.registerTool(
      "get_event_details",
      {
        title: "Get Event Details",
        description: "Get detailed event search results by search_id (requires Vercel KV).",
        inputSchema: { search_id: z.string() },
      },
      async ({ search_id }) => {
        const result = await event.getEventDetails(search_id);
        return { content: [textContent(result)] };
      }
    );
    server.registerTool(
      "filter_events_by_date",
      {
        title: "Filter Events by Date",
        description: "Filter event search results by date range or specific date (requires Vercel KV).",
        inputSchema: {
          search_id: z.string(),
          date_range: z.string().optional().describe("today, tomorrow, week, weekend, next_week, month"),
          specific_date: z.string().optional().describe("YYYY-MM-DD"),
        },
      },
      async (args) => {
        const result = await event.filterEventsByDate(
          args.search_id,
          args.date_range,
          args.specific_date
        );
        return { content: [textContent(result)] };
      }
    );
    server.registerTool(
      "filter_events_by_type",
      {
        title: "Filter Events by Type",
        description: "Filter event search results by event type/category (requires Vercel KV).",
        inputSchema: {
          search_id: z.string(),
          event_types: z.array(z.string()).describe("e.g. ['concert', 'festival', 'art']"),
        },
      },
      async (args) => {
        const result = await event.filterEventsByType(args.search_id, args.event_types);
        return { content: [textContent(result)] };
      }
    );
    server.registerTool(
      "filter_events_by_venue",
      {
        title: "Filter Events by Venue",
        description: "Filter event search results by venue names (requires Vercel KV).",
        inputSchema: {
          search_id: z.string(),
          venue_names: z.array(z.string()),
        },
      },
      async (args) => {
        const result = await event.filterEventsByVenue(args.search_id, args.venue_names);
        return { content: [textContent(result)] };
      }
    );

    // --- Geocoder ---
    server.registerTool(
      "geocode_location",
      {
        title: "Geocode Location",
        description: "Convert a location name or address to latitude/longitude (OpenStreetMap Nominatim).",
        inputSchema: {
          location: z.string().describe("e.g. Ashburn Virginia, Paris France"),
          exactly_one: z.boolean().optional().default(true),
          country_codes: z.string().optional().describe("Limit to countries e.g. us,ca"),
        },
      },
      async (args) => {
        const result = await geocoder.geocodeLocation(args);
        return { content: [textContent(result)] };
      }
    );
    server.registerTool(
      "reverse_geocode",
      {
        title: "Reverse Geocode",
        description: "Convert latitude/longitude to an address.",
        inputSchema: {
          latitude: z.number(),
          longitude: z.number(),
        },
      },
      async (args) => {
        const result = await geocoder.reverseGeocode(args);
        return { content: [textContent(result)] };
      }
    );
    server.registerTool(
      "calculate_distance",
      {
        title: "Calculate Distance",
        description: "Calculate distance between two coordinates (km, miles, or nm).",
        inputSchema: {
          lat1: z.number(),
          lon1: z.number(),
          lat2: z.number(),
          lon2: z.number(),
          unit: z.enum(["km", "miles", "nm"]).optional().default("km"),
        },
      },
      async (args) => {
        const result = geocoder.calculateDistance(args);
        return { content: [textContent(result)] };
      }
    );
    server.registerTool(
      "batch_geocode",
      {
        title: "Batch Geocode",
        description: "Geocode multiple locations in one request.",
        inputSchema: {
          locations: z.array(z.string()).describe("List of location names to geocode"),
        },
      },
      async (args) => {
        const result = await geocoder.batchGeocode(args.locations);
        return { content: [textContent(result)] };
      }
    );

    // --- Weather (NWS - US only) ---
    server.registerTool(
      "get_weather_forecast",
      {
        title: "Get Weather Forecast",
        description: "Get NWS weather forecast for a location (US only). Use geocode_location first for coordinates.",
        inputSchema: {
          latitude: z.number(),
          longitude: z.number(),
          hourly: z.boolean().optional().default(false).describe("If true, return hourly forecast"),
        },
      },
      async (args) => {
        const result = await weather.getWeatherForecast(
          args.latitude,
          args.longitude,
          args.hourly
        );
        return { content: [textContent(result)] };
      }
    );
    server.registerTool(
      "get_weather_alerts",
      {
        title: "Get Weather Alerts",
        description: "Get NWS weather alerts for an area or point (US only).",
        inputSchema: {
          area: z.string().optional().describe("Two-letter state code e.g. KS, TX"),
          region: z.string().optional(),
          zone: z.string().optional(),
          point: z.tuple([z.number(), z.number()]).optional().describe("[lat, lon]"),
          active_only: z.boolean().optional().default(true),
          urgency: z.string().optional(),
          severity: z.string().optional(),
          certainty: z.string().optional(),
        },
      },
      async (args) => {
        const result = await weather.getWeatherAlerts(args);
        return { content: [textContent(result)] };
      }
    );
    server.registerTool(
      "get_current_conditions",
      {
        title: "Get Current Weather Conditions",
        description: "Get current weather conditions from NWS (US only).",
        inputSchema: {
          latitude: z.number(),
          longitude: z.number(),
        },
      },
      async (args) => {
        const result = await weather.getCurrentConditions(args.latitude, args.longitude);
        return { content: [textContent(result)] };
      }
    );
    server.registerTool(
      "get_location_info",
      {
        title: "Get Location Weather Info",
        description: "Get NWS grid and forecast endpoints for coordinates (US only).",
        inputSchema: {
          latitude: z.number(),
          longitude: z.number(),
        },
      },
      async (args) => {
        const result = await weather.getLocationInfo(args.latitude, args.longitude);
        return { content: [textContent(result)] };
      }
    );

    // --- Finance ---
    server.registerTool(
      "convert_currency",
      {
        title: "Convert Currency",
        description: "Convert amount between currencies using Google Finance rates.",
        inputSchema: {
          from_currency: z.string().describe("e.g. USD, EUR, CAD"),
          to_currency: z.string(),
          amount: z.number().optional().default(1),
        },
      },
      async (args) => {
        const result = await finance.convertCurrency(args);
        return { content: [textContent(result)] };
      }
    );
    server.registerTool(
      "lookup_stock",
      {
        title: "Lookup Stock",
        description: "Look up stock information and price via Google Finance.",
        inputSchema: {
          symbol: z.string().describe("e.g. GOOGL, AAPL"),
          exchange: z.string().optional(),
          window: z.string().optional().describe("1D, 5D, 1M, 6M, 1Y, 5Y, MAX"),
        },
      },
      async (args) => {
        const result = await finance.lookupStock(args);
        return { content: [textContent(result)] };
      }
    );
    server.registerTool(
      "get_market_overview",
      {
        title: "Get Market Overview",
        description: "Get overview of major markets (stocks, currencies, crypto) via Google Finance.",
        inputSchema: {},
      },
      async () => {
        const result = await finance.getMarketOverview();
        return { content: [textContent(result)] };
      }
    );
    server.registerTool(
      "get_historical_data",
      {
        title: "Get Historical Stock Data",
        description: "Get historical price data for a stock over a time window.",
        inputSchema: {
          symbol: z.string(),
          exchange: z.string().optional(),
          window: z.string().optional().default("1Y").describe("1D, 5D, 1M, 6M, 1Y, 5Y, MAX"),
        },
      },
      async (args) => {
        const result = await finance.getHistoricalData(args);
        return { content: [textContent(result)] };
      }
    );
    server.registerTool(
      "get_finance_details",
      {
        title: "Get Finance Details",
        description: "Get detailed finance search results by search_id (requires Vercel KV).",
        inputSchema: { search_id: z.string() },
      },
      async ({ search_id }) => {
        const result = await finance.getFinanceDetails(search_id);
        return { content: [textContent(result)] };
      }
    );
    server.registerTool(
      "filter_stocks_by_price_movement",
      {
        title: "Filter Stocks by Price Movement",
        description: "Filter market overview by price movement (requires Vercel KV).",
        inputSchema: {
          search_id: z.string().describe("From get_market_overview"),
          min_percentage: z.number().optional(),
          max_percentage: z.number().optional(),
          movement_type: z.string().optional().describe("Up, Down, or omit for both"),
        },
      },
      async (args) => {
        const result = await finance.filterStocksByPriceMovement(
          args.search_id,
          args.min_percentage,
          args.max_percentage,
          args.movement_type
        );
        return { content: [textContent(result)] };
      }
    );

    // --- 差异化引擎：价格归一化 ---
    server.registerTool(
      "normalize_prices",
      {
        title: "Normalize Prices",
        description:
          "归一化一组价格成分，算出真实到手价(total_all_in)与隐性差价(hidden_gap)。用于识别税/服务费/捆�绑。",
        inputSchema: {
          prices: z.array(PriceInputSchema).describe("价格对象数组（可含 base/before_taxes_fees/lowest/total_rate/taxes_fees/baggage/booking_extra/bundle）"),
        },
      },
      async (args) => {
        const result = normalizeMany(args.prices);
        return { content: [textContent(result)] };
      }
    );

    // --- 差异化引擎：异常检测 ---
    server.registerTool(
      "detect_anomalies",
      {
        title: "Detect Price Anomalies",
        description:
          "用真实成分作基准识别注水/捆绑/跳变/偏离锚点，输出每条候选的 clean/caution/danger 等级 + 中文判决（🚨/⚠️/✅）。",
        inputSchema: {
          candidates: z.array(AnomalyCandidateSchema).describe("候选价格列表"),
          anchor_price: z.number().optional().describe("可信锚点价（如 price_insights.lowest_price）；不传则用候选总价中位数"),
        },
      },
      async (args) => {
        const result = detectAnomalies(args.candidates, args.anchor_price);
        return { content: [textContent(result)] };
      }
    );

    // --- 差异化引擎：行程 + 预算生成 ---
    server.registerTool(
      "generate_trip_plan",
      {
        title: "Generate Trip Plan",
        description:
          "根据行程意图 + 已查候选（机票/酒店）生成逐日行程表 + 预算账本 + 完整避坑报告（渠道分级 + 3 步支付前核对清单）。",
        inputSchema: {
          intent: TripIntentSchema.describe("行程意图（目的地/日期/人数/预算）"),
          flights: z.array(
            z.object({
              channel: z.string(),
              airline: z.string().optional(),
              flight_no: z.string().optional(),
              departure_time: z.string().optional(),
              arrival_time: z.string().optional(),
              duration: z.string().optional(),
              stops: z.number().int().optional(),
              price: z.number().positive(),
              currency: z.string().optional(),
            })
          ).optional(),
          hotels: z.array(
            z.object({
              channel: z.string(),
              name: z.string(),
              nightly_rate: z.number().positive(),
              currency: z.string().optional(),
              rating: z.number().optional(),
            })
          ).optional(),
          conversion: z.object({
            from_currency: z.string(),
            to_currency: z.string(),
            rate: z.number().positive(),
            converted_amount: z.number().optional(),
          }).optional(),
          anomaly_report: z.array(
            z.object({
              channel: z.string(),
              severity: z.enum(["clean", "caution", "danger"]),
              total_all_in: z.number(),
            })
          ).optional(),
          budget_profile: z.object({
            dining_per_day: z.number().optional(),
            transport_per_day: z.number().optional(),
            tickets_per_day: z.number().optional(),
          }).optional(),
          city_cost: z.object({
            currency: z.string().optional().default("CNY"),
            city: z.string().default(""),
            dining_per_day: z.number().positive(),
            transport_per_day: z.number().positive(),
            tickets_per_day: z.number().positive(),
            source: z.string().optional().default("用户提供"),
            updated: z.string().optional().default("--"),
          }).optional().describe("按目的地的城市生活成本档位；不传则按目的地自动查表"),
        },
      },
      async (args) => {
        // 实时汇率（USD→CNY），失败则回退静态。
        let usdCny: number | undefined;
        try {
          const rateRes = (await finance.convertCurrency({ from_currency: "USD", to_currency: "CNY" })) as {
            exchange_rate?: number;
          };
          if (rateRes && rateRes.exchange_rate && rateRes.exchange_rate > 0) usdCny = rateRes.exchange_rate;
        } catch {
          /* 汇率拉取失败 → 用静态备选 */
        }
        const cityCost =
          args.city_cost ?? (await getLivingCost(args.intent.destination, { usd_cny_rate: usdCny }));
        const result = buildTripPlan(args.intent, {
          flights: args.flights,
          hotels: args.hotels,
          conversion: args.conversion,
          anomalyReport: args.anomaly_report
            ? { results: args.anomaly_report }
            : undefined,
          budgetProfile: args.budget_profile
            ? {
                dining_per_day: args.budget_profile.dining_per_day ?? 200,
                transport_per_day: args.budget_profile.transport_per_day ?? 120,
                tickets_per_day: args.budget_profile.tickets_per_day ?? 150,
              }
            : undefined,
          cityCost,
        });
        return { content: [textContent(result)] };
      }
    );

    // --- 聚合分析：一键查价→归一→异常→行程预算（前端最常用入口） ---
    server.registerTool(
      "analyze_travel",
      {
        title: "Analyze Travel (one-shot)",
        description:
          "一站式：摄入一组候选价格 → 归一化真实到手价 → 异常检测(🚨/⚠️/✅) → 生成行程+预算+避坑报告。供前端一键调用。",
        inputSchema: {
          candidates: z.array(
            z.object({
              channel: z.string(),
              currency: z.string().optional(),
              base: z.number().optional(),
              before_taxes_fees: z.number().optional(),
              lowest: z.number().optional(),
              total_rate: z.number().optional(),
              taxes_fees: z.number().optional(),
              baggage: z.number().optional(),
              booking_extra: z.number().optional(),
              bundle: z.number().optional(),
              listed_price: z.number().optional(),
              has_default_addon: z.boolean().optional(),
              addon_items: z.array(z.object({ name: z.string(), price: z.number(), is_default: z.boolean().optional() })).optional(),
            })
          ).describe("候选价格列表"),
          anchor_price: z.number().optional().describe("可信锚点价"),
          intent: TripIntentSchema.optional().describe("行程意图（含目的地/日期/预算）——用于额外生成行程+预算"),
          flights: z.array(z.object({ channel: z.string(), airline: z.string().optional(), flight_no: z.string().optional(), price: z.number().positive(), currency: z.string().optional() })).optional(),
          hotels: z.array(z.object({ channel: z.string(), name: z.string(), nightly_rate: z.number().positive(), currency: z.string().optional(), rating: z.number().optional() })).optional(),
          events: z.array(z.object({ title: z.string(), venue: z.string().optional(), price: z.object({ amount: z.number().optional(), currency: z.string().optional() }).nullable().optional() })).optional().describe("真实活动/门票票价（来自 search_events），覆盖门票分项"),
        },
      },
      async (args) => {
        const result = await runAnalysis(args.candidates, args.anchor_price, args.intent, {
          flights: args.flights,
          hotels: args.hotels,
          events: args.events,
        });
        return { content: [textContent(result)] };
      }
    );

    // --- 真实搜索分析：SerpAPI 搜索 → 候选映射 → 归一化/异常/行程预算（真机搜索入口） ---
    server.registerTool(
      "search_analyze",
      {
        title: "Search & Analyze (real SerpAPI)",
        description:
          "真实搜索(SerpAPI google_flights/google_hotels) → 把结果映射成候选价 → 归一化/异常(🚨/⚠️/✅)/行程预算，一次请求。供前端『真机搜索』一键调用；候选价来自 SerpAPI 而非演示值。",
        inputSchema: {
          intent: TripIntentSchema.describe("行程意图（含目的地/日期/人数/预算）"),
          route: z.object({
            departure_id: z.string().describe("出发机场代码 e.g. PVG"),
            arrival_id: z.string().describe("到达机场代码 e.g. CTU"),
            outbound_date: z.string().describe("出发日期 YYYY-MM-DD"),
            return_date: z.string().optional(),
            adults: z.number().int().optional().default(1),
            currency: z.string().optional().default("CNY"),
          }).optional().describe("机票搜索参数；kind 含 flights 时必传"),
          hotel: z.object({
            location: z.string().describe("目的地 e.g. 成都"),
            check_in_date: z.string(),
            check_out_date: z.string(),
            adults: z.number().int().optional().default(2),
            currency: z.string().optional().default("CNY"),
          }).optional().describe("酒店搜索参数；kind 含 hotels 时必传"),
          kind: z.enum(["flights", "hotels", "both"]).optional().default("flights").describe("搜索类型"),
          anchor_price: z.number().optional().describe("可信锚点价；不传则引擎用候选总价中位数"),
          max_results: z.number().int().min(1).optional().default(6).describe("每类候选数量上限"),
        },
      },
      async (args) => {
        const candidates: AnalysisCandidate[] = [];
        const flights: Array<{ channel: string; airline?: string; price: number; currency?: string }> = [];
        const hotels: Array<{ channel: string; name: string; nightly_rate: number; currency?: string }> = [];

        if (args.kind !== "hotels" && args.route) {
          const fr = (await flight.searchFlightsFull({
            departure_id: args.route.departure_id,
            arrival_id: args.route.arrival_id,
            outbound_date: args.route.outbound_date,
            return_date: args.route.return_date,
            adults: args.route.adults,
            currency: args.route.currency,
            max_results: args.max_results,
          })) as { error?: string; best_flights?: unknown[]; other_flights?: unknown[] };
          if (fr.error) return { content: [textContent({ error: fr.error })] };
          const cn = flightsToCandidates((fr.best_flights ?? []) as never[], (fr.other_flights ?? []) as never[], args.route.currency ?? "CNY");
          candidates.push(...cn);
          cn.forEach((c) => flights.push({ channel: c.channel, airline: c.channel, price: c.base ?? 0, currency: c.currency }));
        }

        if (args.kind !== "flights" && args.hotel) {
          const hr = (await hotel.searchHotelsFull({
            location: args.hotel.location,
            check_in_date: args.hotel.check_in_date,
            check_out_date: args.hotel.check_out_date,
            adults: args.hotel.adults,
            currency: args.hotel.currency,
            max_results: args.max_results,
          })) as { error?: string; properties?: unknown[] };
          if (hr.error) return { content: [textContent({ error: hr.error })] };
          const cn = hotelsToCandidates((hr.properties ?? []) as never[], args.hotel.currency ?? "CNY");
          candidates.push(...cn);
          cn.forEach((c) => hotels.push({ channel: c.channel, name: c.channel, nightly_rate: c.base ?? 0, currency: c.currency }));
        }

        if (candidates.length === 0) {
          return { content: [textContent({ error: "No candidates produced; provide route (flights) and/or hotel (hotels)." })] };
        }
        const result = await runAnalysis(candidates, args.anchor_price, args.intent, { flights, hotels });
        return { content: [textContent(result)] };
      }
    );

    // --- 聊天式入口：一句话 → LLM 解析意图 → 自动搜索/分析（用户发一句即出行程预算） ---
    server.registerTool(
      "plan_from_text",
      {
        title: "Plan trip from a sentence",
        description:
          "用户说一句话（如『9月8-11号从上海去成都，2人，预算4000』）→ LLM 解析成行程意图 → 自动 SerpAPI 搜索(机票/酒店) → 候选映射 → 归一化/异常(🚨/⚠️/✅)/行程预算。聊天式一键入口。",
        inputSchema: {
          text: z.string().describe("用户描述行程的一句话"),
          location: z.object({ latitude: z.number().describe("纬度(定位)"), longitude: z.number().describe("经度(定位)") }).optional().describe("用户定位，用于默认出发地"),
        },
      },
      async (args) => {
        const intent = await parseTripIntent(args.text);
        if (!intent || !intent.destination || !intent.start_date) {
          return { content: [textContent({ ok: false, error: "未能解析，请补充目的地与日期", intent: intent ?? null })] };
        }
        const origin = await resolveOrigin(intent.origin, args.location);
        const ti = {
          destination: intent.destination,
          origin,
          start_date: intent.start_date,
          end_date: intent.end_date ?? intent.start_date,
          travelers: intent.travelers ?? 2,
          budget_total: intent.budget_total,
          budget_currency: intent.budget_currency ?? "CNY",
          preferences: intent.preferences,
        };
        const dfltOrigin = !intent.origin;
        const plan = await searchAndAnalyze(ti as never, "insight");
        if (!plan.ok) return { content: [textContent({ ok: false, intent, error: plan.error })] };
        const ack = (intent.ack ?? `${origin}→${intent.destination} ${intent.start_date}` + (intent.end_date ? `~${intent.end_date}` : "")) + (dfltOrigin ? "（默认出发地，可在对话里改）" : "");
        return { content: [textContent({ ok: true, intent: { ...intent, origin }, ack, search: plan.search, ...(plan.result as object) })] };
      }
    );

    // --- 聊天式多轮追问：改预算/加一天/换人数 → LLM 合并意图 → 自动重搜/重分析 ---
    server.registerTool(
      "plan_followup",
      {
        title: "Trip follow-up (incremental update)",
        description:
          "聊天多轮追问：用户对当前行程做修改（如『改成预算5000』『加一天』），把修改合并进当前意图，再自动搜索/分析，返回更新后的完整结果。",
        inputSchema: {
          text: z.string().describe("用户的修改话语"),
          intent: z.object({
            origin: z.string().optional(),
            destination: z.string().optional(),
            start_date: z.string().optional(),
            end_date: z.string().optional(),
            travelers: z.number().optional(),
            budget_total: z.number().optional(),
            budget_currency: z.string().optional(),
            preferences: z.array(z.string()).optional(),
          }).describe("当前行程意图"),
        },
      },
      async (args) => {
        const updated = await applyTripUpdate(args.text, args.intent as never);
        if (!updated || !updated.destination || !updated.start_date) {
          return { content: [textContent({ ok: false, error: "没理解这次修改，换个说法试试。", intent: args.intent })] };
        }
        const ti = {
          destination: updated.destination,
          origin: updated.origin || "上海",
          start_date: updated.start_date,
          end_date: updated.end_date ?? updated.start_date,
          travelers: updated.travelers ?? 2,
          budget_total: updated.budget_total,
          budget_currency: updated.budget_currency ?? "CNY",
          preferences: updated.preferences,
        };
        const dfltOrigin = !updated.origin;
        const plan = await searchAndAnalyze(ti as never, "insight");
        if (!plan.ok) return { content: [textContent({ ok: false, intent: updated, error: plan.error })] };
        const ack = (updated.ack ?? `${updated.origin ?? "上海"}→${updated.destination} ${updated.start_date}` + (updated.end_date ? `~${updated.end_date}` : "")) + (dfltOrigin ? "（默认从上海出发，可在对话里改）" : "");
        return { content: [textContent({ ok: true, intent: { ...updated, origin: ti.origin }, ack, search: plan.search, ...(plan.result as object) })] };
      }
    );

    // --- 付费成品生成：支付校验通过后调用，实时生成完整行程+预算+避坑+LLM润色 ---
    server.registerTool(
      "generate_plan",
      {
        title: "Generate paid deliverable",
        description:
          "解锁(¥10 支付成功后)调用：给定行程意图 → 自动重搜(缓存) → 生成完整逐日行程 + 预算账本 + 完整避坑报告 + AI 润色。返回 trip_plan（成品）。",
        inputSchema: {
          intent: z.object({
            origin: z.string().optional(),
            destination: z.string().optional(),
            start_date: z.string().optional(),
            end_date: z.string().optional(),
            travelers: z.number().optional(),
            budget_total: z.number().optional(),
            budget_currency: z.string().optional(),
            preferences: z.array(z.string()).optional(),
          }).describe("行程意图（来自 plan_from_text / plan_followup 返回的 intent）"),
        },
      },
      async (args) => {
        const ti = {
          destination: args.intent.destination,
          origin: args.intent.origin || "上海",
          start_date: args.intent.start_date,
          end_date: args.intent.end_date ?? args.intent.start_date,
          travelers: args.intent.travelers ?? 2,
          budget_total: args.intent.budget_total,
          budget_currency: args.intent.budget_currency ?? "CNY",
          preferences: args.intent.preferences,
        };
        if (!ti.destination || !ti.start_date) {
          return { content: [textContent({ ok: false, error: "缺少目的地/日期，无法生成。", intent: args.intent })] };
        }
        const plan = await searchAndAnalyze(ti as never, "full");
        if (!plan.ok) return { content: [textContent({ ok: false, error: plan.error, intent: args.intent })] };
        return { content: [textContent({ ok: true, intent: ti, ...(plan.result as object) })] };
      }
    );

    // --- 智能对话式助手：结合完整对话历史+当前意图，LLM 决定追问/回答/规划；能确定行程时自动查价 ---
    server.registerTool(
      "chat",
      {
        title: "Interactive travel assistant (conversational)",
        description:
          "智能对话式助手：传入「对话历史 + 当前意图」，由 LLM 结合语境决定 追问(ask) / 回答(answer) / 规划(plan)，并增量更新意图；能确定行程时自动查机票/酒店并给出洞察。",
        inputSchema: {
          messages: z.array(z.object({ role: z.enum(["user", "assistant", "system"]), content: z.string() })).describe("完整对话历史（含最新一条用户消息）"),
          intent: z.object({
            origin: z.string().optional(), destination: z.string().optional(),
            start_date: z.string().optional(), end_date: z.string().optional(),
            travelers: z.number().optional(), budget_total: z.number().optional(),
            budget_currency: z.string().optional(), preferences: z.array(z.string()).optional(),
          }).nullish().describe("当前行程意图（可变）"),
          location: z.object({ latitude: z.number(), longitude: z.number() }).optional().describe("用户定位，用于默认出发地"),
        },
      },
      async (args) => {
        const decision = await chatTurn(args.messages, (args.intent as never) ?? null);
        const updated = decision.intent;
        // 程序化判定：只要有目的地+日期就规划（LLM 可能仍会礼貌追问偏好，但结果卡照出）。
        const shouldPlan = !!updated && !!updated.destination && !!updated.start_date;
        if (shouldPlan) {
          const origin = await resolveOrigin(updated.origin, args.location);
          const ti = {
            destination: updated.destination, origin,
            start_date: updated.start_date, end_date: updated.end_date ?? updated.start_date,
            travelers: updated.travelers ?? 2, budget_total: updated.budget_total,
            budget_currency: updated.budget_currency ?? "CNY", preferences: updated.preferences,
          };
          const plan = await searchAndAnalyze(ti as never, "insight");
          const intent = { ...updated, origin };
          if (plan.ok) return { content: [textContent({ action: "plan", reply: decision.reply, intent, search: plan.search, ...(plan.result as object) })] };
          return { content: [textContent({ action: "plan", reply: decision.reply, intent, error: plan.error })] };
        }
        return { content: [textContent({ action: decision.action, reply: decision.reply, intent: updated ?? null })] };
      }
    );

    // --- 实时生活成本：WhereNext（国家指数 → 每日人均预算） ---
    server.registerTool(
      "get_cost_of_living",
      {
        title: "Get Cost of Living",
        description:
          "实时拉取某目的地的生活成本（免费 WhereNext API，CC BY 4.0），换算成每人每天餐饮/市内交通/门票预算。用于预算账本示例与行程规划。",
        inputSchema: {
          destination: z.string().describe("目的地（如 成都 / 东京 / 曼谷）"),
          force: z.boolean().optional().describe("跳过缓存强制拉取"),
        },
      },
      async (args) => {
        // 实时汇率（USD→CNY），失败则回退静态。
        let usdCny: number | undefined;
        try {
          const rateRes = (await finance.convertCurrency({ from_currency: "USD", to_currency: "CNY" })) as {
            exchange_rate?: number;
          };
          if (rateRes && rateRes.exchange_rate && rateRes.exchange_rate > 0) usdCny = rateRes.exchange_rate;
        } catch {
          /* 汇率拉取失败 → 用静态备选 */
        }
        const result = await getLivingCost(args.destination, { force: args.force, usd_cny_rate: usdCny });
        return { content: [textContent(result)] };
      }
    );

    // --- Prompts (if handler supports registerPrompt) ---
    const s = server as {
      registerPrompt?: (
        name: string,
        config: object,
        get: (args: Record<string, unknown>) => { messages: Array<{ role: string; content: { type: "text"; text: string } }> }
      ) => void;
    };
    if (typeof s.registerPrompt === "function") {
      s.registerPrompt(
        "event_discovery",
        {
          title: "Event Discovery",
          description: "Discover events in a location with optional interests, dates, and budget.",
          argsSchema: {
            location: z.string().describe("City or area e.g. New York, San Francisco"),
            interests: z.string().optional(),
            date_preference: z.string().optional(),
            event_type: z.string().optional(),
            budget: z.string().optional(),
          },
        },
        (args) => ({ messages: [promptMessage("user", prompts.eventDiscoveryPrompt(args as Parameters<typeof prompts.eventDiscoveryPrompt>[0]))] })
      );
      s.registerPrompt(
        "event_comparison",
        { title: "Event Comparison", description: "Compare and analyze events from a search result.", argsSchema: { search_id: z.string() } },
        (args) => ({ messages: [promptMessage("user", prompts.eventComparisonPrompt(String((args as { search_id?: string }).search_id ?? "")))] })
      );
      s.registerPrompt(
        "travel_planning",
        {
          title: "Travel Planning",
          description: "Plan a trip with flights from departure to destination.",
          argsSchema: {
            departure: z.string(),
            destination: z.string(),
            departure_date: z.string().describe("YYYY-MM-DD"),
            return_date: z.string().optional(),
            passengers: z.number().optional().default(1),
            budget: z.string().optional(),
            preferences: z.string().optional(),
          },
        },
        (args) => ({ messages: [promptMessage("user", prompts.travelPlanningPrompt(args as Parameters<typeof prompts.travelPlanningPrompt>[0]))] })
      );
      s.registerPrompt(
        "flight_comparison",
        { title: "Flight Comparison", description: "Compare flight options from a search.", argsSchema: { search_id: z.string() } },
        (args) => ({ messages: [promptMessage("user", prompts.flightComparisonPrompt(String((args as { search_id?: string }).search_id ?? "")))] })
      );
      s.registerPrompt(
        "hotel_planning",
        {
          title: "Hotel Planning",
          description: "Plan accommodation for a destination and dates.",
          argsSchema: {
            destination: z.string(),
            check_in_date: z.string(),
            check_out_date: z.string(),
            guests: z.number().optional().default(2),
            budget: z.string().optional(),
            preferences: z.string().optional(),
            hotel_type: z.string().optional().default("hotels"),
          },
        },
        (args) => ({ messages: [promptMessage("user", prompts.hotelPlanningPrompt(args as Parameters<typeof prompts.hotelPlanningPrompt>[0]))] })
      );
      s.registerPrompt(
        "hotel_comparison",
        { title: "Hotel Comparison", description: "Compare hotel options from a search.", argsSchema: { search_id: z.string() } },
        (args) => ({ messages: [promptMessage("user", prompts.hotelComparisonPrompt(String((args as { search_id?: string }).search_id ?? "")))] })
      );
      s.registerPrompt(
        "stock_analysis",
        {
          title: "Stock Analysis",
          description: "Comprehensive stock analysis for a symbol and time period.",
          argsSchema: {
            symbol: z.string(),
            exchange: z.string().optional(),
            time_period: z.string().optional().default("1Y"),
            analysis_type: z.string().optional().default("comprehensive"),
          },
        },
        (args) => ({ messages: [promptMessage("user", prompts.stockAnalysisPrompt(args as Parameters<typeof prompts.stockAnalysisPrompt>[0]))] })
      );
      s.registerPrompt(
        "weather_planning",
        {
          title: "Weather Planning",
          description: "Plan activities based on weather for a location and dates.",
          argsSchema: {
            location: z.string(),
            start_date: z.string(),
            end_date: z.string().optional(),
            activity_type: z.string().optional(),
            preferences: z.string().optional(),
          },
        },
        (args) => ({ messages: [promptMessage("user", prompts.weatherPlanningPrompt(args as Parameters<typeof prompts.weatherPlanningPrompt>[0]))] })
      );
      s.registerPrompt(
        "location_analysis",
        {
          title: "Location Analysis",
          description: "Geographical and contextual analysis of a location.",
          argsSchema: {
            location: z.string(),
            include_nearby: z.boolean().optional().default(true),
            analysis_type: z.enum(["general", "travel", "business"]).optional().default("general"),
          },
        },
        (args) => ({ messages: [promptMessage("user", prompts.locationAnalysisPrompt(args as Parameters<typeof prompts.locationAnalysisPrompt>[0]))] })
      );
    }
  return server;
}

// Stateless Web-standard transport — avoids the mcp-handler streamable-http hang.
// CORS 让浏览器原型（含 file:// 双击）能跨源调用本端点；OPTIONS 处理预检。
const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type, accept, mcp-protocol-version, mcp-session-id",
  "access-control-expose-headers": "mcp-protocol-version, mcp-session-id",
};

function applyCors(res: Response): Response {
  for (const [k, v] of Object.entries(CORS_HEADERS)) res.headers.set(k, v);
  return res;
}

/* ------------------ 免费用户限流（§5）：昂贵工具每日限额 ------------------ */
// 会触发多次 SerpAPI 搜索的「完整交付」类工具，按每日次数硬性限制免费用户。
const QUOTA_GATED = new Set(["analyze_travel", "generate_trip_plan", "search_analyze", "plan_from_text", "plan_followup"]);

function clientId(req: Request, args?: Record<string, unknown>): string {
  const h = req.headers.get("x-client-id") || req.headers.get("x-user-id");
  if (h) return h;
  if (typeof args?.user_id === "string" && args.user_id) return args.user_id;
  return "anon";
}

function quotaExceededResponse(id: unknown, scope: string, limit: number): Response {
  const payload = {
    jsonrpc: "2.0" as const,
    id: id ?? null,
    result: {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            quota_exceeded: true,
            scope,
            limit,
            remaining: 0,
            message: `今日免费分析已用满（上限 ${limit} 次）。查价 / 比价 / 避坑提示仍然免费；完整行程 + 预算 + 避坑报告需解锁 ¥10。`,
          }),
        },
      ],
    },
  };
  return applyCors(new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } }));
}

export async function OPTIONS(): Promise<Response> {
  return applyCors(new Response(null, { status: 204 }));
}

export async function POST(req: Request): Promise<Response> {
  try {
    const server = buildServer();
    const transport = new WebStandardStreamableHTTPServerTransport({
      enableJsonResponse: true,
    });
    await server.connect(transport);
    const parsedBody = await req.json().catch(() => undefined);
    // 昂贵工具：先做免费用户每日限额，超限直接返回 quota_exceeded（前端据此展示付费墙）。
    const name = (parsedBody?.params?.name as string) || "";
    const args = parsedBody?.params?.arguments as Record<string, unknown> | undefined;
    if (parsedBody && parsedBody.method === "tools/call" && QUOTA_GATED.has(name) && !parsedBody.params?.unlimited) {
      const q = await consumeDailyQuota(name, clientId(req, args));
      if (!q.allowed) return quotaExceededResponse(parsedBody.id, name, q.limit);
    }
    return applyCors(await transport.handleRequest(req, { parsedBody }));
  } catch (error) {
    console.error("MCP error:", error);
    return applyCors(
      new Response(
        JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null }),
        { status: 500, headers: { "content-type": "application/json" } }
      )
    );
  }
}

export async function GET(): Promise<Response> {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null }),
    { status: 405, headers: { "content-type": "application/json" } }
  );
}

export async function DELETE(): Promise<Response> {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null }),
    { status: 405, headers: { "content-type": "application/json" } }
  );
}
