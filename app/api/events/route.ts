import { withCORS } from "@/src/lib/cors";
import { db } from "@/src/db/client";
import { events } from "@/src/db/schema";
import { headers } from "next/headers";
import { verifySessionJWT } from "@/src/auth/tokens";

export const runtime = "nodejs";

export const POST = withCORS(async (req) => {
  const h = await headers();
  const auth = h.get("authorization");
  const bypass = h.get("x-bypass-token");

  let userId: string | null = null;
  if (bypass && bypass === process.env.BYPASS_TOKEN) {
    // dev allowed
  } else if (auth?.startsWith("Bearer ")) {
    try { userId = await verifySessionJWT(auth.slice(7)); } catch {}
  }

  const ip = h.get("x-forwarded-for") ?? "";
  const ua = h.get("user-agent") ?? "";

  const { name, props, platform = "mobile", appVersion, deviceId } = await req.json();
  if (!name) return Response.json({ error: "name required" }, { status: 400 });

  await db.insert(events).values({
    userId: userId as any,
    name,
    props: props ?? {},
    platform,
    appVersion,
    deviceId,
    ip,
    ua,
  });

  return Response.json({ ok: true });
});
