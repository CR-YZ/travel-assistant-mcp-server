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
