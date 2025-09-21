import { withCORS } from "@/src/lib/cors";
import { verifySessionJWT } from "@/src/auth/tokens";
import { db } from "@/src/db/client";
import { analyses } from "@/src/db/schema";
import { desc, eq } from "drizzle-orm";

export const runtime = "nodejs";

async function getUserIdFromJWT(req: Request) {
  const auth = req.headers.get("authorization");
  const bypass = req.headers.get("x-bypass-token");

  if (process.env.NODE_ENV === "production") {
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) throw new Error("unauthorized");
    return await verifySessionJWT(token);
  }

  if (bypass && bypass === process.env.BYPASS_TOKEN) {
    return "dev-bypass"; // optional synthetic id; you may also reject writes here
  }

  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) throw new Error("unauthorized");
  return await verifySessionJWT(token);
}

export const GET = withCORS(async (req) => {
  try {
    const userId = await getUserIdFromJWT(req);
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
  try {
    const userId = await getUserIdFromJWT(req);
    const { id, imageUrl, payload } = await req.json();
    if (!payload) return Response.json({ error: "payload required" }, { status: 400 });

    const inserted = await db
      .insert(analyses)
      .values({ id, imageUrl, payload, userId })
      .returning();
    return Response.json({ item: inserted[0] });
  } catch {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
});
