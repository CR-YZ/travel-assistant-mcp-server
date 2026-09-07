/**
 * cache.ts —— SerpAPI 查询结果缓存层（成本控制命门，文档 §5 / §8）
 *
 * 用途：把「按查询参数」的机票/酒店搜索结果缓存起来，同一查询在 TTL 内命中时
 * 直接返回，不再消耗 SerpAPI 搜索次数 → 提升命中率、摊薄单用户成本。
 *
 * 后端优先级：
 *   1. Vercel KV（Upstash Redis）—— 配置了 KV_REST_API_URL/TOKEN 时用（可持久化、共享）。
 *   2. 进程内内存 Map —— 未配置 KV 时的兜底（单实例、进程重启即丢）。
 *
 * 关键设计：
 *   - key 稳定且确定：对查询参数做「规范化排序 + SHA-256」，不含 api_key / 时间戳。
 *   - TTL 统一读 env CACHE_TTL_SECONDS，clamp 到 [1h, 24h]（文档 §5：1–24h）。
 *   - cacheGet 命中不回调 miss、未命中才调 miss 并写回（防击穿的「单飞」省去不必要的并发回源）。
 */

import { createHash } from "node:crypto";

const DEFAULT_TTL = 3600; // 1 小时
const MIN_TTL = 3600; // 1h
const MAX_TTL = 86_400; // 24h

/** 读取并约束缓存 TTL（秒）。读 env CACHE_TTL_SECONDS，默认 1h，夹到 [1h,24h]。 */
export function cacheTtlSeconds(): number {
  const v = Number(process.env.CACHE_TTL_SECONDS);
  const n = Number.isFinite(v) && v > 0 ? Math.floor(v) : DEFAULT_TTL;
  return Math.min(Math.max(n, MIN_TTL), MAX_TTL);
}

/** 后端是否可用（配置了 Vercel KV 环境变量）。 */
export function kvEnabled(): boolean {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

/** 对对象做「键排序 + 递归规范化」，得到稳定的可序列化结构（排除 undefined）。 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    Object.keys(value as Record<string, unknown>)
      .sort()
      .forEach((k) => {
        const v = (value as Record<string, unknown>)[k];
        if (v !== undefined) out[k] = canonicalize(v);
      });
    return out;
  }
  return value;
}

/**
 * 生成稳定的缓存 key：`<prefix>:<sha256(canonical params)>[:<ttl>]`。
 * @param prefix 命名空间（如 search:flights / search:hotels）
 * @param params 查询参数（原始用户输入即可；内部会规范化排序并剔除 undefined）
 * @param ttl    可选，把 ttl 编进 key，避免同一参数因变更 TTL 命中旧缓存
 */
export function queryKey(prefix: string, params: Record<string, unknown>, ttl?: number): string {
  const canonical = JSON.stringify(canonicalize(params));
  const hash = createHash("sha256").update(canonical).digest("hex").slice(0, 32);
  return `${prefix}:${hash}${ttl ? `:t${ttl}` : ""}`;
}

/* ------------------ 内存兜底（KV 未配置时） ------------------ */
interface MemEntry {
  v: unknown;
  exp: number; // epoch ms
}
const mem = new Map<string, MemEntry>();

/** 仅用于测试：清空内存缓存。 */
export function flushMemoryCache(): void {
  mem.clear();
}

/* ------------------ 统一读写接口 ------------------ */

/** 读缓存。命中返回 value，否则 null。 */
export async function cacheGet<T = unknown>(key: string): Promise<T | null> {
  if (kvEnabled()) {
    try {
      const { kv } = await import("@vercel/kv");
      const raw = await kv.get<string>(key);
      return raw != null ? (JSON.parse(raw) as T) : null;
    } catch {
      return null; // KV 拉取失败视为未命中（不阻塞业务）
    }
  }
  const e = mem.get(key);
  if (!e) return null;
  if (e.exp <= Date.now()) {
    mem.delete(key);
    return null;
  }
  return e.v as T;
}

/** 写缓存。 */
export async function cacheSet<T = unknown>(key: string, value: T, ttl: number = cacheTtlSeconds()): Promise<void> {
  if (kvEnabled()) {
    try {
      const { kv } = await import("@vercel/kv");
      await kv.set(key, JSON.stringify(value), { ex: ttl });
    } catch {
      /* KV 写失败降级为不缓存，不影响业务 */
    }
    return;
  }
  mem.set(key, { v: value, exp: Date.now() + ttl * 1000 });
}

/**
 * 带缓存的取值：命中直接返回；未命中调用 miss() 取到值后写回缓存。
 * 返回 { value, hit }，并保证一个 key 在并发下只回源一次（内存后端单飞）。
 */
export async function cached<T>(key: string, miss: () => Promise<T>, ttl: number = cacheTtlSeconds()): Promise<{ value: T; hit: boolean }> {
  const hit = await cacheGet<T>(key);
  if (hit != null) return { value: hit, hit: true };
  const value = await miss();
  await cacheSet(key, value, ttl);
  return { value, hit: false };
}
