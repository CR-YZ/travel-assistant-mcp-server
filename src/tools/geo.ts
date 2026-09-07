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
