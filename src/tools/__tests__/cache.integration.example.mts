/**
 * cache.integration.example.mts —— 集成示例：验证「搜索路径命中缓存不回源」的成本节省效果
 *
 * ⚠️ 参考示例：import 了 flight.ts/hotel.ts，而项目内相对导入是无扩展名（`../kv`、`./cache`）。
 *   Node 原生 TS（`node x.mts`）无法解析无扩展名导入（ERR_MODULE_NOT_FOUND），这是 native-TS
 *   的已知限制、非代码问题（Next / tsc / tsx 均可解析）。
 *   → 常规自测请用 `cache.example.mts`（纯缓存语义，可直接 `node` 跑）。
 *   → 本文件建议用 tsx 运行：`npx tsx src/tools/__tests__/cache.integration.example.mts`
 *     或直接以真实 `next dev` + MCP 端点实测（见 SRC_TOOLS_NOTES.md 第八节）。
 *
 * 行为：mock 全局 fetch 统计调用次数，用同一组查询参数调用 searchFlights 两次：
 *   - 第一次 cache_status=miss（回源 1 次）
 *   - 第二次 cache_status=hit  （不再调 fetch，复用缓存）
 *   以此证明 §5「命中率→成本」的机制成立。
 */
import { searchFlights } from "../flight.ts";
import { searchHotels } from "../hotel.ts";
import { flushMemoryCache } from "../cache.ts";

process.env.SERPAPI_KEY = "test-key";
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

const flightsFake = { best_flights: [{ a: 1 }, { a: 2 }], other_flights: [], price_insights: { lowest_price: 809 }, airports: [] };
const hotelsFake = { properties: [{ name: "A", rate_per_night: { extracted_lowest: 300 } }], search_information: {}, brands: [] };

let flightFetchCalls = 0;
let hotelFetchCalls = 0;
const origFetch = globalThis.fetch;
(globalThis as { fetch: unknown }).fetch = async (url: unknown) => {
  const u = String(url);
  if (u.includes("google_flights")) {
    flightFetchCalls++;
    return { ok: true, json: async () => flightsFake } as unknown as Response;
  }
  if (u.includes("google_hotels")) {
    hotelFetchCalls++;
    return { ok: true, json: async () => hotelsFake } as unknown as Response;
  }
  throw new Error("unexpected url: " + u);
};

try {
  flushMemoryCache();
  const params = { departure_id: "PVG", arrival_id: "CTU", outbound_date: "2026-09-08", return_date: "2026-09-11", adults: 2, currency: "CNY", max_results: 5 };

  const r1 = (await searchFlights(params)) as { cache_status?: string; total_best_flights: number };
  const r2 = (await searchFlights(params)) as { cache_status?: string; total_best_flights: number };

  console.log("flight call1 cache_status=", r1.cache_status, "call2=", r2.cache_status, "fetchCalls=", flightFetchCalls);
  assert(r1.cache_status === "miss", "首次应 miss");
  assert(r2.cache_status === "hit", "第二次应 hit");
  assert(flightFetchCalls === 1, `SerpAPI 应只回源 1 次（实际 ${flightFetchCalls}）`);
  assert(r2.total_best_flights === 2, "hit 返回缓存结果(含 best_flights 数量)");

  // 不同参数 → 独立缓存键，应再次回源
  const r3 = (await searchFlights({ ...params, outbound_date: "2026-09-09" })) as { cache_status?: string };
  console.log("flight call3 (不同日期) cache_status=", r3.cache_status, "fetchCalls=", flightFetchCalls);
  assert(r3.cache_status === "miss", "不同日期应再次 miss（新 key）");
  assert(flightFetchCalls === 2, `不同日期应回源到第 2 次（实际 ${flightFetchCalls}）`);

  // hotel 同理
  flushMemoryCache();
  const h1 = (await searchHotels({ location: "成都", check_in_date: "2026-09-08", check_out_date: "2026-09-11", adults: 2, currency: "CNY", max_results: 5 })) as { cache_status?: string };
  const h2 = (await searchHotels({ location: "成都", check_in_date: "2026-09-08", check_out_date: "2026-09-11", adults: 2, currency: "CNY", max_results: 5 })) as { cache_status?: string };
  console.log("hotel call1 cache_status=", h1.cache_status, "call2=", h2.cache_status, "fetchCalls=", hotelFetchCalls);
  assert(h1.cache_status === "miss" && h2.cache_status === "hit", "hotel 应 miss→hit");
  assert(hotelFetchCalls === 1, `hotel SerpAPI 应只回源 1 次（实际 ${hotelFetchCalls}）`);

  console.log("\n✅ 缓存集成自测通过：相同查询命中缓存、不再消耗 SerpAPI 搜索次数。");
} finally {
  (globalThis as { fetch: unknown }).fetch = origFetch;
}
