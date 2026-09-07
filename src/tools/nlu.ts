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

export type ChatDecision = {
  reply: string;
  action: "ask" | "answer" | "plan";
  intent: ParsedIntent | null;
};

/** 对话式智能助手：结合完整对话历史 + 当前意图，决定「追问/回答/规划」并增量更新意图。 */
export async function chatTurn(messages: Array<{ role: string; content: string }>, current: ParsedIntent | null): Promise<ChatDecision> {
  if (!parseConfigured()) {
    return { reply: "你好，我是 AI旅行向导。跟我说说你要去哪玩、几天、预算多少～", action: "ask", intent: current };
  }
  const today = todayStr();
  const convo = (messages || []).slice(-12).map((m) => `${m.role === "user" ? "用户" : "助手"}: ${m.content}`).join("\n");
  const cur = current ? JSON.stringify({ origin: current.origin, destination: current.destination, start_date: current.start_date, end_date: current.end_date, travelers: current.travelers, budget_total: current.budget_total, preferences: current.preferences }) : "{}";
  const user = [
    "你是「AI旅行向导」的智能助手。结合当前行程意图与完整对话，完成下面任务，用自然、友好、简洁的中文。",
    `今天是 ${today}。`,
    "- 若还缺行程关键信息（尤其目的地、出行日期），主动**追问**（一次只问最关键的），action=ask。",
    "- 若用户问的是攻略/价格/航司类问题，直接**解答**，action=answer（不要强行规划）。",
    "- 若能确定行程意图（有目的地 + 日期），更新 intent 并 action=plan（系统会去查价格/行程）。",
    "- 若用户提到**偏好**（如 经济/实惠/舒适/高档/五星、上午/下午航班、某航司、美食/购物/亲子/自然/文化、住市区等），**必须合并进 intent.preferences 数组**（未提及的偏好保留原值）。",
    "- reply 用一句话回复或追问；intent 保留已有字段、只更新变化处（未提及保持原值）。",
    "当前意图（JSON）：" + cur,
    "对话记录：",
    convo,
    "严格输出 JSON：{\"reply\":\"...\",\"action\":\"ask|answer|plan\",\"intent\":{origin?,destination?,start_date?,end_date?,travelers?,budget_total?,budget_currency?,preferences?}}",
  ].join("\n");
  const raw = await chat([{ role: "user", content: user }], { json: true, maxTokens: 500, temperature: 0.5 });
  const obj = tryJson(raw);
  if (!obj) return { reply: "我在呢～再跟我说说你的行程呗", action: "ask", intent: current };
  const action = obj.action === "plan" ? "plan" : obj.action === "answer" ? "answer" : "ask";
  const updated = obj.intent ? parseIntentObj((obj.intent ?? {}) as Record<string, unknown>, current) : current;
  return { reply: String(obj.reply ?? ""), action, intent: updated };
}

function parseIntentObj(obj: Record<string, unknown>, current: ParsedIntent | null): ParsedIntent {
  return {
    origin: typeof obj.origin === "string" ? obj.origin : current?.origin,
    destination: typeof obj.destination === "string" ? obj.destination : current?.destination,
    start_date: normDate(obj.start_date) ?? current?.start_date,
    end_date: normDate(obj.end_date) ?? current?.end_date,
    travelers: typeof obj.travelers === "number" ? obj.travelers : current?.travelers,
    budget_total: typeof obj.budget_total === "number" ? obj.budget_total : current?.budget_total,
    budget_currency: typeof obj.budget_currency === "string" ? obj.budget_currency : (current?.budget_currency ?? "CNY"),
    preferences: Array.isArray(obj.preferences) ? (obj.preferences as unknown[]).map(String) : current?.preferences,
    ack: undefined,
  };
}

/** 多轮追问：把用户对当前行程的修改（改预算/加一天/换人数…）合并成更新后的完整意图。 */
export async function applyTripUpdate(text: string, current: ParsedIntent): Promise<ParsedIntent | null> {
  if (!parseConfigured() || !text || !text.trim()) return null;
  const today = todayStr();
  const cur = JSON.stringify({
    origin: current.origin ?? null, destination: current.destination ?? null,
    start_date: current.start_date ?? null, end_date: current.end_date ?? null,
    travelers: current.travelers ?? null, budget_total: current.budget_total ?? null,
    budget_currency: current.budget_currency ?? "CNY", preferences: current.preferences ?? [],
  });
  const user = [
    "你是旅行行程助手。用户对「当前行程」做了一次修改（可能是改预算 / 人数 / 日期 / 目的地 / 加减天数等）。请给出修改后的完整行程意图。",
    `今天是 ${today}。相对日期照今天解析成 YYYY-MM-DD。`,
    "当前行程意图（JSON）：" + cur,
    "用户修改：" + text,
    "严格输出完整 JSON：{origin,destination,start_date,end_date,travelers,budget_total,budget_currency,preferences,ack}。" +
      "未提及的字段保持当前值。ack 用一句话复述修改后的行程。",
  ].join("\n");
  const reply = await chat([{ role: "user", content: user }], { json: true, maxTokens: 400, temperature: 0.2 });
  const obj = tryJson(reply);
  if (!obj) return null;
  return {
    origin: typeof obj.origin === "string" ? obj.origin : current.origin,
    destination: typeof obj.destination === "string" ? obj.destination : current.destination,
    start_date: normDate(obj.start_date) ?? current.start_date,
    end_date: normDate(obj.end_date) ?? current.end_date,
    travelers: typeof obj.travelers === "number" ? obj.travelers : current.travelers,
    budget_total: typeof obj.budget_total === "number" ? obj.budget_total : current.budget_total,
    budget_currency: typeof obj.budget_currency === "string" ? obj.budget_currency : (current.budget_currency ?? "CNY"),
    preferences: Array.isArray(obj.preferences) ? (obj.preferences as unknown[]).map(String) : current.preferences,
    ack: typeof obj.ack === "string" ? obj.ack : undefined,
  };
}
