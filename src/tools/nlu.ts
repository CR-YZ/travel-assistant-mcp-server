/**
 * nlu.ts —— 把用户一句话解析成结构化行程意图（用 LLM）
 *
 * 聊天式入口：用户发「9月8-11号从上海去成都，2人，预算4000」→ 解析成 intent：
 *   { origin, destination, start_date, end_date, travelers, budget_total, budget_currency, preferences }
 *
 * 说明：相对日期（"9月"、"3天"、"下周三"）由模型对照"今天"解析成具体 YYYY-MM-DD。
 * 失败或未配置 LLM 时返回 null（前端可提示补充，或回落表单演示数据）。
 */
import { chat, llmConfigured } from "./llm";

export interface ParsedIntent {
  origin?: string;
  destination?: string;
  start_date?: string;
  end_date?: string;
  travelers?: number;
  budget_total?: number;
  budget_currency?: string;
  preferences?: string[];
  /** 模型给出的"理解"自然语言一句话（用于聊天气泡确认）。 */
  ack?: string;
}

export function parseConfigured(): boolean {
  return llmConfigured();
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

/** 提取 JSON（容错 ```json 包裹，失败返回 null）。 */
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

const normDate = (v: unknown): string | undefined => {
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  return undefined;
};

export async function parseTripIntent(text: string): Promise<ParsedIntent | null> {
  if (!parseConfigured() || !text || !text.trim()) return null;
  const today = todayStr();
  const user = [
    "你是旅行行程助手。把用户下面的一句话解析成结构化行程意图。",
    `今天是 ${today}。请把相对日期（如"9月""下周三""3天"）解析成具体的 YYYY-MM-DD。`,
    "严格输出 JSON：{\"origin\":\"城\"，\"destination\":\"城\"，\"start_date\":\"YYYY-MM-DD\"，" +
      "\"end_date\":\"YYYY-MM-DD\"，\"travelers\":数字，\"budget_total\":数字(可为null)，" +
      "\"budget_currency\":\"CNY\"，\"preferences\":[\"标签\"...]，\"ack\":\"你用一句话复述理解的行程\"}。" +
      "能推断才填，缺的字段用 null/空。",
    "用户说：" + text,
  ].join("\n");
  const reply = await chat([{ role: "user", content: user }], { json: true, maxTokens: 400, temperature: 0.2 });
  const obj = tryJson(reply);
  if (!obj) return null;
  return {
    origin: typeof obj.origin === "string" ? obj.origin : undefined,
    destination: typeof obj.destination === "string" ? obj.destination : undefined,
    start_date: normDate(obj.start_date),
    end_date: normDate(obj.end_date),
    travelers: typeof obj.travelers === "number" ? obj.travelers : undefined,
    budget_total: typeof obj.budget_total === "number" ? obj.budget_total : undefined,
    budget_currency: typeof obj.budget_currency === "string" ? obj.budget_currency : "CNY",
    preferences: Array.isArray(obj.preferences) ? (obj.preferences as unknown[]).map(String) : undefined,
    ack: typeof obj.ack === "string" ? obj.ack : undefined,
  };
}
