import { createHash, timingSafeEqual } from "node:crypto";

// Server-to-server only: never embed PAID_PROXY_SECRET in browser/mobile code.
export async function authorizePaidRequest(req, { env = process.env, fetcher = fetch } = {}) {
  const expected = env.PAID_PROXY_SECRET || "";
  const supplied = req.headers.get("authorization")?.match(/^Bearer ([^\s]+)$/)?.[1] || "";
  if (expected.length < 32) return Response.json({ error: "Paid proxy authentication is not configured" }, { status: 503 });
  const left = Buffer.from(supplied), right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const url = env.UPSTASH_REDIS_REST_URL || "", token = env.UPSTASH_REDIS_REST_TOKEN || "";
  if (!/^https:\/\//.test(url) || !token) return Response.json({ error: "Persistent usage limits are not configured" }, { status: 503 });
  // Atomic fleet-wide request budget. Rejected requests cannot start provider work.
  const script = "local a=redis.call('INCR',KEYS[1]); if a==1 then redis.call('EXPIRE',KEYS[1],60) end; local b=redis.call('INCR',KEYS[2]); if b==1 then redis.call('EXPIRE',KEYS[2],86400) end; if a>tonumber(ARGV[1]) or b>tonumber(ARGV[2]) then return 0 end; return 1";
  const namespace = createHash("sha256").update(expected).digest("hex").slice(0, 24);
  const minute = Math.min(60, Math.max(1, Number(env.PAID_MAX_REQUESTS_PER_MINUTE) || 10));
  const day = Math.min(10000, Math.max(1, Number(env.PAID_MAX_REQUESTS_PER_DAY) || 100));
  try {
    const response = await fetcher(url.replace(/\/+$/, ""), { method: "POST", headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(["EVAL", script, "2", `paid:${namespace}:minute`, `paid:${namespace}:day`, String(minute), String(day)]), signal: AbortSignal.timeout(5000), cache: "no-store" });
    if (!response.ok) throw new Error("quota unavailable");
    const result = await response.json();
    if (result.error || (result.result !== 0 && result.result !== 1)) throw new Error("invalid quota response");
    if (result.result === 0) return Response.json({ error: "Usage limit reached" }, { status: 429 });
    return null;
  } catch {
    return Response.json({ error: "Usage limits unavailable" }, { status: 503 });
  }
}

export async function readPaidJson(req, maxBytes = 1_000_000) {
  if (Number(req.headers.get("content-length") || 0) > maxBytes) throw new Error("Request too large");
  const reader = req.body?.getReader();
  if (!reader) return {};
  let bytes = 0; const chunks = [];
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) { await reader.cancel(); throw new Error("Request too large"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

export function boundAIInput(body, env = process.env) {
  const allowed = (env.PAID_ALLOWED_MODELS || "gpt-4o-mini").split(",").map(x => x.trim()).filter(Boolean);
  if (body.model && !allowed.includes(body.model)) throw new Error("Model is not permitted");
  return { ...body, model: body.model || allowed[0], max_tokens: Math.min(2048, Math.max(1, Number(body.max_tokens) || 1024)), max_completion_tokens: undefined, n: 1, options: undefined };
}
