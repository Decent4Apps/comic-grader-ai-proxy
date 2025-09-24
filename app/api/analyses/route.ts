// app/api/analyses/route.ts
import { withCORS } from "../_lib/cors";
export const runtime = "nodejs";

// Disable this endpoint entirely to avoid DB/email deps during proxy-only builds.
const gone = () =>
  new Response(
    JSON.stringify({ error: "gone", message: "analyses endpoint disabled" }),
    { status: 410, headers: { "content-type": "application/json" } }
  );

export const GET = withCORS(async () => gone());
export const POST = withCORS(async () => gone());
