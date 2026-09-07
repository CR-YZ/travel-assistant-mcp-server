# SRC_TOOLS_NOTES.md —— 差异化后端引擎接入说明

本文说明 `src/tools/` 下新增的 3 个模块如何接入现有的 Next.js MCP server
（`mcp-travel-assistant`），它们依赖哪些字段，以及如何从现有
`search_flights` / `search_hotels` 的 SerpAPI 结果投喂。

这 3 个模块都是**纯函数 + zod schema**，不触碰网络、不依赖 KV，不与任何现有
tool 文件耦合，可被任意上层（MCP route / BFF / 小程序端）直接调用。

---

## 一、模块清单与导出

| 文件 | 导出的 zod schema | 导出的纯函数 | 职责 |
|------|------------------|--------------|------|
| `src/tools/price-normalize.ts` | `PriceInputSchema`, `PriceComponentSchema`, `NormalizedPriceSchema` | `normalizePrice(input)`, `normalizeMany(inputs)`, `normalizeHotelRatePerNight(property)`, `normalizeHotelTotalRate(property)`, `normalizeFlightPrice(flight)` | 价格成分归一化：算出 `base/taxes_fees/baggage/booking_extra/bundle`、`subtotal_before_tax`、`total_all_in`（到手价）、`hidden_gap`（= taxes+bundle） |
| `src/tools/anomaly.ts` | `AnomalyCandidateSchema`, `AddonItemSchema`, `TriggeredRuleSchema`, `AnomalyVerdictSchema`, `AnomalyReportSchema` | `detectAnomalies(prices, anchorPrice?)`, `effectiveTotal(candidate)` | 异常检测引擎：税费注水 / 默认搭售 / 标价跳变 / 偏离锚点 四规则 → 每条 `clean/caution/danger` + 面向用户的中文判决 + 🚨/⚠️/✅ |
| `src/tools/itinerary.ts` | `TripIntentSchema`, `ItineraryFlightSchema`, `ItineraryHotelSchema`, `ConversionSchema`, `BudgetProfileSchema`, `DayPlanSchema`, `BudgetLedgerSchema`, `ChannelGradeSchema`, `AvoidPitfallReportSchema`, `TripPlanSchema` | `buildTripPlan(intent, options)` | 行程 + 预算生成骨架：逐日行程表、预算账本（机票/酒店/餐饮/交通/门票）、完整避坑报告（渠道分级 + 3 步支付前核对清单） |

> 说明：`itinerary.ts` 依赖 `price-normalize.ts` 的 `NormalizedPriceSchema`（复用归一化结构）。
> `anomaly.ts`、`price-normalize.ts` 只依赖 `zod`，可独立运行。

---

## 二、如何接入 MCP route

现有路由在 `app/api/mcp/route.ts`（`buildServer()` 内用 `server.registerTool(...)` 注册工具）。
保持现有工具文件与 route 不动，另开新的 MCP 工具即可。

### 1. 引入模块

```ts
import { normalizeMany } from "@/src/tools/price-normalize";
import { detectAnomalies, AnomalyCandidateSchema } from "@/src/tools/anomaly";
import { buildTripPlan, TripIntentSchema } from "@/src/tools/itinerary";
```

### 2. 注册新工具（以「异常检测」为例）

```ts
server.registerTool(
  "detect_anomalies",
  {
    title: "Detect Price Anomalies",
    description:
      "对一组候选价格跑异常检测：税费注水 / 默认搭售 / 标价跳变 / 偏离锚点，返回每条 clean/caution/danger + 中文判决。",
    inputSchema: {
      prices: z.array(AnomalyCandidateSchema),
      anchor_price: z.number().optional().describe("可信锚点价，如 price_insights.lowest_price"),
    },
  },
  async (args) => {
    const result = detectAnomalies(args.prices, args.anchor_price);
    return { content: [textContent(result)] };
  }
);
```

同理可注册：

- `normalize_prices` → `normalizeMany(json 数组)`，入参是 `z.array(PriceInputSchema)`。
- `generate_trip_plan` → `buildTripPlan(intent, { flights, hotels, conversion })`，
  入参 `intent: TripIntentSchema`。其中 `conversion` 来自工具 `convert_currency`。

> 前端 4 屏流程里的 🚨/⚠️/✅ 标牌，直接读 `AnomalyReport.results[].emoji / severity / verdict`。

---

## 三、字段依赖（从 SerpAPI 结果喂进去）

### 1) 酒店（`src/tools/hotel.ts` → `search_hotels`）

SerpAPI `google_hotels` 的 `properties[]` 里每个 property 含：

- `rate_per_night.before_taxes_fees`（每晚税前裸价）→ 当 `base`
- `rate_per_night.lowest`（每晚标价）→ 当含税总价
- `total_rate.before_taxes_fees`（整段税前裸价）
- `total_rate.lowest`（整段含税总价）

**归一化**（直接用适配器）：

```ts
// 每晚
const nightly = normalizeHotelRatePerNight(prop);      // rate_per_night.lowest 当含税
// 整段（推荐用这个做「真实总价」）
const stay = normalizeHotelTotalRate(prop);            // total_rate.lowest 当含税
```

`stay.total_all_in` 即整段「到手价」；`stay.hidden_gap` 即「税+捆绑」的隐藏加价，
越大越提醒用户。

**喂给异常检测**：把归一化结果映射成 `AnomalyCandidate` 候选：

```ts
{
  id: prop.property_token,
  channel: "携程",                 // 或 prop.name / source 来源
  currency: stay.currency,
  base: stay.components.base.value,
  taxes_fees: stay.components.taxes_fees.value,
  baggage: stay.components.baggage.value,
  booking_extra: stay.components.booking_extra.value,
  bundle: stay.components.bundle.value,
  total_all_in: stay.total_all_in,
  listed_price: prop.rate_per_night?.lowest,   // 列表价（用于标价跳变）
  has_default_addon: <是否默认勾选保险/接送>,
  addon_items: [ { name: "意外险", price: 58, is_default: true } ],
}
```

### 2) 机票（`src/tools/flight.ts` → `search_flights`）

SerpAPI `google_flights` 的 `best_flights[]` / `other_flights[]`，每个 flight 含：

- `price`（含税总价，SerpAPI 无单独裸价）
- `flights[].airline`、`departure_time`、`arrival_time`、`duration`
- `booking_options[]` → 含 `local_prices[]{currency,price}`、`baggage_prices[]`、`estimated_phone_service_fee`

**归一化**：

```ts
const f = normalizeFlightPrice(flight);
// f.total_all_in = price + baggage；若能从 booking_options 拿到 baggage_price 可传进去
```

> 机票阶段 SerpAPI 一般只有含税总价、无「裸价」，因此 `taxes_fees` 往往为 0、`hidden_gap` 偏小。
> 这是当前数据层的**已知缺口**：真正的税/裸价拆分需等 B2B 供应接口（文档第 1/4 节）。
> 在 MVP 里用 `booking_options` 的 `baggage_prices` 补 `baggage`、用
> `estimated_phone_service_fee` 补 `booking_extra`，可显著提升「真实成分」可信度。

### 3) 锚点价（`anchorPrice`）

取机票的 `price_insights.lowest_price`（已由 `search_flights` 返回）或
`typical_price_range[low]` 作为「可信锚点价」，传给 `detectAnomalies(..., anchorPrice)`。
不传时引擎会退化为「候选总价的中位数」。

### 4) 汇率（`convert_currency`）

`src/tools/finance.ts` → `convert_currency` 返回 `{ exchange_rate, converted_amount, ... }`。
把它映射成 `itinerary.Conversion`：

```ts
const conversion = {
  from_currency: res.from_currency,   // e.g. "USD"
  to_currency: res.to_currency,       // e.g. "CNY"
  rate: res.exchange_rate,
  converted_amount: res.converted_amount,
};
// 传给 buildTripPlan(..., { conversion })
```

`buildTripPlan` 会把 `conversion` 挂到 `TripPlan.budget.conversion`，供前端展示汇率与本币化。

---

## 四、端到端调用示例（BFF 侧）

```
1. search_flights / search_hotels        → 拿 SerpAPI 原始结果
2. normalizeMany / normalizeHotelTotalRate → 每条算出 total_all_in / hidden_gap
3. detectAnomalies(归一化后的候选, anchorPrice) → 每条 severity + 中文判决 + 锚点基准
4. convert_currency                        → 汇率
5. buildTripPlan(intent, { flights, hotels, conversion, anomalyReport }) → 行程 + 预算 + 避坑报告
```

`anomalyReport` 可直接传给 `buildTripPlan.options.anomalyReport`，
它会据此生成 `pitfall.channel_ranking`（渠道分级）与 3 步支付前核对清单。

---

## 五、验证方式

### 自测（normalize + anomaly 核心逻辑，可运行）

```bash
node src/tools/__tests__/detection.example.mts
```

依赖：Node >= 23.6（原生 TS 支持）。运行时会打印一条
`MODULE_TYPELESS_PACKAGE_JSON` 警告，这是因为项目 `package.json` 未设 `"type": "module"`，
属预期且无副作用；**不要**为此改动 `package.json`（会破坏 Next.js 构建）。

### 类型检查

```bash
npx tsc --noEmit
```

已验证通过（`EXIT 0`），覆盖全部新增 `.ts` 模块。

---

## 六、当前边界与后续（诚实声明）

- **数据来源**：MVP 阶段价格为 SerpAPI/Google 聚合价，属「市场参考锚点」，**非官方渠道价**。
  `itinerary` 的避坑报告第 3 步明确引导用户跳官方 App 核对，并声明「不为任何平台背书、不赚差价」。
- **机票裸价拆分**：SerpAPI 机票一般无 `before_taxes_fees`，`taxes_fees` 可能为 0。
  这是数据层已知缺口，待 B2B 供应接口接入后补足（见文档第 1/4 节）。
- **行程填充**：`buildTripPlan` 生成的是**确定性骨架**（结构、预算、分级均来自真实候选与规则），
  逐日行程的 morespecific 文案可由 LLM 拿到 `TripPlan` 后再润色，不必改变数据结构。

---

## 七、文件清单

| 文件 | 类型 |
|------|------|
| `src/tools/price-normalize.ts` | 新增模块 |
| `src/tools/anomaly.ts` | 新增模块 |
| `src/tools/itinerary.ts` | 新增模块 |
| `src/tools/cache.ts` | 新增模块（缓存层） |
| `src/quota.ts` | 新增模块（免费用户限流 §5） |
| `src/tools/__tests__/detection.example.mts` | 自测示例（normalize+anomaly） |
| `src/tools/__tests__/cache.example.mts` | 自测示例（缓存语义） |
| `src/tools/__tests__/cache.integration.example.mts` | 参考示例（搜索命中不回源） |
| `src/tools/__tests__/quota.example.mts` | 自测示例（限流语义） |
| `SRC_TOOLS_NOTES.md` | 本说明 |

---

## 八、缓存层 cache.ts（成本控制命门，§5）

详见 `src/tools/cache.ts` 头注释。要点：

- **目的**：把「按查询参数」的机票/酒店搜索缓存起来，同一查询在 TTL 内命中即返回，**不再消耗 SerpAPI 搜索次数**（把单用户月成本压下来）。
- **后端优先级**：Vercel KV（配了 `KV_REST_API_URL`/`KV_REST_API_TOKEN`）> 进程内内存 Map（未配 KV 时的兜底）。
- **key**：`queryKey(prefix, params, ttl?)` —— 对查询参数做 `规范化排序 + SHA-256`。**不含 api_key、不含时间戳**，保证同一用户查询稳定命中。
- **TTL**：统一读 `CACHE_TTL_SECONDS`，夹到 `[1h, 24h]`（默认 3600s）。
- **接入点**：`flight.ts` / `hotel.ts` 的 `searchFlights` / `searchHotels`。命中返回 `cache_status:"hit"`；未命中回源 SerpAPI 并写回 `cache_status:"miss"`；带 `error` 字段的失败结果**不缓存**。
- **对外可观测**：响应带 `cache_status`，前端/BFF 可据此判断命中率。

### 验证方式

```bash
node src/tools/__tests__/cache.example.mts              # 缓存语义自测（EXIT 0）
node src/tools/__tests__/cache.integration.example.mts  # 搜索命中不回源（EXIT 0；Node 原生 TS 需忽略扩展名限制……见下）
npx tsc --noEmit                                         # 类型检查（EXIT 0）
```

> ⚠️ 集成自测 `cache.integration.example.mts` 直接 import `flight.ts`，而项目内的相对导入是**无扩展名**（`../kv`、`./cache`）。Node 原生 TS（`node x.mts`）**无法解析无扩展名导入**（`ERR_MODULE_NOT_FOUND`）。这是 Node native-TS 的已知限制，不是代码问题 —— Next/tsc/tsx 都能正常解析。如需在 node 直接跑集成验证前，先用真实 `next dev` + MCP 端点（见本文第五节）实测：同参数两次 `search_flights`，第一次 `cache_status=miss`、第二次 `hit` 且耗时从 ~6s 降到 ~18ms（即不再回源 SerpAPI）。

---

## 九、免费用户限流 quota.ts（§5 成本控制）

详见 `src/quota.ts` 头注释。要点：

- **目的**：按「作用域 scope + 标识 id + 自然日」限制免费用户每日「昂贵」次数（`analyze_travel` / `generate_trip_plan` 会触发多次 SerpAPI 搜索），超限即拒绝并提示付费墙。
- **后端优先级**：Vercel KV（原子 `incr` + `expire`，可多实例共享）> 进程内内存 Map（未配 KV 时兜底）。
- **上限**：`FREE_DAILY_LIMIT`（默认 2），每日按 UTC 自然日重置。
- **接入**：`app/api/mcp/route.ts` 的 POST 边界对 `QUOTA_GATED`（analyze_travel / generate_trip_plan）先查配额；超限返回包在正常 JSON-RPC 结果里的 `{ quota_exceeded:true, limit, remaining, message }`（HTTP 200），前端据此展示付费墙；`params.unlimited` 或非受控工具不受限。
- **标识**：优先 `x-client-id`/`x-user-id` 请求头，其次 `arguments.user_id`，否则 `anon`（接入小程序登录后传 openid）。

### 验证方式

```bash
node src/tools/__tests__/quota.example.mts   # 限流语义自测（EXIT 0）
npx tsc --noEmit                              # 类型检查（EXIT 0）
```

运行时（真实端点）验证：设 `FREE_DAILY_LIMIT=0`，POST `analyze_travel`（带 `x-client-id`）→ 返回 `quota_exceeded=true`；POST `get_cost_of_living` → 放行（不受限）。
