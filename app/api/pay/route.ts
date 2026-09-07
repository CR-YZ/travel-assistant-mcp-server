import { createJsapiOrder, verifyPaid, deriveOutTradeNo } from "@/src/payment";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, GET, OPTIONS",
  "access-control-allow-headers": "content-type, accept, x-client-id",
};
function applyCors(res: Response): Response {
  for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v);
  return res;
}
function json(data: unknown, status = 200): Response {
  return applyCors(new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } }));
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS });
}

/** POST /api/pay —— 创建支付订单，返回 wx.requestPayment 参数（含 mock 标注）。 */
export async function POST(req: Request): Promise<Response> {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      client_id?: string;
      openid?: string;
      amount_fen?: number;
      description?: string;
      order_id?: string;
    };
    const clientId = body.client_id || req.headers.get("x-client-id") || "anon";
    const orderId = body.order_id || deriveOutTradeNo(clientId, body.amount_fen ?? 1000);
    const result = await createJsapiOrder({
      clientId,
      openid: body.openid,
      amountFen: body.amount_fen,
      description: body.description,
      outTradeNo: orderId,
    });
    return json({ ok: true, order_id: result.orderId, ...result });
  } catch (error) {
    return json({ ok: false, error: String((error as Error).message) }, 500);
  }
}

/** GET /api/pay?order_id=... —— 校验订单是否已支付（支付成功后前端据此解锁）。 */
export async function GET(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const orderId = url.searchParams.get("order_id") || "";
    if (!orderId) return json({ ok: false, error: "order_id is required" }, 400);
    const result = await verifyPaid(orderId);
    return json({ ok: true, ...result });
  } catch (error) {
    return json({ ok: false, error: String((error as Error).message) }, 500);
  }
}
