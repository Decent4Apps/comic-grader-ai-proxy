import { withCORS } from "@/src/lib/cors";
import { verifySessionJWT } from "@/src/auth/tokens";
import { db } from "@/src/db/client";
import { analyses } from "@/src/db/schema";
import { desc, eq } from "drizzle-orm";

export const runtime = "nodejs";

const isProd = process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";

async function requireAuthOrAnon(req: Request) {
  const auth = req.headers.get("authorization");
  const bypass = req.headers.get("x-bypass-token");

  if (isProd) {
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) return Response.json({ error: "unauthorized" }, { status: 401 });
    await verifySessionJWT(token).catch(() => { throw new Error("unauthorized"); });
    return;
  }

  if (bypass && bypass === process.env.BYPASS_TOKEN) return;
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return Response.json({ error: "unauthorized" }, { status: 401 });
  await verifySessionJWT(token).catch(() => { throw new Error("unauthorized"); });
}

async function getUserId(req: Request) {
  const auth = req.headers.get("authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) throw new Error("unauthorized");
  return await verifySessionJWT(token);
}

export const GET = withCORS(async (req) => {
  const gate = await requireAuthOrAnon(req);
  if (gate) return gate;
  try {
    const userId = await getUserId(req);
    const rows = await db
      .select()
      .from(analyses)
      .where(eq(analyses.userId, userId))
      .orderBy(desc(analyses.createdAt))
      .limit(100);
    return Response.json({ items: rows });
  } catch {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
});

export const POST = withCORS(async (req) => {
  const gate = await requireAuthOrAnon(req);
  if (gate) return gate;
  try {
    const userId = await getUserId(req);
    const { id, imageUrl, payload } = await req.json();
    if (!payload) return Response.json({ error: "payload required" }, { status: 400 });
    const inserted = await db.insert(analyses).values({ id, imageUrl, payload, userId }).returning();
    return Response.json({ item: inserted[0] });
  } catch {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
});
