/**
 * city-cost.ts —— 按目的地的"城市生活成本档位"
 *
 * 背景：机票/酒店是"可实时搜索的活价"（SerpAPI）。但"吃饭/市内交通/门票"
 * 没有单一的可实时查询对象——它们是**城市生活成本统计值**，本质上不随"实时"
 * 有意义地变动。因此这里给每个目的地城市一个合理的成本档位（人均/天），
 * 让预算账本能随"去成都 vs 去东京"显著变化，而不是固定一个 ¥470/人/天。
 *
 * 说明：
 *   - 这些是**基准估算**，标注来源与更新时间，供 AI 精算时参考。
 *   - 若用户提供更精确值（如真实活动票价、用户自填），优先级更高。
 */

import { z } from "zod";

/** 单城市成本档位（人均/天，CNY）。 */
export const CityCostProfileSchema = z.object({
  currency: z.string(),
  city: z.string(),
  country: z.string().optional(),
  dining_per_day: z.number().positive(),
  transport_per_day: z.number().positive(),
  tickets_per_day: z.number().positive(),
  source: z.string(),
  updated: z.string(),
});
export type CityCostProfile = z.infer<typeof CityCostProfileSchema>;

/** 常用目的地成本档位（CNY/人/天；数值为基准估算，非实时，仅供参考）。 */
export const CITY_COST_TABLE: Record<string, CityCostProfile> = {
  // 中国内地（性价比）
  "成都": { currency: "CNY", city: "成都", country: "中国", dining_per_day: 120, transport_per_day: 60, tickets_per_day: 100, source: "城市生活成本基准估算", updated: "2026-01" },
  "北京": { currency: "CNY", city: "北京", country: "中国", dining_per_day: 180, transport_per_day: 80, tickets_per_day: 140, source: "城市生活成本基准估算", updated: "2026-01" },
  "上海": { currency: "CNY", city: "上海", country: "中国", dining_per_day: 200, transport_per_day: 90, tickets_per_day: 160, source: "城市生活成本基准估算", updated: "2026-01" },
  "广州": { currency: "CNY", city: "广州", country: "中国", dining_per_day: 160, transport_per_day: 70, tickets_per_day: 120, source: "城市生活成本基准估算", updated: "2026-01" },
  "深圳": { currency: "CNY", city: "深圳", country: "中国", dining_per_day: 180, transport_per_day: 80, tickets_per_day: 140, source: "城市生活成本基准估算", updated: "2026-01" },
  "杭州": { currency: "CNY", city: "杭州", country: "中国", dining_per_day: 160, transport_per_day: 70, tickets_per_day: 130, source: "城市生活成本基准估算", updated: "2026-01" },
  "重庆": { currency: "CNY", city: "重庆", country: "中国", dining_per_day: 130, transport_per_day: 60, tickets_per_day: 110, source: "城市生活成本基准估算", updated: "2026-01" },
  "西安": { currency: "CNY", city: "西安", country: "中国", dining_per_day: 120, transport_per_day: 55, tickets_per_day: 110, source: "城市生活成本基准估算", updated: "2026-01" },
  "昆明": { currency: "CNY", city: "昆明", country: "中国", dining_per_day: 110, transport_per_day: 55, tickets_per_day: 100, source: "城市生活成本基准估算", updated: "2026-01" },
  "拉萨": { currency: "CNY", city: "拉萨", country: "中国", dining_per_day: 130, transport_per_day: 80, tickets_per_day: 120, source: "城市生活成本基准估算", updated: "2026-01" },
  // 港澳台
  "香港": { currency: "CNY", city: "香港", country: "中国香港", dining_per_day: 380, transport_per_day: 120, tickets_per_day: 220, source: "城市生活成本基准估算", updated: "2026-01" },
  "台北": { currency: "CNY", city: "台北", country: "中国台湾", dining_per_day: 220, transport_per_day: 90, tickets_per_day: 160, source: "城市生活成本基准估算", updated: "2026-01" },
  "澳门": { currency: "CNY", city: "澳门", country: "中国澳门", dining_per_day: 320, transport_per_day: 110, tickets_per_day: 200, source: "城市生活成本基准估算", updated: "2026-01" },
  // 日韩
  "东京": { currency: "CNY", city: "东京", country: "日本", dining_per_day: 350, transport_per_day: 120, tickets_per_day: 250, source: "城市生活成本基准估算", updated: "2026-01" },
  "大阪": { currency: "CNY", city: "大阪", country: "日本", dining_per_day: 320, transport_per_day: 110, tickets_per_day: 230, source: "城市生活成本基准估算", updated: "2026-01" },
  "京都": { currency: "CNY", city: "京都", country: "日本", dining_per_day: 300, transport_per_day: 100, tickets_per_day: 220, source: "城市生活成本基准估算", updated: "2026-01" },
  "首尔": { currency: "CNY", city: "首尔", country: "韩国", dining_per_day: 330, transport_per_day: 110, tickets_per_day: 230, source: "城市生活成本基准估算", updated: "2026-01" },
  "济州岛": { currency: "CNY", city: "济州岛", country: "韩国", dining_per_day: 290, transport_per_day: 100, tickets_per_day: 220, source: "城市生活成本基准估算", updated: "2026-01" },
  // 东南亚
  "曼谷": { currency: "CNY", city: "曼谷", country: "泰国", dining_per_day: 140, transport_per_day: 70, tickets_per_day: 120, source: "城市生活成本基准估算", updated: "2026-01" },
  "普吉岛": { currency: "CNY", city: "普吉岛", country: "泰国", dining_per_day: 160, transport_per_day: 90, tickets_per_day: 150, source: "城市生活成本基准估算", updated: "2026-01" },
  "新加坡": { currency: "CNY", city: "新加坡", country: "新加坡", dining_per_day: 380, transport_per_day: 100, tickets_per_day: 220, source: "城市生活成本基准估算", updated: "2026-01" },
  "吉隆坡": { currency: "CNY", city: "吉隆坡", country: "马来西亚", dining_per_day: 130, transport_per_day: 60, tickets_per_day: 120, source: "城市生活成本基准估算", updated: "2026-01" },
  "巴厘岛": { currency: "CNY", city: "巴厘岛", country: "印度尼西亚", dining_per_day: 150, transport_per_day: 80, tickets_per_day: 160, source: "城市生活成本基准估算", updated: "2026-01" },
  "河内": { currency: "CNY", city: "河内", country: "越南", dining_per_day: 100, transport_per_day: 50, tickets_per_day: 90, source: "城市生活成本基准估算", updated: "2026-01" },
  "岘港": { currency: "CNY", city: "岘港", country: "越南", dining_per_day: 110, transport_per_day: 55, tickets_per_day: 100, source: "城市生活成本基准估算", updated: "2026-01" },
  // 欧美
  "巴黎": { currency: "CNY", city: "巴黎", country: "法国", dining_per_day: 420, transport_per_day: 140, tickets_per_day: 260, source: "城市生活成本基准估算", updated: "2026-01" },
  "伦敦": { currency: "CNY", city: "伦敦", country: "英国", dining_per_day: 450, transport_per_day: 150, tickets_per_day: 280, source: "城市生活成本基准估算", updated: "2026-01" },
  "纽约": { currency: "CNY", city: "纽约", country: "美国", dining_per_day: 480, transport_per_day: 160, tickets_per_day: 300, source: "城市生活成本基准估算", updated: "2026-01" },
  "洛杉矶": { currency: "CNY", city: "洛杉矶", country: "美国", dining_per_day: 430, transport_per_day: 150, tickets_per_day: 280, source: "城市生活成本基准估算", updated: "2026-01" },
  "米兰": { currency: "CNY", city: "米兰", country: "意大利", dining_per_day: 380, transport_per_day: 130, tickets_per_day: 250, source: "城市生活成本基准估算", updated: "2026-01" },
  "罗马": { currency: "CNY", city: "罗马", country: "意大利", dining_per_day: 360, transport_per_day: 120, tickets_per_day: 240, source: "城市生活成本基准估算", updated: "2026-01" },
  "悉尼": { currency: "CNY", city: "悉尼", country: "澳大利亚", dining_per_day: 400, transport_per_day: 140, tickets_per_day: 260, source: "城市生活成本基准估算", updated: "2026-01" },
};

/** 兜底档位：未收录城市。 */
export const DEFAULT_CITY_COST: CityCostProfile = {
  currency: "CNY",
  city: "默认",
  country: undefined,
  dining_per_day: 250,
  transport_per_day: 100,
  tickets_per_day: 180,
  source: "默认兜底估算",
  updated: "2026-01",
};

/**
 * 按城市名（含别名/英文）查找成本档位，未命中则用兜底值。
 * 支持快速匹配城市名（中/英）。找不到返回 DEFAULT_CITY_COST。
 */
export function cityCostFor(destination: string): CityCostProfile {
  if (!destination) return DEFAULT_CITY_COST;
  const key = destination.trim().toLowerCase();
  // 精确匹配（中文键）
  if (CITY_COST_TABLE[key]) return CITY_COST_TABLE[key];
  // 英文/别名匹配：按 name 判断
  const lower = key;
  const hit = Object.values(CITY_COST_TABLE).find(
    (c) => c.city.toLowerCase() === lower || c.city === destination.trim()
  );
  return hit ?? DEFAULT_CITY_COST;
}
