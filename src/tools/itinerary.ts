/**
 * itinerary.ts —— 行程 + 预算生成骨架（P0 差异化交付物）
 *
 * 对齐《04-tech-data-plan.md》第 6 节：
 *   - 输入：用户意图 + 已查候选（机票/酒店/日期/人数/预算）。
 *   - 输出：逐日行程表、预算账本（机票/酒店/餐饮/交通/门票分项）、完整避坑报告（渠道分级 + 3 步支付前核对清单）。
 *   - 数据源：已查的 SerpAPI 结果 + convert_currency（汇率）+ 用户预算。
 *
 * 本模块是「结构化骨架」：用类型化数据结构承载结果，并标注每个字段的来源（serpapi /
 * convert_currency）。真正的文案填充可由 LLM 拿到这份结构化结果后生成，这里给出最合理、
 * 可校验的默认值，确保 4 屏流程（🚨/⚠️/✅）有一份确定性的数据底座。
 */

import { z } from "zod";
import { NormalizedPriceSchema } from "./price-normalize";
import { CityCostProfileSchema, type CityCostProfile } from "./city-cost";

/* ------------------------------------------------------------------ *
 * Zod schema
 * ------------------------------------------------------------------ */

/** 行程意图。 */
export const TripIntentSchema = z.object({
  /** 目的地，如 "东京"。 */
  destination: z.string(),
  /** 出发地（可选，用于文案）。 */
  origin: z.string().optional(),
  /** 开始日期 YYYY-MM-DD。 */
  start_date: z.string(),
  /** 结束日期 YYYY-MM-DD（含当天）。 */
  end_date: z.string(),
  /** 出行人数。 */
  travelers: z.number().int().positive().default(2),
  /** 总预算（可选，币种见 budget_currency）。 */
  budget_total: z.number().positive().optional(),
  /** 预算币种。 */
  budget_currency: z.string().default("CNY"),
  /** 偏好（可选），如 ["美食", "购物", "亲子"]。 */
  preferences: z.array(z.string()).optional(),
});
export type TripIntent = z.infer<typeof TripIntentSchema>;

/** 机票候选（通常来自 search_flights 的 best_flights[i]）。 */
export const ItineraryFlightSchema = z.object({
  channel: z.string(),
  airline: z.string().optional(),
  flight_no: z.string().optional(),
  departure_time: z.string().optional(),
  arrival_time: z.string().optional(),
  duration: z.string().optional(),
  stops: z.number().int().optional(),
  /** 单价（每人，含税）。 */
  price: z.number().positive(),
  currency: z.string().optional(),
  normalized: NormalizedPriceSchema.optional(),
});
export type ItineraryFlight = z.infer<typeof ItineraryFlightSchema>;

/** 酒店候选（通常来自 search_hotels 的 properties[i]）。 */
export const ItineraryHotelSchema = z.object({
  channel: z.string(),
  name: z.string(),
  /** 每晚单价（含税）。 */
  nightly_rate: z.number().positive(),
  currency: z.string().optional(),
  rating: z.number().optional(),
  normalized: NormalizedPriceSchema.optional(),
});
export type ItineraryHotel = z.infer<typeof ItineraryHotelSchema>;

/** convert_currency 产出（来自 finance.convertCurrency）。 */
export const ConversionSchema = z.object({
  from_currency: z.string(),
  to_currency: z.string(),
  rate: z.number().positive(),
  converted_amount: z.number().optional(),
});
export type Conversion = z.infer<typeof ConversionSchema>;

/** 每日预算档位（人均/天，默认值，可按用户习惯覆盖）。 */
export const BudgetProfileSchema = z.object({
  dining_per_day: z.number().positive().default(200),
  transport_per_day: z.number().positive().default(120),
  tickets_per_day: z.number().positive().default(150),
});
export type BudgetProfile = z.infer<typeof BudgetProfileSchema>;

/** 单日行程。 */
export const DayPlanSchema = z.object({
  day_index: z.number(),
  date: z.string(),
  theme: z.string(),
  morning: z.string(),
  afternoon: z.string(),
  evening: z.string(),
  daily_cost: z.number(),
  notes: z.array(z.string()).optional(),
});
export type DayPlan = z.infer<typeof DayPlanSchema>;

/** 预算账本。 */
export const BudgetLedgerSchema = z.object({
  currency: z.string(),
  guests: z.number(),
  nights: z.number(),
  days: z.number(),
  flight_total: z.number(),
  hotel_total: z.number(),
  dining_total: z.number(),
  transport_total: z.number(),
  tickets_total: z.number(),
  subtotal: z.number(),
  budget_total: z.number().optional(),
  over_budget: z.boolean(),
  budget_gap: z.number().optional(),
  items: z.array(
    z.object({
      category: z.string(),
      amount: z.number(),
      note: z.string(),
    })
  ),
  conversion: ConversionSchema.optional(),
  /** 门票分项来源说明：真实活动票价 / 城市成本估算。 */
  tickets_source: z.string().optional(),
  /** 使用的城市成本档位（dining/transport/tickets per day），供前端标注来源。 */
  city_cost: z.object({
    city: z.string(),
    dining_per_day: z.number(),
    transport_per_day: z.number(),
    tickets_per_day: z.number(),
    source: z.string().optional(),
    updated: z.string().optional(),
  }).optional(),
});
export type BudgetLedger = z.infer<typeof BudgetLedgerSchema>;

/** 渠道分级。 */
export const ChannelGradeSchema = z.object({
  channel: z.string(),
  price: z.number(),
  severity: z.enum(["clean", "caution", "danger"]),
  grade: z.string(),
});
export type ChannelGrade = z.infer<typeof ChannelGradeSchema>;

/** 完整避坑报告。 */
export const AvoidPitfallReportSchema = z.object({
  channel_ranking: z.array(ChannelGradeSchema),
  recommended_channel: z.string().optional(),
  checklist: z.array(
    z.object({
      step: z.number(),
      title: z.string(),
      detail: z.string(),
    })
  ),
  source_note: z.string(),
});
export type AvoidPitfallReport = z.infer<typeof AvoidPitfallReportSchema>;

/** 完整行程 + 预算 + 避坑报告。 */
export const TripPlanSchema = z.object({
  intent: TripIntentSchema,
  days: z.array(DayPlanSchema),
  budget: BudgetLedgerSchema,
  pitfall: AvoidPitfallReportSchema,
  sources: z.object({
    flight: z.string(),
    hotel: z.string(),
    currency: z.string(),
  }),
});
export type TripPlan = z.infer<typeof TripPlanSchema>;

/* ------------------------------------------------------------------ *
 * 输入类型
 * ------------------------------------------------------------------ */

export type TripPlanOptions = {
  flights?: ItineraryFlight[];
  hotels?: ItineraryHotel[];
  /** convert_currency 的产出（若提供，会附到预算账本并用于说明）。 */
  conversion?: Conversion;
  /** 每日人均预算档位。 */
  budgetProfile?: BudgetProfile;
  /** 可选：按目的地的城市成本档位（dining/transport/tickets per day）。优先于 budgetProfile。 */
  cityCost?: CityCostProfile;
  /** 可选：真实活动/门票票价（来自 search_events.sample_events[].price），覆盖"门票"分项。 */
  events?: Array<{ title: string; price?: { amount?: number; currency?: string } | null; venue?: string }>;
  /** 可选：已跑好的异常检测报告（用于渠道分级）。 */
  anomalyReport?: {
    results: Array<{
      channel: string;
      severity: "clean" | "caution" | "danger";
      total_all_in: number;
    }>;
  };
};

/* ------------------------------------------------------------------ *
 * 工具函数
 * ------------------------------------------------------------------ */

const MS_PER_DAY = 86400000;

function dateRange(start: string, end: string): string[] {
  const s = new Date(`${start}T00:00:00Z`);
  const e = new Date(`${end}T00:00:00Z`);
  const days: string[] = [];
  let cur = new Date(s.getTime());
  // 容错：若日期非法，至少返回 1 天。
  if (isNaN(s.getTime())) return [start];
  while (cur.getTime() <= e.getTime()) {
    days.push(cur.toISOString().slice(0, 10));
    cur = new Date(cur.getTime() + MS_PER_DAY);
  }
  return days.length > 0 ? days : [start];
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** 用旅行/偏好关键词生成当天主题。 */
function themeFor(dayIndex: number, preferences: string[]): string {
  if (preferences.length > 0) {
    const pref = preferences[dayIndex % preferences.length];
    return `【${pref}】主题日`;
  }
  const pool = ["城市地标", "亲子/休闲", "美食探索", "购物/手信", "文化体验", "自然/近郊"];
  return pool[dayIndex % pool.length];
}

/* ------------------------------------------------------------------ *
 * 核心生成
 * ------------------------------------------------------------------ */

/**
 * 生成完整行程 + 预算账本 + 避坑报告。
 *
 * @param intent  行程意图。
 * @param options 候选数据（机票/酒店）+ 可选汇率 + 预算档位 + 可选异常报告。
 */
export function buildTripPlan(intent: TripIntent, options: TripPlanOptions = {}): TripPlan {
  const {
    flights = [],
    hotels = [],
    conversion,
    budgetProfile,
    cityCost,
    events = [],
    anomalyReport,
  } = options;

  const days = dateRange(intent.start_date, intent.end_date);
  const dayCount = days.length;
  const nights = Math.max(0, dayCount - 1);
  const travelers = intent.travelers;

  // 城市成本档位 优先；否则用用户自填 budgetProfile；否则用默认兜底。
  const cost = cityCost ?? {
    currency: "CNY",
    city: intent.destination,
    country: undefined,
    dining_per_day: budgetProfile?.dining_per_day ?? 200,
    transport_per_day: budgetProfile?.transport_per_day ?? 120,
    tickets_per_day: budgetProfile?.tickets_per_day ?? 150,
    source: "默认估算",
    updated: "2026-01",
  };
  const profile: BudgetProfile = {
    dining_per_day: cost.dining_per_day,
    transport_per_day: cost.transport_per_day,
    tickets_per_day: cost.tickets_per_day,
  };

  // 机票：取最低价一条（视为每人含税价，总额 = 单价 × 人数）。
  const bestFlight = [...flights].sort((a, b) => a.price - b.price)[0];
  const flightTotal = bestFlight ? round2(bestFlight.price * travelers) : 0;

  // 酒店：取最低每晚单价，按 1 间房整段计（每晚 × 晚数）。
  const bestHotel = [...hotels].sort((a, b) => a.nightly_rate - b.nightly_rate)[0];
  const hotelTotal = bestHotel ? round2(bestHotel.nightly_rate * nights) : 0;

  // 日常开销：餐饮 + 交通 + 门票，均按人均/天 × 人数 × 天数。
  const diningTotal = round2(profile.dining_per_day * travelers * dayCount);
  const transportTotal = round2(profile.transport_per_day * travelers * dayCount);
  // 门票：若有真实活动票价（search_events），用真实总额覆盖估算；否则用城市档位。
  const realTicketTotal = events.length
    ? round2(events.reduce((sum, e) => sum + (e.price?.amount ?? 0), 0) * travelers)
    : null;
  const ticketsTotal = realTicketTotal ?? round2(profile.tickets_per_day * travelers * dayCount);
  const ticketsSource =
    realTicketTotal != null ? `真实活动票价（${events.length} 个，人均 ¥${round2(realTicketTotal / travelers)}）` : `人均 ¥${profile.tickets_per_day}/天 × ${travelers} 人 × ${dayCount} 天`;

  const subtotal = round2(flightTotal + hotelTotal + diningTotal + transportTotal + ticketsTotal);
  const overBudget = intent.budget_total != null && subtotal > intent.budget_total;
  const budgetGap =
    intent.budget_total != null ? round2(intent.budget_total - subtotal) : undefined;

  const budget: BudgetLedger = {
    currency: intent.budget_currency,
    guests: travelers,
    nights,
    days: dayCount,
    flight_total: flightTotal,
    hotel_total: hotelTotal,
    dining_total: diningTotal,
    transport_total: transportTotal,
    tickets_total: ticketsTotal,
    subtotal,
    budget_total: intent.budget_total,
    over_budget: overBudget,
    budget_gap: budgetGap,
    items: [
      { category: "机票", amount: flightTotal, note: bestFlight ? `${bestFlight.channel} 含税单价 ¥${bestFlight.price} × ${travelers} 人` : "未选机票" },
      { category: "酒店", amount: hotelTotal, note: bestHotel ? `${bestHotel.name} ¥${bestHotel.nightly_rate}/晚 × ${nights} 晚` : "未选酒店" },
      { category: "餐饮", amount: diningTotal, note: `人均 ¥${profile.dining_per_day}/天 × ${travelers} 人 × ${dayCount} 天` },
      { category: "交通", amount: transportTotal, note: `市内人均 ¥${profile.transport_per_day}/天 × ${travelers} 人 × ${dayCount} 天` },
      { category: "门票", amount: ticketsTotal, note: ticketsSource },
    ],
    conversion,
    tickets_source: ticketsSource,
    city_cost: {
      city: cost.city,
      dining_per_day: cost.dining_per_day,
      transport_per_day: cost.transport_per_day,
      tickets_per_day: cost.tickets_per_day,
      source: cost.source,
      updated: cost.updated,
    },
  };

  // 逐日行程表。
  const preferences = intent.preferences ?? [];
  const dayPlans: DayPlan[] = days.map((date, i) => {
    const theme = themeFor(i, preferences);
    const dailyCost = round2(
      (profile.dining_per_day + profile.transport_per_day + profile.tickets_per_day) * travelers
    );
    const notes: string[] = [];
    if (bestFlight && i === 0) notes.push(`当天抵达：${bestFlight.airline ?? bestFlight.channel} ${bestFlight.flight_no ?? ""}`.trim());
    if (bestHotel) notes.push(`入住：${bestHotel.name}`);
    return {
      day_index: i + 1,
      date,
      theme,
      morning: `前往【${intent.destination}】${i === 0 ? "办理入住/集合" : "出发核心景点"}`,
      afternoon: `${theme.includes("美食") ? "特色餐厅用餐" : "自由探索 + 逛街"}`,
      evening: `夜景/夜市/自由活动，回${bestHotel ? bestHotel.name : "酒店"}休息`,
      daily_cost: dailyCost,
      notes,
    };
  });

  // 避坑报告：渠道分级 + 3 步支付前核对清单。
  const channelMap = new Map<string, { price: number; severity: "clean" | "caution" | "danger" }>();
  if (anomalyReport && anomalyReport.results.length) {
    anomalyReport.results.forEach((r) => {
      channelMap.set(r.channel, { price: r.total_all_in, severity: r.severity });
    });
  }
  // 若没有异常报告，则按价格给渠道一个默认分级。
  if (channelMap.size === 0) {
    ([...flights.map((f) => ({ channel: f.channel, price: f.price * travelers }))] as { channel: string; price: number }[])
      .forEach((c) => channelMap.set(c.channel, { price: c.price, severity: "clean" }));
  }

  const gradeOf = (severity: "clean" | "caution" | "danger") =>
    severity === "danger" ? "避坑" : severity === "caution" ? "可选" : "推荐";
  const channelRanking: ChannelGrade[] = [...channelMap.entries()]
    .map(([channel, v]) => ({
      channel,
      price: round2(v.price),
      severity: v.severity,
      grade: gradeOf(v.severity),
    }))
    .sort((a, b) => a.price - b.price);

  const recommended = channelRanking.find((c) => c.severity === "clean") ?? channelRanking[0];

  const checklist = [
    {
      step: 1,
      title: "核对到手价",
      detail: "确认最终支付价 = 裸价 + 税/服务费 + 行李 + 出票费，且未默认勾选 bundle（保险等自选加购）。",
    },
    {
      step: 2,
      title: "复核异常提示",
      detail: "看渠道分级：danger 直接放弃；caution 先核对「税费注水 / 默认搭售 / 标价跳变」来源再决定。",
    },
    {
      step: 3,
      title: "官方深链比对",
      detail: "跳转航司 / 航旅纵横官方 App 核对同航班 / 同房型总价，无捆绑再付款。（诚实声明：不为任何平台背书、不赚差价。）",
    },
  ];

  const pitfall: AvoidPitfallReport = {
    channel_ranking: channelRanking,
    recommended_channel: recommended?.channel,
    checklist,
    source_note: "数据来源：SerpAPI google_flights/best_flights + google_hotels/properties；汇率为 finance.convert_currency 产出。",
  };

  return {
    intent,
    days: dayPlans,
    budget,
    pitfall,
    sources: {
      flight: "src/tools/flight.ts → search_flights → best_flights[i].price",
      hotel: "src/tools/hotel.ts → search_hotels → properties[i].rate_per_night/total_rate",
      currency: "src/tools/finance.ts → convert_currency",
    },
  };
}
