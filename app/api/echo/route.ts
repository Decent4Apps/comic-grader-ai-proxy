// app/api/echo/route.ts
import { withCORS } from "../_lib/cors";
export const runtime = "nodejs";

export const POST = withCORS(async (req) => {
  const headers = Object.fromEntries(req.headers);
  let body: any = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  return new Response(JSON.stringify({ ok: true, headers, body }), {
    headers: { "content-type": "application/json" },
  });
});
