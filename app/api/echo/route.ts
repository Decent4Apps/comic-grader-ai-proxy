// app/api/echo/route.ts
// If your CORS helper lives at src/lib/cors, change the import to "@/src/lib/cors"
import { withCORS } from "../_lib/cors";
export const runtime = "nodejs";

// Build a plain object from Headers without relying on iterator typing
function headersToObject(h: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  h.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

export const GET = withCORS(async () => {
  return new Response(JSON.stringify({ ok: true, ts: new Date().toISOString() }), {
    headers: { "content-type": "application/json" },
  });
});

export const POST = withCORS(async (req) => {
  const headers = headersToObject(req.headers);
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  return new Response(JSON.stringify({ ok: true, headers, body }), {
    headers: { "content-type": "application/json" },
  });
});
