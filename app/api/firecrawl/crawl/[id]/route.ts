import { authorizePaidRequest, readPaidJson, boundAIInput } from "../../../../../lib/paid-security.mjs";
// app/api/firecrawl/crawl/[id]/route.ts
export const runtime = "nodejs";

const BASE = process.env.FIRECRAWL_BASE || "https://api.firecrawl.dev/v1";
const KEY = process.env.FIRECRAWL_API_KEY || "";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = await authorizePaidRequest(req); if (denied) return denied;
  if (!KEY) {
    return new Response(JSON.stringify({ error: "Missing FIRECRAWL_API_KEY" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { id } = await ctx.params;
  if (!id) {
    return new Response(JSON.stringify({ error: "Missing crawl id" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const r = await fetch(`${BASE}/crawl/${encodeURIComponent(id)}`, {
    headers: {
      Authorization: `Bearer ${KEY}`,
      "Accept-Encoding": "identity",
    },
  });

  const text = await r.text().catch(() => "");
  if (!r.ok) {
    return new Response(
      JSON.stringify({ error: "Firecrawl crawl status error", status: r.status, body: text }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }

  return new Response(text, {
    status: 200,
    headers: { "Content-Type": "application/json", "Content-Encoding": "identity" },
  });
}
