/**
 * geo.ts —— 城市/国家名 → 机场三字码 & 英文名（聊天式「一句话查机票/酒店」用）。
 * 说明：SerpAPI 境外酒店/城市常需英文名（如「东京」→0，「Tokyo」→有），
 *       故加 cityToEnglish 供酒店搜索回退；cityToAirport 兼容城市名与国家名（国家取主要机场）。
 * 查不到返回 undefined（前端/后端可回落或提示）。
 */
const CITY_AIRPORTS: Array<[string, string]> = [
  // 国内
  ["上海", "PVG"], ["上海虹桥", "SHA"], ["北京", "PEK"], ["北京大兴", "PKX"], ["广州", "CAN"],
  ["深圳", "SZX"], ["成都", "CTU"], ["杭州", "HGH"], ["西安", "XIY"], ["昆明", "KMG"],
  ["重庆", "CKG"], ["三亚", "SYX"], ["长沙", "CSX"], ["武汉", "WUH"], ["南京", "NKG"],
  ["青岛", "TAO"], ["厦门", "XMN"], ["郑州", "CGO"], ["济南", "TNA"], ["大连", "DLC"],
  ["天津", "TSN"], ["贵阳", "KWE"], ["兰州", "LHW"], ["乌鲁木齐", "URC"], ["拉萨", "LXA"],
  ["哈尔滨", "HRB"], ["沈阳", "SHE"], ["长春", "CGQ"], ["海口", "HAK"], ["福州", "FOC"],
  ["南宁", "NNG"], ["石家庄", "SJW"], ["太原", "TYN"], ["合肥", "HFE"], ["南昌", "KHN"],
  // 境外城市
  ["香港", "HKG"], ["澳门", "MFM"], ["台北", "TPE"], ["东京", "HND"], ["大阪", "KIX"],
  ["京都", "KIX"], ["首尔", "ICN"], ["曼谷", "BKK"], ["新加坡", "SIN"], ["吉隆坡", "KUL"],
  ["普吉", "HKT"], ["巴厘岛", "DPS"], ["马尼拉", "MNL"], ["迪拜", "DXB"], ["伦敦", "LHR"],
  ["巴黎", "CDG"], ["纽约", "JFK"], ["洛杉矶", "LAX"], ["悉尼", "SYD"], ["米兰", "MXP"],
  ["罗马", "FCO"], ["马尔代夫", "MLE"],
  // 国家（取主要机场）
  ["日本", "HND"], ["泰国", "BKK"], ["韩国", "ICN"], ["新加坡国", "SIN"], ["马来西亚", "KUL"],
  ["越南", "SGN"], ["印度尼西亚", "DPS"], ["菲律宾", "MNL"], ["阿联酋", "DXB"], ["英国", "LHR"],
  ["法国", "CDG"], ["美国", "JFK"], ["澳大利亚", "SYD"], ["意大利", "FCO"],
  // 英文名（定位反解析/境外常返回英文）
  ["Shanghai", "PVG"], ["Beijing", "PEK"], ["Guangzhou", "CAN"], ["Shenzhen", "SZX"], ["Chengdu", "CTU"],
  ["Hangzhou", "HGH"], ["Xian", "XIY"], ["Kunming", "KMG"], ["Chongqing", "CKG"], ["Sanya", "SYX"],
  ["Changsha", "CSX"], ["Wuhan", "WUH"], ["Nanjing", "NKG"], ["Qingdao", "TAO"], ["Xiamen", "XMN"],
  ["Tianjin", "TSN"], ["Harbin", "HRB"], ["Dalian", "DLC"], ["Zhengzhou", "CGO"],
  ["Tokyo", "HND"], ["Osaka", "KIX"], ["Seoul", "ICN"], ["Bangkok", "BKK"], ["Singapore", "SIN"],
  ["Hong Kong", "HKG"], ["Macau", "MFM"], ["Taipei", "TPE"], ["London", "LHR"], ["Paris", "CDG"],
  ["New York", "JFK"], ["Los Angeles", "LAX"], ["Sydney", "SYD"], ["Dubai", "DXB"], ["Kuala Lumpur", "KUL"],
];

const CITY_ENGLISH: Array<[string, string]> = [
  ["东京", "Tokyo"], ["大阪", "Osaka"], ["京都", "Kyoto"], ["北海道", "Sapporo"], ["冲绳", "Okinawa"],
  ["首尔", "Seoul"], ["济州", "Jeju"], ["曼谷", "Bangkok"], ["清迈", "Chiang Mai"], ["普吉", "Phuket"],
  ["新加坡", "Singapore"], ["吉隆坡", "Kuala Lumpur"], ["巴厘岛", "Bali"], ["雅加达", "Jakarta"],
  ["香港", "Hong Kong"], ["澳门", "Macau"], ["台北", "Taipei"], ["马尼拉", "Manila"], ["迪拜", "Dubai"],
  ["伦敦", "London"], ["巴黎", "Paris"], ["纽约", "New York"], ["洛杉矶", "Los Angeles"], ["悉尼", "Sydney"],
  ["罗马", "Rome"], ["米兰", "Milan"], ["马尔代夫", "Maldives"],
  // 国家 → 主要城市英文名
  ["日本", "Tokyo"], ["泰国", "Bangkok"], ["韩国", "Seoul"], ["马来西亚", "Kuala Lumpur"],
  ["越南", "Ho Chi Minh City"], ["印度尼西亚", "Bali"], ["菲律宾", "Manila"], ["阿联酋", "Dubai"],
  ["英国", "London"], ["法国", "Paris"], ["美国", "New York"], ["澳大利亚", "Sydney"], ["意大利", "Rome"],
];

function match(list: Array<[string, string]>, city?: string): string | undefined {
  if (!city) return undefined;
  const c = city.trim();
  const hit = list.find(([name]) => c === name || c.includes(name) || name.includes(c));
  return hit ? hit[1] : undefined;
}

/** 城市/国家 → 机场三字码。 */
export function cityToAirport(city?: string): string | undefined {
  return match(CITY_AIRPORTS, city);
}

/** 城市/国家 → 英文名（用于境外酒店/城市搜索回退）。 */
export function cityToEnglish(city?: string): string | undefined {
  return match(CITY_ENGLISH, city);
}

/* ---------- 定位 → 就近城市（无需网络，内置主要城市） ---------- */
const CITY_COORDS: Array<[string, number, number]> = [
  ["上海", 31.23, 121.47], ["北京", 39.90, 116.40], ["广州", 23.13, 113.26], ["深圳", 22.54, 114.06],
  ["成都", 30.57, 104.07], ["杭州", 30.27, 120.16], ["西安", 34.34, 108.94], ["昆明", 24.88, 102.83],
  ["重庆", 29.56, 106.55], ["三亚", 18.25, 109.51], ["长沙", 28.23, 112.94], ["武汉", 30.59, 114.31],
  ["南京", 32.06, 118.80], ["青岛", 36.07, 120.38], ["厦门", 24.48, 118.09], ["天津", 39.34, 117.36],
  ["哈尔滨", 45.75, 126.64], ["大连", 38.91, 121.61], ["郑州", 34.75, 113.63], ["贵阳", 26.65, 106.63],
  ["兰州", 36.06, 103.83], ["乌鲁木齐", 43.83, 87.62], ["拉萨", 29.65, 91.14], ["海口", 20.02, 110.35],
  ["福州", 26.07, 119.30], ["沈阳", 41.80, 123.43], ["长春", 43.82, 125.32], ["太原", 37.87, 112.55],
  ["合肥", 31.82, 117.23], ["石家庄", 38.04, 114.51], ["南昌", 28.68, 115.86], ["济南", 36.65, 117.12],
  ["香港", 22.32, 114.17], ["澳门", 22.20, 113.55], ["台北", 25.03, 121.57], ["台中", 24.15, 120.67],
  ["东京", 35.68, 139.69], ["大阪", 34.69, 135.50], ["首尔", 37.57, 126.98], ["曼谷", 13.76, 100.50],
  ["新加坡", 1.352, 103.82], ["吉隆坡", 3.14, 101.69],
];

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** 定位经纬度 → 就近主要城市名（200km 内；超出返回 null）。 */
export function nearestCityFromLocation(lat: number, lon: number): string | undefined {
  let best: string | undefined;
  let bestKm = Infinity;
  for (const [name, clat, clon] of CITY_COORDS) {
    const d = haversine(lat, lon, clat, clon);
    if (d < bestKm) { bestKm = d; best = name; }
  }
  return bestKm <= 200 ? best : undefined;
}
