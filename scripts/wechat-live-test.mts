/**
 * wechat-live-test.mts —— 真实微信登录 + 支付联调脚本
 *
 * 前置（真实联调必须）：
 *   1. 小程序 appid 已绑定微信支付商户号；已在后端配置 WECHAT_APPID / WECHAT_CODE2SESSION_SECRET。
 *   2. 已配置 WECHAT_MCHID / WECHAT_PAY_SERIAL_NO / WECHAT_PAY_API_V3_KEY / WECHAT_PAY_MCH_PRIVATE_KEY。
 *   3. 在微信开发者工具（真实 appid）里跑小程序，wx.login 拿一个真实 code。
 *
 * 运行（在 travel-assistant-mcp-server 目录，Node >= 24）：
 *   node --env-file=.env.local scripts/wechat-live-test.mts <wx.login的code>
 *
 * 会执行：真实 code2session(code) → openid → 真实 createJsapiOrder(openid) → 打印 wx.requestPayment 参数。
 * 若未配置商户凭据会明确提示，不会发出真实请求。
 */
import { code2session, wechatLoginConfigured } from "../src/auth.ts";
import { createJsapiOrder, wechatPayConfigured } from "../src/payment.ts";

const code = process.argv[2];
if (!code) {
  console.error("用法: node --env-file=.env.local scripts/wechat-live-test.mts <wx.login loginCode>");
  process.exit(1);
}

console.log("login configured:", wechatLoginConfigured());
console.log("pay  configured:", wechatPayConfigured());

if (!wechatLoginConfigured()) {
  console.error("❌ 未配置 WECHAT_APPID / WECHAT_CODE2SESSION_SECRET，无法真实 code2session。");
  process.exit(1);
}

const s = await code2session(code);
console.log("code2session ->", JSON.stringify(s));
if (!s.openid) {
  console.error("❌ code2session 未拿到 openid（code 可能已过期，或 appid/secret 不匹配）。", s.message || "");
  process.exit(1);
}

if (!wechatPayConfigured()) {
  console.error("❌ 未配置微信支付凭据（WECHAT_MCHID/SERIAL_NO/API_V3_KEY/MCH_PRIVATE_KEY），下单会走 mock。");
  process.exit(1);
}

const order = await createJsapiOrder({ openid: s.openid, clientId: s.openid, amountFen: 1000, description: "联调测试 ¥10" });
console.log("create order (real) ->", JSON.stringify(order, null, 2));

if (order.payParams && !order.mock) {
  console.log("\n✅ 下单成功。把这些 payParams 传给 wx.requestPayment 即可拉起真机支付：",
    JSON.stringify(order.payParams));
}
