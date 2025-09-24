// app/api/pricing/firecrawl/route.ts
import { withCORS } from "../../_lib/cors";
export const runtime = "nodejs";

export const POST = withCORS(async () =>
  new Response(
    JSON.stringify({ error: "not_implemented", message: "pricing/firecrawl disabled" }),
    { status: 501, headers: { "content-type": "application/json" } }
  )
);

export const GET = withCORS(async () =>
  new Response(
    JSON.stringify({ error: "not_implemented", message: "pricing/firecrawl disabled" }),
    { status: 501, headers: { "content-type": "application/json" } }
  )
);
