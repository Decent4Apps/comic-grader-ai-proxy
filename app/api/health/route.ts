// app/api/health/route.ts
export const runtime = "nodejs";

function shasum(s: string) {
  // tiny inline sha256 hex (no crypto import needed for a short hash)
  // NOTE: In Node 18+ you can use crypto.subtle; here we avoid async:
  const crypto = require("node:crypto") as typeof import("node:crypto");
  return crypto.createHash("sha256").update(s).digest("hex");
}

export const GET = async () => {
  const prod = process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";
  const secret = process.env.AUTH_JWT_SECRET || process.env.JWT_SECRET || "";
  const secretHash = secret ? shasum(secret).slice(0, 12) : "missing";
  const vercelUrl = process.env.VERCEL_URL || null;

  return new Response(
    JSON.stringify({
      ok: true,
      env: prod ? "production" : "non-production",
      secretHash,
      vercelUrl,
      routes: ["/api/health", "/api/auth/anon", "/api/ai", "/api/events", "/api/analyses"],
      ts: new Date().toISOString(),
    }),
    { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" } }
  );
};

export const OPTIONS = async () =>
  new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type, authorization, x-bypass-token",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "cache-control": "no-store",
    },
  });
