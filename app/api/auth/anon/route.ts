import { withCORS } from "@/src/lib/cors";
import { createSessionJWT } from "@/src/auth/tokens";

export const runtime = "nodejs";

// Optionally, add IP-based rate limiting or deviceId param checks here.
export const POST = withCORS(async (req) => {
  // You can accept { deviceId } from the app and log it if you want:
  // const { deviceId } = await req.json().catch(() => ({}));

  const anonId = `anon:${crypto.randomUUID()}`;
  // 24h tokens; tune as needed:
  const token = await createSessionJWT(anonId, 24);

  return Response.json({
    token,
    user: { id: anonId, kind: "anonymous" }
  });
});
