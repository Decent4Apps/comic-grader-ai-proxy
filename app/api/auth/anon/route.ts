import { withCORS } from "@/src/lib/cors";
import { createSessionJWT } from "@/src/auth/tokens";

export const runtime = "nodejs";

export const POST = withCORS(async () => {
  const anonId = `anon:${crypto.randomUUID()}`;
  const token = await createSessionJWT(anonId, 24); // 24h
  return Response.json({ token, user: { id: anonId, kind: "anonymous" } });
});
