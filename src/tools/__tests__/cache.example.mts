/**
 * cache.example.mts —— 缓存层自测 / 用法示例
 *
 * 运行：node src/tools/__tests__/cache.example.mts
 * （Node >= 23.6 原生 TS 支持；会输出 MODULE_TYPELESS_PACKAGE_JSON 警告，属预期无副作用）
 *
 * 目的：验证 cache.ts 的核心语义符合《04-tech-data-plan.md》§5 成本控制设计：
 *   - key 稳定确定（同一查询→同一缓存键；api_key/时间戳不参与 → 命中率可控）；
 *   - TTL 统一 clamp 到 [1h, 24h]；
 *   - 内存兜底读写 / 过期即失效 / flush 可清空；
 *   - cached() 命中不重复回源（省 SerpAPI 次数）。
 */
import {
  queryKey,
  cacheTtlSeconds,
  kvEnabled,
  cacheGet,
  cacheSet,
  cached,
  flushMemoryCache,
} from "../cache.ts";

// 隔离：始终用内存兜底（本进程不加载 .env.local，确保无 KV）
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;
delete process.env.CACHE_TTL_SECONDS;

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}
function banner(title: string): void {
  console.log(`\n===== ${title} =====`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

banner("1. key 确定性：同内容(键序无关/undefined 剔除)→同 key；不同值→不同 key；前缀隔离");
{
  // 模拟 flight.ts 实际传入的 keyObj：不含 api_key / 不含时间戳（命中率可控）
  const flightKeyObj = { engine: "google_flights", departure_id: "PVG", arrival_id: "CTU", outbound_date: "2026-09-08", return_date: undefined, type: 1, adults: 2, currency: "CNY", max_results: 10 };
  const k1 = queryKey("search:flights", flightKeyObj);
  // 键序打乱 + 剔除 undefined，仍应同 key
  const k2 = queryKey("search:flights", { max_results: 10, engine: "google_flights", adults: 2, outbound_date: "2026-09-08", arrival_id: "CTU", departure_id: "PVG", currency: "CNY", type: 1 });
  assert(k1 === k2, `键序无关/undefined 剔除应同 key (${k1} vs ${k2})`);
  // 不同值 → 不同 key
  const k3 = queryKey("search:flights", { ...flightKeyObj, departure_id: "SHA" });
  assert(k1 !== k3, "不同出发地应不同 key");
  const k4 = queryKey("search:flights", { ...flightKeyObj, outbound_date: "2026-09-09" });
  assert(k1 !== k4, "不同日期应不同 key");
  // key 不含明文 secret（哈希化，且 flight 的 keyObj 本就剔除 api_key）
  const withSecret = queryKey("search:flights", { ...flightKeyObj, api_key: "SECRET" });
  assert(!withSecret.includes("SECRET"), "key 不应含明文 secret");
  // 前后缀隔离
  const kh = queryKey("search:hotels", { location: "成都", currency: "CNY" });
  assert(!kh.startsWith("search:flights"), "hotel 前缀与 flight 隔离");
  console.log("  示例 key：", k1, "|\n           ", kh);
}

banner("2. TTL clamp 到 [1h, 24h]");
{
  process.env.CACHE_TTL_SECONDS = "100";
  assert(cacheTtlSeconds() === 3600, "100s 应夹到 3600");
  process.env.CACHE_TTL_SECONDS = "999999";
  assert(cacheTtlSeconds() === 86400, "999999s 应夹到 86400");
  delete process.env.CACHE_TTL_SECONDS;
  assert(cacheTtlSeconds() === 3600, "默认 3600");
}

banner("3. 内存兜底：读写 / 未命中 / flush / TTL 过期");
{
  flushMemoryCache();
  assert(kvEnabled() === false, "无 KV env 时应确认内存后端");
  const key = "search:flights:abc";
  const g0 = await cacheGet(key);
  assert(g0 === null, "未命中应返回 null");
  await cacheSet(key, { search_id: "s1", best: 3 }, 3600);
  const g1 = await cacheGet<{ search_id: string; best: number }>(key);
  assert(g1 !== null && g1.search_id === "s1" && g1.best === 3, "写后应能读回等值对象");
  flushMemoryCache();
  const g2 = await cacheGet(key);
  assert(g2 === null, "flush 后应清空");
  // 过期：直接传短 TTL（绕过 clamp）
  await cacheSet(key, { v: "exp" }, 1);
  await sleep(1200);
  const g3 = await cacheGet(key);
  assert(g3 === null, `TTL=1s 过期后应失效 (got ${g3})`);
  console.log("  内存缓存读写 / flush / 过期 通过");
}

banner("4. cached()：命中不重复回源，未命中回源一次并写回");
{
  flushMemoryCache();
  let calls = 0;
  const miss = async (): Promise<{ n: number }> => {
    calls++;
    return { n: calls };
  };
  const r1 = await cached("k:1", miss, 3600);
  const r2 = await cached("k:1", miss, 3600);
  assert(r1.hit === false && r1.value.n === 1, "首次应 miss 且回源");
  assert(r2.hit === true && r2.value.n === 1, "二次应 hit（复用缓存值）");
  assert(calls === 1, `回源次数应为 1（实际 ${calls}）`);
  // 不同 key 独立
  const r3 = await cached("k:2", miss, 3600);
  assert(r3.hit === false && calls === 2, "新 key 应独立回源");
  console.log("  cached() 命中短传 通过（calls=" + calls + "）");
}

console.log("\n✅ 缓存层自测全部通过：cache.ts 语义符合文档 §5 成本控制设计。");
