/**
 * quota.ts —— 免费用户硬性限流（《04-tech-data-plan.md》§5：命中率/成本生死线）
 *
 * 目的：控制单用户每日的「昂贵操作」次数（analyze_travel / generate_trip_plan 会触发
 * 多次 SerpAPI 搜索），超限即拒绝并提示付费墙，防止免费用户把成本刷爆。
 *
 * 语义：
 *   - 按「作用域 scope + 标识 id + 自然日」计数，默认每日上限 FREE_DAILY_LIMIT（默认 2）。
 *   - 后端优先级：Vercel KV（原子 incr + expire，可多实例共享）> 进程内内存 Map（未配 KV 时兜底）。
 *   - 返回 { allowed, remaining, limit, reset }，前端用它决定放行/展示付费墙。
 *
 * 注意：本模块自包含（不 import 项目内其他模块），仅读环境变量，便于在测试里单独跑。
 */

const DAY_SECONDS = 86_400;

/** 读取免费每日上限（env FREE_DAILY_LIMIT，默认 2；负数视为 0 即仅免费额度用完）。 */
export function freeDailyLimit(): number {
  const v = Number(process.env.FREE_DAILY_LIMIT);
  if (!Number.isFinite(v)) return 2;
  return Math.floor(v) >= 0 ? Math.floor(v) : 0;
}

/** KV 是否可用（配置了 Vercel KV）。 */
function kvEnabled(): boolean {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

/** 生成每日计数 key：`quota:<scope>:<id>:<YYYY-MM-DD>`。 */
export function quotaKey(scope: string, id: string, dateIso?: string): string {
  const d = dateIso ?? new Date().toISOString().slice(0, 10);
  return `quota:${scope}:${id}:${d}`;
}

/* ------------------ 内存兜底（无 KV 时） ------------------ */
interface MemSlot {
  count: number;
  day: string;
}
const mem = new Map<string, MemSlot>();
/** 仅用于测试：清空内存计数。 */
export function flushQuotaMemory(): void {
  mem.clear();
}

/**
 * 消耗一次额度。返回结果：
 *   allowed   本次是否放行（count <= limit）
 *   remaining 剩余可用次数（>=0）
 *   limit     当日上限
 *   reset     本日额度重置的 epoch 秒
 */
export async function consumeDailyQuota(
  scope: string,
  id: string,
  limit = freeDailyLimit()
): Promise<{ allowed: boolean; remaining: number; limit: number; reset: number }> {
  const key = quotaKey(scope, id);
  const now = new Date();
  const reset = Math.floor(now.getTime() / 1000) + DAY_SECONDS;

  if (kvEnabled()) {
    try {
      const { kv } = await import("@vercel/kv");
      const count = await kv.incr(key);
      if (count === 1) await kv.expire(key, DAY_SECONDS);
      const allowed = count <= limit;
      return { allowed, remaining: Math.max(0, limit - count), limit, reset };
    } catch {
      /* KV 失败 → 退到内存计数（不影响业务） */
    }
  }

  const day = now.toISOString().slice(0, 10);
  const cur = mem.get(key);
  let count = cur && cur.day === day ? cur.count : 0;
  count += 1;
  mem.set(key, { count, day });
  const allowed = count <= limit;
  return { allowed, remaining: Math.max(0, limit - count), limit, reset };
}

/** 只读：当前已用次数（测试/监控用，不消耗）。 */
export async function currentUsed(scope: string, id: string): Promise<number> {
  const key = quotaKey(scope, id);
  if (kvEnabled()) {
    try {
      const { kv } = await import("@vercel/kv");
      return (await kv.get<number>(key)) ?? 0;
    } catch {
      return 0;
    }
  }
  const slot = mem.get(key);
  return slot ? slot.count : 0;
}
