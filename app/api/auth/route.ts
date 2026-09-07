import { code2session } from "@/src/auth";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type, accept",
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

/** POST /api/auth —— 微信小程序 code → openid（未配置时返回 mock openid）。 */
export async function POST(req: Request): Promise<Response> {
  try {
    const body = (await req.json().catch(() => ({}))) as { code?: string };
    if (!body.code) return json({ ok: false, error: "code is required (wx.login)" }, 400);
    const r = await code2session(body.code);
    if (!r.openid) return json({ ok: false, error: r.message || "code2session failed" }, 502);
    return json({ ok: true, openid: r.openid, mock: r.mock, message: r.message });
  } catch (error) {
    return json({ ok: false, error: String((error as Error).message) }, 500);
  }
}
