// app/api/analyses/route.ts
import { withCORS } from "../_lib/cors";
export const runtime = "nodejs";

export const GET = withCORS(async () =>
  new Response(JSON.stringify({ ok: true, items: [] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
);

export const POST = withCORS(async () =>
  new Response(JSON.stringify({ ok: true, id: null }), {
    status: 202,
    headers: { "content-type": "application/json" },
  })
);
