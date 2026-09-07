/**
 * trending.ts —— 聊天快捷「实时热点」建议（按当前季节/临近节假日变化）
 * 前端输入框上方的建议气泡用；返回 [{ label, text }]。
 * text 是可直接发给 plan_from_text / chat 的完整一句。
 */
export interface HotSuggestion { label: string; text: string; }

const SEASON: Record<string, Array<{ city: string; origin: string; days: number; budget: number; tag: string }>> = {
  spring: [
    { city: "杭州", origin: "上海", days: 2, budget: 2500, tag: "江南春" },
    { city: "东京", origin: "上海", days: 5, budget: 10000, tag: "樱花季" },
    { city: "昆明", origin: "上海", days: 3, budget: 4000, tag: "花海" },
  ],
  summer: [
    { city: "三亚", origin: "北京", days: 4, budget: 8000, tag: "海边度假" },
    { city: "青岛", origin: "上海", days: 3, budget: 5000, tag: "避暑" },
    { city: "普吉岛", origin: "上海", days: 5, budget: 9000, tag: "海岛" },
  ],
  autumn: [
    { city: "北京", origin: "上海", days: 3, budget: 4000, tag: "香山红叶" },
    { city: "西安", origin: "上海", days: 3, budget: 3500, tag: "古都" },
    { city: "北海道", origin: "上海", days: 5, budget: 12000, tag: "红叶" },
  ],
  winter: [
    { city: "哈尔滨", origin: "上海", days: 3, budget: 5000, tag: "冰雪" },
    { city: "三亚", origin: "上海", days: 4, budget: 7000, tag: "避寒" },
    { city: "长白山", origin: "上海", days: 3, budget: 6000, tag: "滑雪" },
  ],
};

function seasonOf(month: number): string {
  if (month >= 3 && month <= 5) return "spring";
  if (month >= 6 && month <= 8) return "summer";
  if (month >= 9 && month <= 11) return "autumn";
  return "winter";
}

/** 取未来 N 天（相对今天）的 YYYY-MM-DD。 */
function addDays(days: number): string {
  const d = new Date(Date.now() + days * 86400000);
  return d.toISOString().slice(0, 10);
}

export function hotDestinations(): HotSuggestion[] {
  const now = new Date();
  const season = seasonOf(now.getMonth() + 1);
  const pool = SEASON[season];
  const start = addDays(7);
  const midway = addDays(10);
  const end = addDays(7 + pool[0].days);
  // 按季节取 3 条，label 带季节标签 + 日期，text 完整可发。
  const mk = (i: number): HotSuggestion => {
    const it = pool[i % pool.length];
    const s = addDays(7);
    const e = addDays(7 + it.days);
    return {
      label: `${it.city} · ${it.tag} · ${it.days}天`,
      text: `${s}~${e} 从${it.origin}去${it.city}，${it.days}天，${it.tag}，预算${it.budget}`,
    };
  };
  return [mk(0), mk(1), mk(2)];
}

/* ---------- 真实搜索热度：SerpAPI google_trends（用现有 SERPAPI_KEY） ---------- */
const TREND_POOL: Array<{ city: string; origin: string; days: number; budget: number; tag: string }> = [
  { city: "成都", origin: "上海", days: 3, budget: 4000, tag: "美食" },
  { city: "西安", origin: "上海", days: 3, budget: 3500, tag: "古都" },
  { city: "三亚", origin: "北京", days: 4, budget: 8000, tag: "海边度假" },
  { city: "东京", origin: "上海", days: 5, budget: 10000, tag: "城市/樱花" },
  { city: "大理", origin: "上海", days: 4, budget: 5000, tag: "风花雪月" },
  { city: "重庆", origin: "上海", days: 3, budget: 3500, tag: "山城" },
  { city: "青岛", origin: "上海", days: 3, budget: 5000, tag: "海滨" },
  { city: "北京", origin: "上海", days: 3, budget: 4000, tag: "古都" },
  { city: "杭州", origin: "上海", days: 2, budget: 2500, tag: "江南" },
  { city: "昆明", origin: "上海", days: 3, budget: 4000, tag: "春城" },
  { city: "哈尔滨", origin: "上海", days: 3, budget: 5000, tag: "冰雪" },
  { city: "曼谷", origin: "上海", days: 5, budget: 7000, tag: "热带" },
];

// 短缓存（避免每次加载都查 google_trends，省 SerpAPI 次数）
let _cache: { at: number; items: HotSuggestion[] } | null = null;
const CACHE_MS = 10 * 60 * 1000;

function toSuggestion(it: { city: string; origin: string; days: number; budget: number; tag: string }): HotSuggestion {
  const s = addDays(7);
  const e = addDays(7 + it.days);
  return {
    label: `${it.city} · ${it.tag} · ${it.days}天`,
    text: `${s}~${e} 从${it.origin}去${it.city}，${it.days}天，${it.tag}，预算${it.budget}`,
  };
}

/** 真实搜索热度：google_trends 多词对比，按近 3 月兴趣排序取 Top3。失败/无 key 返回 []。 */
export async function realTrendingDestinations(): Promise<HotSuggestion[]> {
  if (_cache && Date.now() - _cache.at < CACHE_MS) return _cache.items;
  const key = process.env.SERPAPI_KEY;
  if (!key) return [];
  const cities = TREND_POOL.map((p) => p.city);
  const score: Record<string, number> = {};
  try {
    for (let i = 0; i < cities.length; i += 5) {
      const batch = cities.slice(i, i + 5).join(",");
      const url = new URL("https://serpapi.com/search");
      url.searchParams.set("engine", "google_trends");
      url.searchParams.set("q", batch);
      url.searchParams.set("date", "today 3-m");
      url.searchParams.set("geo", "CN");
      url.searchParams.set("api_key", key);
      const res = await fetch(url.toString());
      if (!res.ok) continue;
      const j = (await res.json()) as { interest_over_time?: { timeline_data?: Array<{ values?: Array<{ query?: string; extracted_value?: string }> }> } };
      for (const d of (j.interest_over_time?.timeline_data ?? [])) {
        for (const v of d.values ?? []) {
          if (v.query != null && v.extracted_value != null) score[v.query] = (score[v.query] || 0) + Number(v.extracted_value);
        }
      }
    }
  } catch {
    return [];
  }
  const top = Object.entries(score).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const items = top
    .map(([city]) => TREND_POOL.find((p) => p.city === city))
    .filter((p): p is (typeof TREND_POOL)[number] => !!p)
    .map(toSuggestion);
  if (items.length) _cache = { at: Date.now(), items };
  return items;
}
