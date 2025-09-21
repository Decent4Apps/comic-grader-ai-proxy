import { withCORS } from "@/src/lib/cors";
import { createSessionJWT } from "@/src/auth/tokens";

export const runtime = "nodejs";

// POST /api/auth/anon  -> { token, user: { id, kind:"anonymous" } }
export const POST = withCORS(async () => {
  const anonId = `anon:${crypto.randomUUID()}`;
  // 24h token; adjust as you like
  const token = await createSessionJWT(anonId, 24);
  return Response.json({ token, user: { id: anonId, kind: "anonymous" } });
});
