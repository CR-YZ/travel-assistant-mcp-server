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
import { findCityMentions } from "./geo";

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

/** 规则日期推断（兜底，不依赖 LLM）：识别「X月Y号」「Y号」「下月中/下旬」「N天」等常见说法。
 *  返回 { start, end }（YYYY-MM-DD），解析不出返回空对象。 */
function parseDateShortcuts(text: string, today: string): { start?: string; end?: string } {
  const t = text || "";
  const now = today ? new Date(today + "T00:00:00") : new Date();
  const y = now.getFullYear();
  const month = now.getMonth() + 1;

  const pad = (n: number) => String(n).padStart(2, "0");

  // 「X月Y号/日」或「X月Y-Z号」
  let start: string | undefined, end: string | undefined;
  const m = t.match(/(\d{1,2})月(\d{1,2})[号日](?:-(\d{1,2})[号日])?/);
  if (m) {
    const mm = Math.min(12, Math.max(1, Number(m[1])));
    const dd = Math.min(31, Math.max(1, Number(m[2])));
    // 以今天为参照：若该月已过，则视为下一年（如"1月5号"在9月说 → 明年1月）
    const refYear = mm < month ? y + 1 : y;
    start = `${refYear}-${pad(mm)}-${pad(dd)}`;
    if (m[3]) {
      const dd2 = Math.min(31, Math.max(1, Number(m[3])));
      end = `${refYear}-${pad(mm)}-${pad(dd2)}`;
    }
  } else {
    // 「Y号」按当前月
    const d = t.match(/(\d{1,2})[号日]/);
    if (d) {
      const dd = Math.min(31, Math.max(1, Number(d[1])));
      start = `${y}-${pad(month)}-${pad(dd)}`;
    }
  }

  // 「下个月」→ 下月1号；「下月中/下旬」→ 下月15/25号
  const nx = t.match(/下个月([中下]?旬)?/);
  let nxStart: string | undefined;
  if (nx) {
    const nm = month === 12 ? 1 : month + 1;
    const ny = month === 12 ? y + 1 : y;
    const day = nx[1] === "中" ? 15 : nx[1] === "下" ? 25 : 1;
    nxStart = `${ny}-${pad(nm)}-${pad(day)}`;
    if (!start) start = nxStart;
    if (nx[1]) end = `${ny}-${pad(nm)}-${pad(day + 6)}`; // 下旬约到月底，取+6做区间
  }

  // 「N天」→ 结束 = 开始 + (N-1) 天（天数含头含尾）
  if (start) {
    const dayN = t.match(/(\d{1,2})天/);
    if (dayN) {
      const n = Math.max(1, Number(dayN[1]));
      const s = new Date(start + "T00:00:00");
      const e = new Date(s.getTime() + (n - 1) * 86400000);
      end = `${e.getFullYear()}-${pad(e.getMonth() + 1)}-${pad(e.getDate())}`;
    }
  }

  return { start, end };
}

export async function parseTripIntent(text: string): Promise<ParsedIntent | null> {
  if (!parseConfigured() || !text || !text.trim()) return null;
  const today = todayStr();
  const user = [
    "你是旅行行程助手。把下面这句话解析成行程意图，输出 JSON。",
    `今天是 ${today}。相对日期（"9月""下周三""3天"）按今天解析成 YYYY-MM-DD。`,
    "规则：",
    "- origin / destination：城市名原样填，只填原文里出现的地名，没有就 null。",
    "- start_date：出发日（YYYY-MM-DD），没给就 null。end_date：结束日，没给就 null。",
    "- travelers：出行人数（'2人'是2；'5天'不是人数，别混）。budget_currency 固定 CNY。",
    "- 只输出 JSON，不要多余文字：{\"origin\":string|null,\"destination\":string|null,\"start_date\":string|null,\"end_date\":string|null,\"travelers\":number|null,\"budget_total\":number|null,\"budget_currency\":\"CNY\",\"preferences\":[],\"ack\":\"一句话复述\"}",
    "例句：",
    "「9月8-11号从上海去成都，2人，预算4000」→ {origin:上海,destination:成都,start:2026-09-08,end:2026-09-11,travelers:2,budget_total:4000}",
    "「从成都去莫斯科7天」→ {origin:成都,destination:莫斯科,start:null,end:null,travelers:1}",
    "用户说：" + text,
  ].join("\n");
  const reply = await chat([{ role: "user", content: user }], { json: true, maxTokens: 500, temperature: 0.1 });
  const obj = tryJson(reply);
  if (!obj) return null;
  // 地名优先用规则扫描（确定性、含新建的莫斯科等境外城市）："从A去B/到B" → 首=出发、末=目的地。
  // LLM 输出仅作补充；当文本里能扫到地名时，以规则结果为准，避免 LLM 抽错/漏抽。
  const mentions = findCityMentions(text);
  let destination = mentions.length ? mentions[mentions.length - 1] : (typeof obj.destination === "string" ? obj.destination : undefined);
  let origin = mentions.length ? mentions[0] : (typeof obj.origin === "string" ? obj.origin : undefined);
  // 单地名且 LLM 补全了另一地时，保留 LLM 的
  if (mentions.length === 1) {
    if (!origin) origin = typeof obj.origin === "string" ? obj.origin : undefined;
    if (!destination) destination = typeof obj.destination === "string" ? obj.destination : undefined;
  }
  // 日期：LLM 优先，漏了用规则兜底（"10月15号""7天" 等常见说法）
  let startDate = normDate(obj.start_date);
  let endDate = normDate(obj.end_date);
  if (!startDate) {
    const sc = parseDateShortcuts(text, today);
    if (sc.start) { startDate = sc.start; if (!endDate && sc.end) endDate = sc.end; }
  }
  return {
    origin,
    destination,
    start_date: startDate,
    end_date: endDate,
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
  const sys = [
    "你是「AI旅行向导」的智能助手。严格遵循：",
    `今天是 ${today}。`,
    "- **目的地识别**：用户提到任何城市/国家名（含境外，如莫斯科、东京、巴黎、首尔、曼谷、吉隆坡…）都要填进 intent.destination，**原样照抄原文，不要翻译**。这是最关键的字段，宁可多填也别漏。",
    "- 若还缺行程关键信息（尤其目的地、日期），主动**追问**，action=ask（一次只问最关键的）。",
    "- 若用户问攻略/价格/航司类问题，直接**解答**，action=answer。",
    "- 若能确定行程意图（有目的地+日期），更新 intent 并 action=plan（系统会去查价/出洞察）。",
    "- action=plan 时，reply 只需简短确认已识别的行程和下一步结果；如果系统会返回价格洞察，不要再次追问地点、日期、人数或偏好，也不要重复询问用户的意图。只有确实缺少关键字段时才 action=ask。",
    "- 用户提到偏好（经济/舒适/档/航司/美食/购物/亲子…）**必须**合并进 intent.preferences。",
    "- reply 简洁自然；intent 保留已有字段、只更新变化处。",
  ].join("\n");
  const user = [
    "当前意图（JSON）：" + cur,
    "对话记录：",
    convo,
    "严格输出 JSON：{\"reply\":\"...\",\"action\":\"ask|answer|plan\",\"intent\":{origin?,destination?,start_date?,end_date?,travelers?,budget_total?,budget_currency?,preferences?}}",
  ].join("\n");
  const raw = await chat(
    [
      { role: "system", content: sys },
      { role: "user", content: user },
    ],
    { json: true, maxTokens: 500, temperature: 0.5 }
  );
  const obj = tryJson(raw);
  if (!obj) return { reply: "我在呢～再跟我说说你的行程呗", action: "ask", intent: current };
  const action = obj.action === "plan" ? "plan" : obj.action === "answer" ? "answer" : "ask";
  const updated = obj.intent ? parseIntentObj((obj.intent ?? {}) as Record<string, unknown>, current) : current;
  // 兜底：始终从「最近一条用户消息」用规则提取地名对（first=出发地、last=目的地），
  // 避免同对话里换行程时 LLM 沿用了旧出发地（如再发"成都去西安"却仍按上海查价）。
  const lastUser = ([...(messages || [])].reverse().find((m) => m.role === "user")?.content) || "";
  const mentions = findCityMentions(lastUser);
  if (mentions.length >= 2) {
    // 明确出现"从A去B"，用 A 覆盖 origin、B 覆盖 destination
    updated!.origin = mentions[0];
    updated!.destination = mentions[mentions.length - 1];
  } else if (mentions.length === 1 && !updated?.destination) {
    updated!.destination = mentions[0];
  }
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
