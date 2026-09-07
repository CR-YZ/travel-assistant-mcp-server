/**
 * geo.ts —— 城市名 → 机场三字码（聊天式「一句话查机票」用）。
 * 覆盖常用城市；查不到返回 undefined（前端/后端可回落酒店查询或提示补充机场码）。
 */
const CITY_AIRPORTS: Array<[string, string]> = [
  ["上海", "PVG"], ["上海虹桥", "SHA"], ["北京", "PEK"], ["北京大兴", "PKX"], ["广州", "CAN"],
  ["深圳", "SZX"], ["成都", "CTU"], ["杭州", "HGH"], ["西安", "XIY"], ["昆明", "KMG"],
  ["重庆", "CKG"], ["三亚", "SYX"], ["长沙", "CSX"], ["武汉", "WUH"], ["南京", "NKG"],
  ["青岛", "TAO"], ["厦门", "XMN"], ["郑州", "CGO"], ["济南", "TNA"], ["大连", "DLC"],
  ["天津", "TSN"], ["贵阳", "KWE"], ["兰州", "LHW"], ["乌鲁木齐", "URC"], ["拉萨", "LXA"],
  ["哈尔滨", "HRB"], ["沈阳", "SHE"], ["长春", "CGQ"], ["海口", "HAK"], ["福州", "FOC"],
  ["南宁", "NNG"], ["石家庄", "SJW"], ["太原", "TYN"], ["合肥", "HFE"], ["南昌", "KHN"],
  ["香港", "HKG"], ["澳门", "MFM"], ["台北", "TPE"], ["东京", "HND"], ["大阪", "KIX"],
  ["首尔", "ICN"], ["曼谷", "BKK"], ["新加坡", "SIN"], ["吉隆坡", "KUL"], ["普吉", "HKT"],
];

export function cityToAirport(city?: string): string | undefined {
  if (!city) return undefined;
  const c = city.trim();
  const hit = CITY_AIRPORTS.find(([name]) => c === name || c.includes(name) || name.includes(c));
  return hit ? hit[1] : undefined;
}
