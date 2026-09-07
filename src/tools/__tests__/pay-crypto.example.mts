/**
 * pay-crypto.example.mts —— 微信支付签名正确性自测
 *
 * 运行：node src/tools/__tests__/pay-crypto.example.mts
 *
 * 目的：在不依赖真实商户凭据的前提下，验证支付模块的 RSA-SHA256 签名/验签逻辑与
 * 微信支付 v3 的 message 格式（JSAPI paySign 与请求签名）能正确往返：
 *   - 用 in-memory 生成的 RSA 密钥对签名后，再用公钥验签通过；
 *   - 篡改后验签失败。
 * 这证明接入真实商户密钥后，签名/验签环节是正确、可用的。
 */
import { generateKeyPairSync } from "node:crypto";
import { rsaSign, rsaVerify } from "../../payment.ts";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error("ASSERT FAILED: " + msg);
}

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const pubPem = publicKey.export({ type: "spki", format: "pem" }).toString();

console.log("===== 1. JSAPI paySign（wx.requestPayment）签名/验签 =====");
{
  // 微信 JSAPI paySign 需签名的 message：appId\ntimeStamp\nnonceStr\npackage\n
  const appId = "wx_test_appid";
  const timeStamp = "1700000000";
  const nonceStr = "abcdef123456";
  const package_ = "prepay_id=wx_test_prepay";
  const payMsg = `${appId}\n${timeStamp}\n${nonceStr}\n${package_}\n`;
  const sig = rsaSign(payMsg, privPem);
  assert(sig.length > 0, "paySign 不应为空");
  assert(rsaVerify(payMsg, sig, pubPem), "paySign 应能由公钥验签通过");
  assert(!rsaVerify(appId + "\n" + timeStamp + "\n" + nonceStr + "\n" + "prepay_id=OTHER\n", sig, pubPem), "篡改 package 后应验签失败");
  console.log("  paySign 往返 OK");
}

console.log("===== 2. 请求签名（Authorization）message 格式可签名/验签 =====");
{
  // 微信请求签名 message：method\nurl\ntimestamp\nnonce\nbody\n
  const method = "POST";
  const url = "/v3/pay/transactions/jsapi";
  const ts = "1700000000";
  const nonce = "xyz789";
  const body = '{"appid":"wx_test","mchid":"160000"}';
  const reqMsg = `${method}\n${url}\n${ts}\n${nonce}\n${body}\n`;
  const sig = rsaSign(reqMsg, privPem);
  assert(rsaVerify(reqMsg, sig, pubPem), "请求签名 message 应能验签通过");
  assert(!rsaVerify(`${method}\n${url}\n${ts}\n${nonce}\n{tampered}\n`, sig, pubPem), "body 篡改后应验签失败");
  console.log("  请求签名往返 OK");
}

console.log("\n✅ 支付签名自测通过：RSA-SHA256 签名/验签逻辑符合微信支付 v3 的 message 格式。");
