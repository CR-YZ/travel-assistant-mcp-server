/**
 * llm.ts —— 接入大模型（OpenAI 兼容格式，默认 DeepSeek）做「AI 分析/润色」
 *
 * 用途（《04-tech-data-plan.md》§8 LLM）：
 *   - 把 anomaly（异常检测）判定 → 生成更像「AI 顾问」的自然中文解读；
 *   - 把 trip_plan.days（结构化骨架）→ 润色成自然的中文每日行程 + 一段行程总述。
 *
 * 配置（环境变量）：
 *   LLM_API_KEY    必填才启用；未配置则整个模块不调用（后端走规则文案，零额外延迟）。
 *   LLM_BASE_URL   默认 https://api.deepseek.com/v1（OpenAI 兼容）
 *   LLM_MODEL      默认 deepseek-chat
 *   LLM_TIMEOUT_MS 默认 20000
 *
 * 所有函数在失败时返回 null（不抛出），保证不影响确定性分析链路。
 */

const BASE = process.env.LLM_BASE_URL || "https://api.deepseek.com/v1";
const MODEL = process.env.LLM_MODEL || "deepseek-chat";
const TIMEOUT = Number(process.env.LLM_TIMEOUT_MS) || 20_000;

export function llmConfigured(): boolean {
  return Boolean(process.env.LLM_API_KEY);
}
export function llmModel(): string {
  return MODEL;
}

interface ChatMsg {
  role: "system" | "user" | "assistant";
  content: string;
}

/** 单次 chat/completions 调用，返回助手文本；失败返回 null。 */
export async function chat(
  messages: ChatMsg[],
  opts: { maxTokens?: number; temperature?: number; json?: boolean } = {}
): Promise<string | null> {
  if (!llmConfigured()) return null;
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT);
    const res = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${process.env.LLM_API_KEY}` },
      body: JSON.stringify({
        model: MODEL,
        messages,
        stream: false,
        temperature: opts.temperature ?? 0.6,
        max_tokens: opts.maxTokens ?? 512,
        ...(opts.json ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: ac.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content ?? null;
  } catch {
    return null;
  }
}

/** 解析模型返回的 JSON，失败返回 null。 */
function tryJson(text: string | null | undefined): Record<string, unknown> | null {
  if (!text) return null;
  try {
    const s = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const obj = JSON.parse(s);
    return obj && typeof obj === "object" ? (obj as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** 行程 AI 总述 + 每日自然语言行程。输入 trip_plan 的 { days, budget }。 */
export async function polishTrip(tripPlan: Record<string, any>): Promise<{ summary: string; dayNotes: string[] } | null> {
  const days = (tripPlan?.days || []) as Array<Record<string, any>>;
  if (days.length === 0) return null;
  const compact = days
    .map((d) => `Day${d.day_index}(日期${d.date},主题:${d.theme}): ${d.morning} → ${d.afternoon} → ${d.evening}`)
    .join("\n");
  const budget = tripPlan?.budget?.subtotal ? `，整趟预估约 ¥${tripPlan.budget.subtotal}` : "";
  const user = [
    "你是「AI旅行向导」的行程策划。根据下面逐日安排，生成：",
    "1) summary：一段 2 句以内的整体行程总述（自然、口语、不浮夸）。",
    "2) dayNotes：与天数等长的数组，每项一句话（30~55 字）描述当天亮点，像贴心向导在介绍。",
    "严格输出 JSON：{\"summary\":\"...\",\"dayNotes\":[\"...\",\"...\"]}",
    "逐日安排：",
    compact,
    budget,
  ].join("\n");
  const text = await chat(
    [
      { role: "system", content: "你是资深、诚实的旅行行程策划，输出简洁自然的简体中文，只输出 JSON。" },
      { role: "user", content: user },
    ],
    { json: true, maxTokens: 700 }
  );
  const obj = tryJson(text);
  if (!obj) return null;
  const notes = Array.isArray(obj.dayNotes) ? (obj.dayNotes as unknown[]).map(String) : [];
  return { summary: String(obj.summary || ""), dayNotes: notes };
}

/** 异常检测 → 自然中文「AI 顾问」解读（用于比价/验价屏的一句话）。 */
export async function aiInsight(anomaly: Record<string, any>): Promise<string | null> {
  const results = (anomaly?.results || []) as Array<Record<string, any>>;
  if (results.length === 0) return null;
  const summaryLine = results
    .slice(0, 8)
    .map((r) => `${r.channel}(${r.emoji || r.severity}, ¥${r.total_all_in})${r.judgement ? ":" + r.judgement : ""}`)
    .join("\n");
  const anchor = anomaly?.anchor_price ? ` 市场锚点价 ¥${anomaly.anchor_price}。` : "";
  const user = [
    "你是「AI旅行向导」的诚实顾问。根据下面的候选价格与异常判定，写一段 2~3 句的简体中文解读：",
    "要点：指出最值得优先选择的渠道（价格正常、无捆绑），提醒有坑的渠道（注水/捆绑/跳变），语气诚实、不夸大、不替平台背书。",
    "候选与判定：",
    summaryLine,
    anchor,
  ].join("\n");
  const text = await chat(
    [
      { role: "system", content: "你是诚实、中立的旅行价格顾问，输出自然的简体中文，不做营销吹捧。" },
      { role: "user", content: user },
    ],
    { maxTokens: 300, temperature: 0.5 }
  );
  return text && text.trim() ? text.trim() : null;
}
