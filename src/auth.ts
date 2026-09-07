/**
 * auth.ts —— 微信小程序登录：code → openid（用于真实支付 + 每日限流标识）
 *
 * 流程：小程序 wx.login() 拿 code → 后端调微信 jscode2session → 拿 openid。
 * openid 既作为「用户标识」(quota/支付订单归属)，也是微信支付 JSAPI 下单的 payer.openid。
 *
 * 两态（诚实声明）：
 *   - 配置了 WECHAT_APPID + WECHAT_CODE2SESSION_SECRET → 真实微信登录。
 *   - 未配置 → mock：返回确定性 mock openid（标注 mock:true），demo/开发可跑通全流程，非真实登录。
 */
import { createHash } from "node:crypto";

export function wechatLoginConfigured(): boolean {
  return Boolean(process.env.WECHAT_APPID && process.env.WECHAT_CODE2SESSION_SECRET);
}

export interface Code2SessionResult {
  openid: string;
  mock: boolean;
  session_key?: string;
  message?: string;
}

export async function code2session(code: string): Promise<Code2SessionResult> {
  if (!wechatLoginConfigured()) {
    const openid = "mock_openid_" + createHash("sha256").update(code || "anon").digest("hex").slice(0, 12);
    return { openid, mock: true, message: "未配置微信登录(APPID/CODE2SESSION_SECRET)，返回 mock openid" };
  }
  const url = new URL("https://api.weixin.qq.com/sns/jscode2session");
  url.searchParams.set("appid", process.env.WECHAT_APPID!);
  url.searchParams.set("secret", process.env.WECHAT_CODE2SESSION_SECRET!);
  url.searchParams.set("js_code", code);
  url.searchParams.set("grant_type", "authorization_code");
  const res = await fetch(url.toString());
  const data = (await res.json()) as { openid?: string; session_key?: string; errmsg?: string };
  if (data.openid) return { openid: data.openid, mock: false, session_key: data.session_key };
  return { openid: "", mock: false, message: data.errmsg || "code2session failed" };
}
