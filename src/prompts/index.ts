/**
 * MCP prompt templates aligned with servers (Python event_server, finance_server, etc.).
 * Use these as templates for AI assistants when using the travel tools.
 */

export function eventDiscoveryPrompt(params: {
  location: string;
  interests?: string;
  date_preference?: string;
  event_type?: string;
  budget?: string;
}): string {
  const { location, interests = "", date_preference = "", event_type = "", budget = "" } = params;
  let prompt = `Help me discover interesting events in ${location}`;
  if (interests) prompt += ` related to my interests: ${interests}`;
  if (date_preference) prompt += ` for ${date_preference}`;
  if (event_type) prompt += `, specifically ${event_type} events`;
  prompt += ".";
  if (budget) prompt += ` My budget consideration: ${budget}.`;
  prompt += `

Please help me find and explore events using the following approach:

1. **Event Search**: Use the search_events tool to find events:
   - Location: ${location}
   - Query: ${interests || "events"}${date_preference ? `\n   - Date filter: ${date_preference}` : ""}${event_type ? `\n   - Event type: ${event_type}` : ""}

2. **Event Analysis**: Once events are found, provide:
   - Summary of the most interesting events with highlights
   - Categorization by event type (concerts, festivals, arts, sports, etc.)
   - Date and time analysis for planning
   - Venue information and accessibility
   - Ticket availability and pricing insights

3. **Personalized Recommendations**: Based on my interests and preferences:
   - Top 5 recommended events with detailed reasoning
   - Alternative events that might be of interest
   - Hidden gems or lesser-known events
   - Seasonal or timely events I shouldn't miss

4. **Practical Information**: For recommended events:
   - Venue details and how to get there
   - Parking and transportation options
   - What to expect and how to prepare
   - Ticket purchasing recommendations

5. **Event Planning**: Help me plan around the events:
   - Suggested itineraries if multiple events are selected
   - Nearby restaurants or activities
   - Timing considerations and scheduling tips

Use the event search tools first, then provide comprehensive analysis and personalized recommendations based on the results.`;
  return prompt;
}

export function eventComparisonPrompt(searchId: string): string {
  return `Analyze and compare the events from search ID: ${searchId}

Please provide a comprehensive analysis including:

1. **Event Overview**: Use get_event_details('${searchId}') to retrieve the complete event data

2. **Event Categorization**:
   - Group events by type (concerts, festivals, arts, sports, networking, etc.)
   - Identify recurring events vs one-time events
   - Highlight free vs paid events

3. **Detailed Comparison**:
   - Date and time analysis (weekday vs weekend, time of day)
   - Venue comparison (indoor vs outdoor, capacity, accessibility)
   - Ticket pricing and availability analysis
   - Duration and format of events

4. **Quality Indicators**:
   - Venue ratings and reviews
   - Event popularity and attendance expectations
   - Organizer reputation and event history

5. **Filtering Recommendations**:
   - Use filter_events_by_date for specific time preferences
   - Use filter_events_by_type for category-specific events
   - Use filter_events_by_venue for preferred locations

6. **Top Recommendations**:
   - Best value events (quality vs price)
   - Most unique or special events
   - Most accessible events
   - Events suitable for different group sizes

7. **Planning Considerations**:
   - Events that can be combined in a single day/weekend
   - Advance booking requirements
   - Weather considerations for outdoor events
   - Transportation and parking logistics

Please format the analysis in a clear, organized structure with specific recommendations for different types of event-goers (families, couples, solo attendees, groups).`;
}

export function travelPlanningPrompt(params: {
  departure: string;
  destination: string;
  departure_date: string;
  return_date?: string;
  passengers?: number;
  budget?: string;
  preferences?: string;
}): string {
  const {
    departure,
    destination,
    departure_date,
    return_date = "",
    passengers = 1,
    budget = "",
    preferences = "",
  } = params;
  let prompt = `Plan a comprehensive trip from ${departure} to ${destination} departing on ${departure_date}`;
  if (return_date) prompt += ` and returning on ${return_date}`;
  else prompt += " (one way)";
  prompt += ` for ${passengers} passenger${passengers !== 1 ? "s" : ""}.`;
  if (budget) prompt += ` Budget consideration: ${budget}.`;
  if (preferences) prompt += ` Travel preferences: ${preferences}.`;
  prompt += `

Please help with the following travel planning tasks:

1. **Flight Search**: Use the search_flights tool to find the best flight options:
   - Search for flights from ${departure} to ${destination}
   - Departure date: ${departure_date}${return_date ? `\n   - Return date: ${return_date}\n   - Trip type: Round trip (1)` : "\n   - Trip type: One way (2)"}
   - Number of passengers: ${passengers}
   - Analyze price insights and recommend best options

2. **Flight Analysis**: Once flights are found, provide:
   - Summary of the best flight options with pros and cons
   - Price comparison and value analysis
   - Duration and layover analysis
   - Airline and aircraft information
   - Carbon emissions comparison if available

3. **Travel Recommendations**: Based on the destination and dates:
   - Best times to book and travel tips
   - Airport information and transportation options
   - Weather considerations for travel dates
   - General destination tips and highlights

4. **Budget Planning**: If budget information provided:
   - Flight cost analysis within budget
   - Tips for finding better deals
   - Alternative travel dates if current search is expensive

Present the information in a clear, organized format with actionable recommendations. Use the flight search tools first, then provide comprehensive analysis and recommendations based on the results.`;
  return prompt;
}

export function flightComparisonPrompt(searchId: string): string {
  return `Analyze and compare the flight options from search ID: ${searchId}

Please provide a comprehensive analysis including:

1. **Flight Overview**: Use get_flight_details('${searchId}') to retrieve the complete flight data

2. **Best Options Analysis**:
   - Top 3-5 recommended flights with detailed breakdown
   - Price-to-value ratio analysis
   - Total travel time comparison
   - Layover analysis (duration, airports, overnight stays)

3. **Detailed Comparison Table**:
   - Price comparison across all options
   - Duration comparison (flight time vs total time)
   - Number of stops and layover quality
   - Airlines and aircraft types
   - Departure/arrival times convenience

4. **Filtering Suggestions**:
   - Use filter_flights_by_price to show budget-friendly options
   - Use filter_flights_by_airline for preferred carriers
   - Highlight direct flights vs connections

5. **Decision Recommendations**:
   - Best overall value option
   - Fastest travel option
   - Most convenient schedule option
   - Budget-conscious option

6. **Booking Considerations**:
   - Price trends and booking timing advice
   - Airline policies and baggage considerations
   - Seat selection and upgrade opportunities

Please format the analysis in a clear, easy-to-read structure with specific recommendations for different traveler priorities (speed, cost, convenience, comfort).`;
}

export function hotelPlanningPrompt(params: {
  destination: string;
  check_in_date: string;
  check_out_date: string;
  guests?: number;
  budget?: string;
  preferences?: string;
  hotel_type?: string;
}): string {
  const {
    destination,
    check_in_date,
    check_out_date,
    guests = 2,
    budget = "",
    preferences = "",
    hotel_type = "hotels",
  } = params;
  let prompt = `Plan accommodation for a trip to ${destination} from ${check_in_date} to ${check_out_date} for ${guests} guest${guests !== 1 ? "s" : ""}.`;
  if (budget) prompt += ` Budget consideration: ${budget}.`;
  if (preferences) prompt += ` Accommodation preferences: ${preferences}.`;
  prompt += `

Please help with the following hotel planning tasks:

1. **Hotel Search**: Use the search_hotels tool to find the best accommodation options:
   - Location: ${destination}
   - Check-in: ${check_in_date}
   - Check-out: ${check_out_date}
   - Guests: ${guests}
   - Type: ${hotel_type}
   - Analyze results and recommend best options

2. **Hotel Analysis**: Once hotels are found, provide:
   - Summary of the top 5-10 hotel options with pros and cons
   - Price comparison and value analysis
   - Location analysis and proximity to attractions
   - Amenities comparison
   - Guest rating and review analysis
   - Room type and accommodation details

3. **Filtering and Recommendations**: Apply relevant filters:
   - Use filter_hotels_by_price for budget considerations
   - Use filter_hotels_by_rating for quality assurance
   - Use filter_hotels_by_amenities for specific requirements
   - Use filter_hotels_by_class for luxury or budget preferences

4. **Detailed Property Information**: For top choices:
   - Use get_property_details to get comprehensive information
   - Include photos, detailed amenities, policies, and reviews
   - Nearby attractions and transportation options

5. **Accommodation Recommendations**: Based on the destination and preferences:
   - Best neighborhoods to stay in
   - Transportation considerations
   - Local attractions and accessibility
   - Dining and entertainment options nearby

6. **Budget Planning**: If budget information provided:
   - Accommodation cost analysis within budget
   - Tips for finding better deals
   - Alternative date suggestions if current search is expensive
   - Additional costs to consider (taxes, fees, parking, resort fees)

Present the information in a clear, organized format with actionable recommendations. Use the hotel search tools first, then provide comprehensive analysis and recommendations based on the results.`;
  return prompt;
}

export function hotelComparisonPrompt(searchId: string): string {
  return `Analyze and compare the hotel options from search ID: ${searchId}

Please provide a comprehensive analysis including:

1. **Hotel Overview**: Use get_hotel_details('${searchId}') to retrieve the complete hotel data

2. **Top Recommendations Analysis**:
   - Top 5-8 recommended hotels with detailed breakdown
   - Price-to-value ratio analysis
   - Location convenience comparison
   - Amenity and service analysis

3. **Detailed Comparison Table**:
   - Price comparison (per night and total cost)
   - Star rating and guest review scores
   - Key amenities and facilities
   - Location ratings and nearby attractions
   - Room types and sizes available

4. **Filtering Suggestions**:
   - Use filter_hotels_by_price to show budget-friendly options
   - Use filter_hotels_by_rating for highly-rated accommodations
   - Use filter_hotels_by_amenities for specific requirements (pool, spa, gym, etc.)
   - Use filter_hotels_by_class for different luxury levels

5. **Decision Recommendations**:
   - Best overall value option
   - Luxury/premium option
   - Budget-conscious option
   - Best location option
   - Best amenities option

6. **Booking Considerations**:
   - Cancellation policies and flexibility
   - Additional fees and taxes
   - Check-in/check-out times
   - Special offers or packages available
   - Seasonal pricing considerations

7. **Neighborhood Analysis**:
   - Safety and walkability
   - Proximity to attractions, restaurants, and transportation
   - Local character and atmosphere
   - Shopping and entertainment options

Please format the analysis in a clear, easy-to-read structure with specific recommendations for different traveler priorities (budget, luxury, location, amenities, business travel, family travel).`;
}

export function stockAnalysisPrompt(params: {
  symbol: string;
  exchange?: string;
  time_period?: string;
  analysis_type?: string;
}): string {
  const { symbol, exchange = "", time_period = "1Y", analysis_type = "comprehensive" } = params;
  let prompt = `Analyze the stock ${symbol.toUpperCase()}`;
  if (exchange) prompt += ` listed on ${exchange.toUpperCase()}`;
  prompt += ` with a focus on the ${time_period} time period.`;
  prompt += `

Please provide a ${analysis_type} analysis including the following:

1. **Current Stock Information**: Use the lookup_stock tool to get current price and basic information:
   - Current stock price and market status
   - Recent price movements and trends
   - Key company information and statistics

2. **Historical Analysis**: Use the get_historical_data tool with window="${time_period}" to analyze:
   - Price performance over the specified period
   - Significant price movements and volatility
   - Key events that impacted the stock price
   - Support and resistance levels

3. **Fundamental Analysis** (if available in the data):
   - Revenue and earnings trends
   - Financial ratios and key metrics
   - Balance sheet health
   - Cash flow analysis

4. **Market Context**:
   - Compare performance to major market indices
   - Sector and industry comparison
   - Market sentiment and news analysis

5. **Technical Analysis**:
   - Price trends and patterns
   - Volume analysis
   - Moving averages and technical indicators

6. **Risk Assessment**:
   - Volatility analysis
   - Key risk factors
   - External factors affecting the stock

7. **Investment Recommendation**:
   - Summary of strengths and weaknesses
   - Potential catalysts and risks
   - Suggested investment approach based on the analysis

Please use the stock analysis tools first to gather comprehensive data, then provide detailed insights and actionable recommendations. Format the analysis in a clear, professional structure suitable for investment decision-making.`;
  return prompt;
}

export function weatherPlanningPrompt(params: {
  location: string;
  start_date: string;
  end_date?: string;
  activity_type?: string;
  preferences?: string;
}): string {
  const {
    location,
    start_date,
    end_date = "",
    activity_type = "",
    preferences = "",
  } = params;
  let prompt = `Plan weather-related activities for ${location} starting on ${start_date}`;
  if (end_date) prompt += ` through ${end_date}`;
  if (activity_type) prompt += ` for ${activity_type} activities`;
  prompt += ".";
  if (preferences) prompt += ` Weather preferences: ${preferences}.`;
  prompt += `

Please help with the following weather planning tasks:

1. **Location Analysis**: First, determine the coordinates for ${location} and use get_location_info() to get grid information and nearby weather stations.

2. **Current Conditions**: Use get_current_conditions() to get the current weather situation for ${location}.

3. **Weather Forecast**: Get both daily and hourly forecasts using get_weather_forecast():
   - Daily forecast for overall planning
   - Hourly forecast for detailed timing${activity_type ? `\n   - Focus on weather conditions relevant to ${activity_type}` : ""}

4. **Weather Alerts**: Check for any active weather alerts using get_weather_alerts() that might affect plans.

5. **Analysis and Recommendations**: Provide:
   - Best times/dates for outdoor activities based on forecast
   - Weather-related precautions or preparations needed
   - Alternative indoor activity suggestions if weather is unfavorable
   - Clothing and equipment recommendations based on conditions${activity_type ? `\n   - Specific considerations for ${activity_type} activities` : ""}

6. **Detailed Day-by-Day Breakdown**: For each day in the planning period:
   - Morning, afternoon, and evening weather conditions
   - Temperature ranges and feels-like temperatures
   - Precipitation chances and types
   - Wind conditions and visibility
   - UV index and sun/cloud coverage
   - Recommended activity windows

Present the information in a clear, organized format with specific actionable recommendations for weather-dependent planning.`;
  return prompt;
}

export function locationAnalysisPrompt(params: {
  location: string;
  include_nearby?: boolean;
  analysis_type?: "general" | "travel" | "business";
}): string {
  const { location, include_nearby = true, analysis_type = "general" } = params;
  let prompt = `Analyze the location "${location}" and provide comprehensive geographical and contextual information.

Please perform the following analysis:

1. **Geocoding**: Use the geocode_location tool to get precise coordinates for "${location}"

2. **Location Details**: Based on the geocoding results, provide:
   - Exact coordinates (latitude, longitude)
   - Full formatted address
   - Administrative divisions (country, state/region, city)
   - Postal/zip code if available

3. **Geographical Context**:`;
  if (analysis_type === "travel") {
    prompt += `
   - Climate and weather patterns
   - Time zone information
   - Elevation and terrain characteristics
   - Transportation accessibility (airports, railways, highways)
   - Tourist attractions and points of interest`;
  } else if (analysis_type === "business") {
    prompt += `
   - Economic indicators and business environment
   - Demographics and population data
   - Infrastructure and connectivity
   - Regulatory environment
   - Market opportunities and challenges`;
  } else {
    prompt += `
   - Physical geography and topography
   - Climate characteristics
   - Population and demographics
   - Historical significance
   - Cultural and economic importance`;
  }
  if (include_nearby) {
    prompt += `

4. **Nearby Locations**: 
   - Major cities within 100km
   - Notable landmarks or features
   - Regional context and connections`;
  }
  prompt += `

5. **Practical Information**:
   - Best times to visit (if applicable)
   - Transportation options
   - Language(s) spoken
   - Currency (if different from common currencies)

Please start by geocoding the location to get accurate coordinates, then provide the comprehensive analysis based on the geocoding results.`;
  return prompt;
}
