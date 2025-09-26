// app/api/auth/anon/route.ts
import { withCORS } from "../../_lib/cors";
import { createSessionJWT } from "@/src/auth/tokens";

export const runtime = "nodejs";

export const GET = withCORS(async () => {
  const token = await createSessionJWT({ sub: "anon" }, 3600);
  return new Response(JSON.stringify({ token, expiresIn: 3600 }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});
