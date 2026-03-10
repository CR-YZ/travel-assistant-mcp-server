/**
 * Optional Vercel KV storage for search results (flight, hotel, event, etc.).
 * Set KV_REST_API_URL and KV_REST_API_TOKEN in Vercel for persistence.
 */
const TTL_SECONDS = 3600; // 1 hour

export async function kvSet(key: string, value: object): Promise<void> {
  try {
    const { kv } = await import("@vercel/kv");
    await kv.set(key, JSON.stringify(value), { ex: TTL_SECONDS });
  } catch {
    // KV not configured
  }
}

export async function kvGet<T = object>(key: string): Promise<T | null> {
  try {
    const { kv } = await import("@vercel/kv");
    const raw = await kv.get<string>(key);
    if (typeof raw === "string") return JSON.parse(raw) as T;
    return raw as T | null;
  } catch {
    return null;
  }
}

export function kvAvailable(): boolean {
  return Boolean(
    process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN
  );
}
