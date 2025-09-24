// app/api/events/route.ts
import { withCORS } from "@/src/lib/cors"; // or "../_lib/cors" if that's where yours lives
export const runtime = "nodejs";

// Disable this endpoint for the proxy-only build (no DB/email deps)
const disabled = (message: string) =>
  new Response(JSON.stringify({ error: "not_implemented", message }), {
    status: 501,
    headers: { "content-type": "application/json" },
  });

export const GET = withCORS(async () => disabled("events endpoint disabled"));
export const POST = withCORS(async () => disabled("events endpoint disabled"));
