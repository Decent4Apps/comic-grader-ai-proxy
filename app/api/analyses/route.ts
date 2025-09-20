import { withCORS } from "@/src/lib/cors";
import { verifySessionJWT } from "@/src/auth/tokens";
import { db } from "@/src/db/client";
import { analyses } from "@/src/db/schema";
import { desc, eq } from "drizzle-orm";

export const runtime = "nodejs";

export const GET = withCORS(async (req) => {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return Response.json({ error: "unauthorized" }, { status: 401 });
  const userId = await verifySessionJWT(auth.slice(7));
  const rows = await db.select().from(analyses).where(eq(analyses.userId, userId)).orderBy(desc(analyses.createdAt)).limit(100);
  return Response.json({ items: rows });
});

export const POST = withCORS(async (req) => {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return Response.json({ error: "unauthorized" }, { status: 401 });
  const userId = await verifySessionJWT(auth.slice(7));

  const { id, imageUrl, payload } = await req.json();
  if (!payload) return Response.json({ error: "payload required" }, { status: 400 });

  const inserted = await db.insert(analyses).values({ id, imageUrl, payload, userId }).returning();
  return Response.json({ item: inserted[0] });
});
