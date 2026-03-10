import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import * as flight from "@/src/tools/flight";
import * as hotel from "@/src/tools/hotel";
import * as event from "@/src/tools/event";
import * as geocoder from "@/src/tools/geocoder";
import * as weather from "@/src/tools/weather";
import * as finance from "@/src/tools/finance";
import * as prompts from "@/src/prompts";

function textContent(value: object | string): { type: "text"; text: string } {
  return {
    type: "text",
    text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
  };
}

function promptMessage(role: "user" | "assistant", text: string) {
  return { role, content: { type: "text" as const, text } };
}

const handler = createMcpHandler(
  (server) => {
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
  },
  {},
  {
    basePath: "/api",
    maxDuration: 60,
  }
);

export { handler as GET, handler as POST, handler as DELETE };
