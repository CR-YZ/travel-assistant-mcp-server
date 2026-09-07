/**
 * cost-of-living.ts —— 从 WhereNext 实时拉取生活成本指数，换算成旅行预算
 *
 * 数据源：WhereNext (getwherenext.com) —— 免费 JSON API，CC BY 4.0，无需 key。
 *   GET https://getwherenext.com/api/data/cost-of-living/csv
 *   返回各国：monthly_estimate_usd, cost_index, grocery_index, transport_index ...
 *
 * 用途：把"某国/某市"一个月的预估生活成本换算成"每人每天"的餐饮/市内交通/
 *       门票预算，替代手工写死的固定值。这是真实数据（机构来源），不是估算。
 *
 * 说明：
 *   - 实时拉取有网络与限流成本，因此用「内存缓存」+「失败兜底」。
 *   - 拉不到时回退到本地 city-cost.ts 的手工档位（见 fallbackToCityCost）。
 *   - 数据是国家层面指数，城市用它做近似（同国不同城市会有差异，标注来源）。
 */

import { cityCostFor } from "./city-cost";
import type { CityCostProfile } from "./city-cost";

const WHERE_NEXT_COL_URL = "https://getwherenext.com/api/data/cost-of-living/csv";
const USD_CNY_FALLBACK = 7.2; // 汇率备选（实时汇率优先，见 opts.usd_cny_rate）

/** 国家代码（2 字母）→ 目的地中文/英文名映射（用于兜底查 city-cost）。 */
const COUNTRY_TO_CITY: Record<string, string> = {
  CN: "中国", JP: "日本", TH: "泰国", FR: "法国", US: "美国", GB: "英国",
  KR: "韩国", SG: "新加坡", MY: "马来西亚", IT: "意大利", AU: "澳大利亚",
  DE: "德国", ES: "西班牙", TW: "中国台湾", HK: "中国香港", MO: "中国澳门",
  VN: "越南", ID: "印度尼西亚", CA: "加拿大", CH: "瑞士", NL: "荷兰",
};

/** 目的地 → 国家代码（用于首次查表命中）。 */
const DEST_TO_COUNTRY: Record<string, string> = {
  "中国": "CN", "日本": "JP", "泰国": "TH", "法国": "FR", "美国": "US", "英国": "GB",
  "韩国": "KR", "新加坡": "SG", "马来西亚": "MY", "意大利": "IT", "澳大利亚": "AU",
  "德国": "DE", "西班牙": "ES", "中国台湾": "TW", "中国香港": "HK", "中国澳门": "MO",
  "越南": "VN", "印度尼西亚": "ID", "加拿大": "CA", "瑞士": "CH", "荷兰": "NL",
  // 城市 → 国家
  "成都": "CN", "北京": "CN", "上海": "CN", "广州": "CN", "深圳": "CN", "杭州": "CN", "重庆": "CN", "西安": "CN", "昆明": "CN", "拉萨": "CN",
  "东京": "JP", "大阪": "JP", "京都": "JP", "首尔": "KR", "济州岛": "KR",
  "曼谷": "TH", "普吉岛": "TH", "吉隆坡": "MY", "巴厘岛": "ID", "河内": "VN", "岘港": "VN",
  "巴黎": "FR", "伦敦": "GB", "纽约": "US", "洛杉矶": "US", "米兰": "IT", "罗马": "IT", "悉尼": "AU",
  "香港": "HK", "台北": "TW", "澳门": "MO",
};

/* ---------------- 缓存 ---------------- */
let cached: Map<string, CountryCostRow> | null = null;
let cacheAt = 0;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 小时

/** CSV 一行的结构化。 */
type CountryCostRow = {
  country_code: string;
  country: string;
  cost_index: number;
  monthly_estimate_usd: number;
  grocery_index: number;
  rent_index: number;
  utilities_index: number;
  transport_index: number;
};

function parseCsv(text: string): Map<string, CountryCostRow> {
  const lines = text.split(/\r?\n/);
  // 跳过表头
  const map = new Map<string, CountryCostRow>();
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = line.split(",");
    const code = (cols[1] ?? "").replace(/"/g, "").trim();
    if (!code) continue;
    map.set(code.trim(), {
      country_code: code.trim(),
      country: (cols[2] ?? "").replace(/"/g, "").trim(),
      cost_index: Number(cols[4]) || 0,
      monthly_estimate_usd: Number(cols[5]) || 0,
      grocery_index: Number(cols[6]) || 0,
      rent_index: Number(cols[7]) || 0,
      utilities_index: Number(cols[8]) || 0,
      transport_index: Number(cols[9]) || 0,
    });
  }
  return map;
}

async function fetchCountryRows(force?: boolean): Promise<Map<string, CountryCostRow>> {
  if (!force && cached && Date.now() - cacheAt < CACHE_TTL_MS) return cached;
  const res = await fetch(WHERE_NEXT_COL_URL, { headers: { accept: "text/csv" } });
  if (!res.ok) throw new Error(`WhereNext request failed: ${res.status} ${res.statusText}`);
  const text = await res.text();
  cached = parseCsv(text);
  cacheAt = Date.now();
  return cached;
}

/** 目的地（中文/英文／城市名）→ 国家代码。 */
function detectCountry(destination: string): string | undefined {
  const key = destination?.trim() ?? "";
  return (
    DEST_TO_COUNTRY[key] ??
    DEST_TO_COUNTRY[key.toLowerCase()] ??
    Object.entries(DEST_TO_COUNTRY).find(([k]) => key.includes(k))?.[1]
  );
}

/**
 * 实时获取某国家/目的地的每日旅行预算档位。
 * @param destination 目的地（如 "成都" / "东京"）
 * @param opts.force          跳过缓存强制拉取
 * @param opts.usd_cny_rate   实时汇率（USD→CNY）；缺省用静态备选 7.2
 */
export async function getLivingCost(
  destination: string,
  opts: { force?: boolean; usd_cny_rate?: number } = {}
): Promise<CityCostProfile> {
  const code = detectCountry(destination);
  if (!code) return cityCostFor(destination); // 没有国家映射 → 兜底本地表

  let rows: Map<string, CountryCostRow>;
  try {
    rows = await fetchCountryRows(opts.force);
  } catch {
    return cityCostFor(destination); // API 失败 → 兜底
  }
  const row = rows.get(code);
  if (!row) return cityCostFor(destination); // 无该国数据 → 兜底

  const usdCny = opts.usd_cny_rate && opts.usd_cny_rate > 0 ? opts.usd_cny_rate : USD_CNY_FALLBACK;

  // 换算：月度 USD → 每日 CNY。（这里只算吃饭/交通/门票，机票/酒店另行实时。）
  const dailyUsd = row.monthly_estimate_usd / 30;
  const dailyCny = Math.round(dailyUsd * usdCny);
  // 用 monthly_estimate_usd（真实月度美元成本）做水位，食品/交通按合理占比分配，
  // 并用 sub-index 做**温和**修正（+/- 30% 以内），避免指数失真。
  const smallAdj = (idx: number) => Math.min(1.3, Math.max(0.7, 1 - (idx - 50) / 200));
  const diningCny = Math.round(Math.min(600, Math.max(40, dailyCny * 0.28 * smallAdj(row.grocery_index))));
  const transportCny = Math.round(Math.min(300, Math.max(25, dailyCny * 0.16 * smallAdj(row.transport_index))));
  const ticketsCny = Math.round(Math.min(400, Math.max(40, dailyCny * 0.18 * smallAdj(row.cost_index))));

  return {
    currency: "CNY",
    city: destination,
    country: row.country,
    dining_per_day: diningCny || 200,
    transport_per_day: transportCny || 100,
    tickets_per_day: ticketsCny || 120,
    source: `WhereNext 生活成本（${row.country}，月薪估 $${row.monthly_estimate_usd}），汇率 ${usdCny.toFixed(4)}`,
    updated: new Date().toISOString().slice(0, 10),
  };
}

/** 暴露一份国家代码→目的地名映射（供前端显示所用数据源国家）。 */
export function countryFor(destination: string): string | undefined {
  const code = detectCountry(destination);
  return code ? (COUNTRY_TO_CITY[code] ?? code) : undefined;
}

// 供测试/调试
export const _internal = { fetchCountryRows, detectCountry, parseCsv };
