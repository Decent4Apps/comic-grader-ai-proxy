// app/api/auth/anon/route.ts
import { withCORS, preflight } from "../../_lib/cors";
import { createSessionJWT } from "@/src/auth/tokens";

export const runtime = "nodejs";

async function issue() {
  const token = await createSessionJWT({ sub: "anon" }, 3600);
  return new Response(JSON.stringify({ token, expiresIn: 3600 }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

export const GET = withCORS(issue);
export const POST = withCORS(issue);
export const OPTIONS = preflight;
