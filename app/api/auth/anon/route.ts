// app/api/auth/anon/route.ts
import { withCORS } from "../../_lib/cors"; // ← adjust if your CORS helper lives elsewhere
import { createSessionJWT } from "@/src/auth/tokens";

export const runtime = "nodejs";

/**
 * GET → returns a short-lived anon token (1 hour)
 * POST → accepts JSON { sub?, scope?, ttl? } to customize claims and TTL
 */
export const GET = withCORS(async () => {
  const token = await createSessionJWT({ sub: "anon", scope: "app" }, 3600);
  return Response.json({ token, expiresIn: 3600 });
});

export const POST = withCORS(async (req) => {
  const body = await req.json().catch(() => ({}));
  const sub = body?.sub ?? "anon";
  const scope = body?.scope ?? "app";
  const ttl = Number(body?.ttl ?? 3600);
  const token = await createSessionJWT({ sub, scope }, ttl);
  return Response.json({ token, expiresIn: ttl });
});
