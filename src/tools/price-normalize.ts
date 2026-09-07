/**
 * price-normalize.ts —— 价格成分归一化（差异化后端引擎 · 数据层核心）
 *
 * 对齐《04-tech-data-plan.md》第 3 节：
 *   所有价格统一归一成一个结构，后续算「到手价 / total_all_in」与「异常检测」都基于它。
 *
 * 语义对照（来自文档）：
 *   - `before_taxes_fees`  —— 当 base（裸价/房费，税前）
 *   - `lowest` / `total_rate` —— 当含税语义的标价（rate_per_night.lowest / total_rate.lowest）
 *
 * 到手价算法：
 *   到手价 = base + taxes_fees + baggage + booking_extra   （不含 bundle）
 *   hidden_gap = taxes_fees + bundle   （越大越提醒用户）
 *
 * 本模块是纯函数 + zod schema，不触碰网络，不与现有 tool 文件耦合。
 * 风格与 src/tools/flight.ts、hotel.ts 保持一致（导出具名函数，zod 定义 schema）。
 */

import { z } from "zod";

/** 统一到 2 位小数，避免浮点误差污染「到手价」。 */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** 输入一个价格对象的原始/成分字段（可来自不同的 SerpAPI 形状）。 */
export const PriceInputSchema = z.object({
  /** 数据来源，默认 "google"。 */
  source: z.string().optional(),
  /** 币种，默认 "CNY"。 */
  currency: z.string().optional().default("CNY"),
  /** 直接指定的裸价/房费。 */
  base: z.number().optional(),
  /** SerpAPI：税前裸价（rate_per_night.before_taxes_fees / total_rate.before_taxes_fees）。优先级高于 base。 */
  before_taxes_fees: z.number().optional(),
  /** SerpAPI：含税标价（rate_per_night.lowest）。 */
  lowest: z.number().optional(),
  /** SerpAPI：整段含税总价（total_rate.lowest）。优先级高于 lowest（stay 级别）。 */
  total_rate: z.number().optional(),
  /** 显式给出的税+服务费；若不传，则由「标价 - base」反推。 */
  taxes_fees: z.number().optional(),
  /** 行李。 */
  baggage: z.number().optional(),
  /** 出票/服务费。 */
  booking_extra: z.number().optional(),
  /** 自选加购（保险等），不计入到手价，但计入 hidden_gap。 */
  bundle: z.number().optional(),
});

export type PriceInput = z.infer<typeof PriceInputSchema>;

/** 单个价格分项（数值 + 中文标签，供下游 UI 直接展示）。 */
export const PriceComponentSchema = z.object({
  value: z.number(),
  label: z.string(),
});
export type PriceComponent = z.infer<typeof PriceComponentSchema>;

/** 归一化后的完整价格结构。 */
export const NormalizedPriceSchema = z.object({
  source: z.string(),
  currency: z.string(),
  components: z.object({
    base: PriceComponentSchema,
    taxes_fees: PriceComponentSchema,
    baggage: PriceComponentSchema,
    booking_extra: PriceComponentSchema,
    bundle: PriceComponentSchema,
  }),
  /** = base */
  subtotal_before_tax: z.number(),
  /** = base + taxes + baggage + booking_extra（不含 bundle） */
  total_all_in: z.number(),
  /** = taxes + bundle；越大越提醒用户 */
  hidden_gap: z.number(),
  /** 标价是否已含税。 */
  all_in_includes_tax: z.boolean(),
  /** 原始的含税标价（若可由 lowest/total_rate 得到），用于回溯。 */
  labeled_total: z.number().optional(),
});
export type NormalizedPrice = z.infer<typeof NormalizedPriceSchema>;

/**
 * 核心归一化函数：把「裸价 + 各种成分 / 或 serpapi 的 before_taxes_fees + lowest」归一成统一结构。
 *
 * 计算：
 *   base      = before_taxes_fees ?? base ?? 0
 *   taxes     = taxes_fees（若显式给出） ?? max(0, 标价 - base) ?? 0
 *   total_all_in = base + taxes + baggage + booking_extra
 *   hidden_gap   = taxes + bundle
 */
export function normalizePrice(input: PriceInput): NormalizedPrice {
  const source = input.source ?? "google";
  const currency = input.currency ?? "CNY";

  // 裸价：优先 serpapi 的 before_taxes_fees（税前裸价），其次显式 base。
  const base = round2(input.before_taxes_fees ?? input.base ?? 0);

  // 含税标价：优先 total_rate（stay 级别），其次 lowest（night 级别）。
  const labeledTotal =
    input.total_rate ?? input.lowest ?? (input.taxes_fees != null ? base + input.taxes_fees : undefined);

  // 税：显式给出优先；否则「标价 - base」反推（此时标价视为含税总价）。
  let taxes: number;
  if (input.taxes_fees != null) {
    taxes = round2(Math.max(0, input.taxes_fees));
  } else if (labeledTotal != null) {
    taxes = round2(Math.max(0, labeledTotal - base));
  } else {
    taxes = 0;
  }

  const baggage = round2(input.baggage ?? 0);
  const bookingExtra = round2(input.booking_extra ?? 0);
  const bundle = round2(input.bundle ?? 0);

  const subtotalBeforeTax = round2(base);
  const totalAllIn = round2(base + taxes + baggage + bookingExtra);
  const hiddenGap = round2(taxes + bundle);

  return {
    source,
    currency,
    components: {
      base: { value: base, label: "裸价/房费" },
      taxes_fees: { value: taxes, label: "税+服务费" },
      baggage: { value: baggage, label: "行李" },
      booking_extra: { value: bookingExtra, label: "出票/服务费" },
      bundle: { value: bundle, label: "自选加购(保险等)" },
    },
    subtotal_before_tax: subtotalBeforeTax,
    total_all_in: totalAllIn,
    hidden_gap: hiddenGap,
    all_in_includes_tax: true,
    labeled_total: labeledTotal != null ? round2(labeledTotal) : undefined,
  };
}

/**
 * 批量归一化：对一组价格对象逐一 normalizePrice（用于多卖家/多渠道比价）。
 */
export function normalizeMany(inputs: PriceInput[]): NormalizedPrice[] {
  return inputs.map(normalizePrice);
}

/* ------------------------------------------------------------------ *
 * 针对现有 SerpAPI 返回形状的便捷适配器（方便从 search_hotels /
 * search_flights 结果直接投喂，见 SRC_TOOLS_NOTES.md）。
 * ------------------------------------------------------------------ */

/** 从 google_hotels 的 rate_per_night（每晚）归一化。 */
export function normalizeHotelRatePerNight(property: {
  currency?: string;
  rate_per_night?: {
    before_taxes_fees?: number;
    lowest?: number;
  };
}): NormalizedPrice {
  const rate = property.rate_per_night ?? {};
  return normalizePrice({
    source: "google",
    currency: property.currency ?? "CNY",
    before_taxes_fees: rate.before_taxes_fees,
    lowest: rate.lowest,
  });
}

/** 从 google_hotels 的 total_rate（整段）归一化。 */
export function normalizeHotelTotalRate(property: {
  currency?: string;
  total_rate?: {
    before_taxes_fees?: number;
    lowest?: number;
  };
}): NormalizedPrice {
  const rate = property.total_rate ?? {};
  return normalizePrice({
    source: "google",
    currency: property.currency ?? "CNY",
    before_taxes_fees: rate.before_taxes_fees,
    total_rate: rate.lowest,
  });
}

/**
 * 从 google_flights 的单个航班归一化。
 * 注意：SerpAPI google_flights 的 `price` 通常就是含税总价，没有单独裸价，
 * 因此 base 取 price、taxes 留 0；若拿到 booking_options 里的
 * baggage_prices / local_prices，可后续补足 taxes 与 baggage。
 */
export function normalizeFlightPrice(flight: {
  currency?: string;
  price?: number;
  baggage_price?: number;
}): NormalizedPrice {
  return normalizePrice({
    source: "google",
    currency: flight.currency ?? "CNY",
    base: flight.price ?? 0,
    baggage: flight.baggage_price ?? 0,
  });
}
