/**
 * airport-code.ts —— 城市 → IATA 机场三字码（白名单 + Tavily 兜底）
 *
 * 背景：geo.ts 的 CITY_AIRPORTS 手写表覆盖不全，境外/冷门城市查不到机场码时，
 *       planner.ts 的 `if (dep && arr)` 会静默跳过机票（表现为「没有机票信息」）。
 *
 * 方案：两级解析，自愈补盲区：
 *   1) 白名单 cityToAirport（geo.ts）—— 免费、零延迟、零额度。
 *   2) 白名单查不到且配置了 TAVILY_API_KEY → 调 Tavily /search（含 answer）
 *      问「X 机场的 IATA 三字码」，从答案里正则提取 3 位大写字母。
 *      结果缓存 `airportCode:<city>`（TTL 拉长，机场码是静态数据）。
 *
 * 不配置 TAVILY_API_KEY 时自动降级为仅白名单（不报错、不阻塞链路）。
 */
import { cityToAirport } from "./geo";
import { queryKey, cacheGet, cacheSet } from "./cache";

const TAVILY_URL = "https://api.tavily.com/search";
const AIRPORT_TTL = 30 * 24 * 3600; // 30 天（机场码几乎不变）

function tavilyConfigured(): boolean {
  return Boolean(process.env.TAVILY_API_KEY);
}

/** 常见英文 3 字母词，避免误当 IATA 码（如 "THE"/"FOR"/"AIR"）。 */
const IATA_STOPWORDS = new Set([
  "THE", "AND", "FOR", "NOT", "ARE", "YOU", "AIR", "INT", "ALL", "BUT", "CAN", "HAS", "ITS", "OUR",
  "OUT", "WHO", "WAS", "WER", "WIT", "TRA", "TRAVEL",
]);

/** 从一段文本里提取 IATA 三字码。优先括号标注，否则取最后一个非停用词的独立 3 大写字母串。 */
function extractIata(text: string): string | undefined {
  if (!text) return undefined;
  // 1) 括号内三字码：如 "Sheremetyevo (SVO)" / "Moscow (SVO)"
  const paren = text.match(/\(([A-Z]{3})\)/);
  if (paren) return paren[1];
  // 2) 独立的三字大写字母串，剔除常见英文词（THE/AND/FOR…），取最后一个（IATA 码通常在句末）
  const all = text.match(/\b[A-Z]{3}\b/g) || [];
  const cand = all.filter((c) => !IATA_STOPWORDS.has(c));
  return cand.length ? cand[cand.length - 1] : undefined;
}

/** Tavily 搜索：问「X 城市的主要机场 IATA 三字码」，返回 answer 文本。 */
async function tavilySearchAnswer(city: string): Promise<string> {
  const res = await fetch(TAVILY_URL, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.TAVILY_API_KEY}` },
    body: JSON.stringify({
      query: `${city} 的主要机场 IATA 三字码是什么？直接给出机场代码，格式如 (SVO)，只要 3 个大写字母，不要别的。`,
      search_depth: "basic",
      max_results: 3,
      include_answer: true,
      include_raw_content: false,
    }),
  });
  if (!res.ok) return "";
  const data = (await res.json()) as { answer?: string; results?: Array<{ content?: string }> };
  // 优先 answer；其次拼接结果 content
  const contents = (data.results ?? []).map((r) => r.content ?? "").join(" ");
  return data.answer || contents || "";
}

/**
 * 城市 → IATA 机场码。先白名单，再 Tavily（需配置），全失败返回 undefined。
 * 结果缓存 30 天，避免重复消耗 Tavily 次数。
 */
export async function airportCodeFor(city: string | undefined): Promise<string | undefined> {
  if (!city) return undefined;
  const whitelist = cityToAirport(city);
  if (whitelist) return whitelist;

  if (!tavilyConfigured()) return undefined;

  const ckey = queryKey("airportCode", { city }, AIRPORT_TTL);
  const cached = await cacheGet<string>(ckey);
  if (cached) return cached;

  let code: string | undefined;
  try {
    const answer = await tavilySearchAnswer(city);
    code = extractIata(answer);
  } catch {
    code = undefined;
  }
  if (code) await cacheSet(ckey, code, AIRPORT_TTL);
  return code;
}
