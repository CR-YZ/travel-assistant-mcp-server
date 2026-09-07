/**
 * quota.example.mts —— 免费用户限流自测（《04-tech-data-plan.md》§5）
 *
 * 运行：node src/tools/__tests__/quota.example.mts
 *
 * 隔离：删除 KV / FREE_DAILY_LIMIT 环境变量 → 恒走内存计数后端。
 * 验证：默认每日上限、quotaKey 格式、限额内放行 + remaining、超限拒绝、
 *      按 id 与 scope 相互独立、flush 可清零。
 */
import { consumeDailyQuota, freeDailyLimit, quotaKey, flushQuotaMemory, currentUsed } from "../../quota.ts";

delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;
delete process.env.FREE_DAILY_LIMIT;

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}
const banner = (t: string) => console.log(`\n===== ${t} =====`);

banner("1. 默认每日上限 = 2");
{
  assert(freeDailyLimit() === 2, `默认 2（实际 ${freeDailyLimit()}）`);
}

banner("2. quotaKey 格式 & 隔离");
{
  const k = quotaKey("analyze_travel", "u1");
  assert(k.startsWith("quota:analyze_travel:u1:") && /:\d{4}-\d{2}-\d{2}$/.test(k), `格式应为 ...:YYYY-MM-DD（实际 ${k}）`);
  assert(quotaKey("generate_trip_plan", "u1") !== k, "不同 scope 应不同 key");
  assert(quotaKey("analyze_travel", "u2") !== k, "不同 id 应不同 key");
}

banner("3. 限额内放行 → 超限拒绝 → remaining");
{
  flushQuotaMemory();
  const q1 = await consumeDailyQuota("analyze_travel", "u1");
  assert(q1.allowed === true && q1.remaining === 1, `第1次应放行 remaining=1（got ${JSON.stringify(q1)}）`);
  const q2 = await consumeDailyQuota("analyze_travel", "u1");
  assert(q2.allowed === true && q2.remaining === 0, `第2次应放行 remaining=0`);
  const q3 = await consumeDailyQuota("analyze_travel", "u1");
  assert(q3.allowed === false && q3.remaining === 0, `第3次应拒绝 remaining=0（got ${JSON.stringify(q3)}）`);
  assert((await currentUsed("analyze_travel", "u1")) === 3, "已用次数应为 3");
}

banner("4. 按 id / scope 独立计数");
{
  const q4 = await consumeDailyQuota("analyze_travel", "u2");
  assert(q4.allowed === true && q4.remaining === 1, "不同用户应各自放行");
  const q5 = await consumeDailyQuota("generate_trip_plan", "u1");
  assert(q5.allowed === true, "不同 scope 独立（generate_trip_plan 首用应放行）");
}

banner("5. FREE_DAILY_LIMIT 可配");
{
  process.env.FREE_DAILY_LIMIT = "5";
  assert(freeDailyLimit() === 5, `配 5 应生效（实际 ${freeDailyLimit()}）`);
  delete process.env.FREE_DAILY_LIMIT;
}

banner("6. flush 清零");
{
  flushQuotaMemory();
  assert((await currentUsed("analyze_travel", "u1")) === 0, "flush 后 u1 已用应为 0");
}

console.log("\n✅ 限流自测全部通过：quota.ts 符合 §5 每日硬性限额语义。");
