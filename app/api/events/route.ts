import { withCORS } from "@/src/lib/cors";
import { db } from "@/src/db/client";
import { events } from "@/src/db/schema";
import { headers } from "next/headers";
import { verifySessionJWT } from "@/src/auth/tokens";

export const runtime = "nodejs";

const isProd = process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";

async function maybeUserId(req: Request) {
  const h = await headers();
  const auth = h.get("authorization");
  const bypass = h.get("x-bypass-token");

  if (isProd) {
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) return null;
    try { return await verifySessionJWT(token); } catch { return null; }
  }

  if (bypass && bypass === process.env.BYPASS_TOKEN) return "dev-bypass";

  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;
  try { return await verifySessionJWT(token); } catch { return null; }
}

export const POST = withCORS(async (req) => {
  const h = await headers();
  const ip = h.get("x-forwarded-for") ?? "";
  const ua = h.get("user-agent") ?? "";

  const userId = await maybeUserId(req);

  const { name, props, platform = "mobile", appVersion, deviceId } = await req.json();
  if (!name) return Response.json({ error: "name required" }, { status: 400 });

  await db.insert(events).values({
    userId: (userId ?? undefined) as any,
    name,
    props: props ?? {},
    platform,
    appVersion,
    deviceId,
    ip,
    ua
  });

  return Response.json({ ok: true });
});
