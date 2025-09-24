// app/api/auth/anon/route.ts
import { withCORS } from "../../_lib/cors";
import { createSessionJWT } from "@/src/auth/tokens";

export const runtime = "nodejs";

/** GET → 1h anon token. POST { sub?, scope?, ttl? } to customize */
export const GET = withCORS(async () => {
  const token = await createSessionJWT({ sub: "anon", scope: "app" }, 3600);
  return Response.json({ token, expiresIn: 3600 });
});

export const POST = withCORS(async (req) => {
  const body = await req.json().catch(() => ({}));
  const sub = body?.sub ?? "anon";
  const scope = body?.scope ?? "app";
  const ttl = Math.max(60, Math.min(24 * 3600, Number(body?.ttl ?? 3600)));
  const token = await createSessionJWT({ sub, scope }, ttl);
  return Response.json({ token, expiresIn: ttl });
});
