/**
 * payment.ts —— 微信支付（小程序 JSAPI）按次解锁（¥10）的后端模块
 *
 * 目标（《02-payment-experience.md》《06-metrics-validation.md》）：
 *   按次 ¥10 解锁完整交付物。本模块负责「创建微信支付订单」+「生成 wx.requestPayment
 *   参数」+「校验支付结果」；前端在解锁前先下单、支付成功后经后端校验再解锁。
 *
 * 关键（诚实声明）：
 *   - 真实微信支付需要商户号 + 微信登录(openid) + 各项密钥/证书。本项目当前无商户凭据，
 *     因此本模块做了「两态」：
 *       ① 配置了 WECHAT_* 环境变量 → 走真实微信支付 v3（APIv3 下单 + RSA 签名）。
 *       ② 未配置 → 走 **mock**（返回 mock 订单 + 模拟支付成功），保证 demo/开发可演示全流程，
 *         且响应带 mock:true 明确标注「非真实支付」。
 *   - 接入真实支付前，需在小程序用 wx.login 拿 code → 后端 code2session 换 openid；
 *     本模块接受前端传入的 openid（真实模式），mock 模式下可省略。
 *
 * 环境变量（真实模式）：
 *   WECHAT_APPID / WECHAT_MCHID / WECHAT_PAY_SERIAL_NO / WECHAT_PAY_API_V3_KEY(32位) /
 *   WECHAT_PAY_MCH_PRIVATE_KEY(PEM) / WECHAT_PAY_NOTIFY_URL / WECHAT_CODE2SESSION_SECRET
 */

import { createSign, createVerify, createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

const PAY_BASE = "https://api.mch.weixin.qq.com";
const PRICE_FEN = 1000; // ¥10 = 1000 分
const UNLOCK_LABEL = "AI 旅行诚实向导 · 解锁完整行程+预算";

export function wechatPayConfigured(): boolean {
  return Boolean(
    process.env.WECHAT_APPID &&
      process.env.WECHAT_MCHID &&
      process.env.WECHAT_PAY_SERIAL_NO &&
      process.env.WECHAT_PAY_API_V3_KEY &&
      process.env.WECHAT_PAY_MCH_PRIVATE_KEY
  );
}

function nonce(): string {
  return randomUUID().replace(/-/g, "");
}

let _merchantKey: string | undefined;
/** 商户私钥：环境变量可填 PEM 字符串，或填 PEM 文件路径（自动读取）。 */
function getMerchantPrivateKey(): string {
  if (_merchantKey) return _merchantKey;
  const raw = process.env.WECHAT_PAY_MCH_PRIVATE_KEY ?? "";
  _merchantKey = raw.includes("-----BEGIN") ? raw : readFileSync(raw, "utf8");
  return _merchantKey;
}

/** 生成 RSA-SHA256 签名（用于请求签名与 wx.requestPayment 的 paySign）。 */
export function rsaSign(message: string, privateKeyPem: string): string {
  const sign = createSign("RSA-SHA256");
  sign.update(message);
  return sign.sign(privateKeyPem, "base64");
}

/** 用平台(商家)密钥对应的证书校验回调签名（真实通知校验用，MVP 先行保留）。 */
export function rsaVerify(message: string, signatureBase64: string, publicKeyPem: string): boolean {
  try {
    const v = createVerify("RSA-SHA256");
    v.update(message);
    return v.verify(publicKeyPem, signatureBase64, "base64");
  } catch {
    return false;
  }
}

/** 构造微信支付 v3 请求头 Authorization。 */
function authHeader(method: string, urlPath: string, body: string): string {
  const mchid = process.env.WECHAT_MCHID!;
  const serial = process.env.WECHAT_PAY_SERIAL_NO!;
  const privateKey = getMerchantPrivateKey();
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonceStr = nonce();
  const message = `${method}\n${urlPath}\n${timestamp}\n${nonceStr}\n${body}\n`;
  const signature = rsaSign(message, privateKey);
  return (
    `WECHATPAY2-SHA256-RSA2048 mchid="${mchid}",nonce_str="${nonceStr}",` +
    `signature="${signature}",timestamp="${timestamp}",serial_no="${serial}"`
  );
}

export interface OrderPayload {
  /** 用户标识（用于 mock 订单归属；真实模式需要 openid）。 */
  clientId?: string;
  /** wx.login 拿到的 openid（真实模式必填）。 */
  openid?: string;
  /** 金额（分），默认 ¥10。 */
  amountFen?: number;
  description?: string;
  outTradeNo?: string;
}

export interface CreateOrderResult {
  mock: boolean;
  orderId: string;
  prepayId?: string;
  /** 供前端 wx.requestPayment 的参数（mock 模式下为模拟值）。 */
  payParams?: {
    appId: string;
    timeStamp: string;
    nonceStr: string;
    package: string;
    signType: "RSA";
    paySign: string;
    mock?: boolean;
  };
  message?: string;
}

/**
 * 创建 JSAPI 支付订单，返回 wx.requestPayment 所需的参数。
 * 未配置商户凭据时返回 mock（mock:true），避免 demo 拿不到真单。
 */
export async function createJsapiOrder(payload: OrderPayload): Promise<CreateOrderResult> {
  const amountFen = payload.amountFen ?? PRICE_FEN;
  const orderId = payload.outTradeNo ?? `ath-${Date.now()}-${nonce().slice(0, 8)}`;
  const appid = process.env.WECHAT_APPID;

  if (!wechatPayConfigured()) {
    const fakePrepay = `MOCK_prepay_${orderId}`;
    return {
      mock: true,
      orderId,
      prepayId: fakePrepay,
      payParams: {
        appId: appid ?? "touristappid",
        timeStamp: Math.floor(Date.now() / 1000).toString(),
        nonceStr: nonce(),
        package: `prepay_id=${fakePrepay}`,
        signType: "RSA",
        paySign: `MOCK_SIGN_${nonce()}`,
        mock: true,
      },
      message: `未配置微信支付资质，使用 mock 模拟支付（¥${(amountFen / 100).toFixed(2)}）。接入真实支付前请配置 WECHAT_* 环境变量并提供 openid。`,
    };
  }

  // 真实微信支付 v3 统一下单
  if (!payload.openid) return { mock: false, orderId, message: "真实支付需要 openid（wx.login → code2session）" };
  const path = "/v3/pay/transactions/jsapi";
  const body = JSON.stringify({
    appid,
    mchid: process.env.WECHAT_MCHID,
    description: payload.description ?? UNLOCK_LABEL,
    out_trade_no: orderId,
    notify_url: process.env.WECHAT_PAY_NOTIFY_URL,
    amount: { total: amountFen, currency: "CNY" },
    payer: { openid: payload.openid },
  });
  const res = await fetch(`${PAY_BASE}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      authorization: authHeader("POST", path, body),
    },
    body,
  });
  const data = (await res.json()) as { prepay_id?: string; message?: string };
  if (!res.ok || !data.prepay_id) {
    return { mock: false, orderId, message: data.message || `微信支付下单失败(${res.status})` };
  }
  const timeStamp = Math.floor(Date.now() / 1000).toString();
  const package_ = `prepay_id=${data.prepay_id}`;
  const payMessage = `${appid}\n${timeStamp}\n${nonce()}\n${package_}\n`;
  const paySign = rsaSign(payMessage, getMerchantPrivateKey());
  return {
    mock: false,
    orderId,
    prepayId: data.prepay_id,
    payParams: {
      appId: appid!,
      timeStamp,
      nonceStr: nonce(),
      package: package_,
      signType: "RSA",
      paySign,
    },
  };
}

export interface VerifyResult {
  paid: boolean;
  mock: boolean;
  orderId: string;
  amountFen?: number;
  message?: string;
}

/**
 * 校验订单是否已支付（用于解锁）。
 * 真实模式：查询微信支付订单状态（需商户凭据）；未配置时 mock 返回 paid。
 */
export async function verifyPaid(orderId: string): Promise<VerifyResult> {
  if (!wechatPayConfigured() || orderId.startsWith("MOCK_") || orderId.startsWith("ath-mock")) {
    // mock：demo/开发无真实交易，按已支付处理（前端会标注 mock）
    return { paid: true, mock: true, orderId, amountFen: PRICE_FEN, message: "mock 支付：已模拟支付成功（非真实交易）" };
  }
  // 真实模式查询订单：GET /v3/pay/transactions/out-trade-no/{out_trade_no}
  const path = `/v3/pay/transactions/out-trade-no/${encodeURIComponent(orderId)}?mchid=${process.env.WECHAT_MCHID}`;
  const res = await fetch(`${PAY_BASE}${path}`, {
    method: "GET",
    headers: { accept: "application/json", authorization: authHeader("GET", path, "") },
  });
  const data = (await res.json()) as { trade_state?: string; amount?: { total?: number } };
  const paid = data.trade_state === "SUCCESS";
  return { paid, mock: false, orderId, amountFen: data.amount?.total, message: data.trade_state };
}

/** 派生稳定订单 id：以 clientId+金额(分) 生成一个可重放的 out_trade_no（同一次行程不重复扣费）。 */
export function deriveOutTradeNo(clientId: string, amountFen = PRICE_FEN): string {
  const h = createHash("sha256").update(`${clientId}|${amountFen}`).digest("hex").slice(0, 16);
  return `ath-${clientId || "anon"}-${amountFen}-${h}`;
}
