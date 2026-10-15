import { authorizePaidRequest, readPaidJson, boundAIInput } from "../../../../lib/paid-security.mjs";
// app/api/firecrawl/status/route.ts
export const runtime = "edge";

export async function GET(req: Request) {
  const denied = await authorizePaidRequest(req); if (denied) return denied;
  const ok = {
    FIRECRAWL_API_KEY: !!process.env.FIRECRAWL_API_KEY,
    FIRECRAWL_BASE_URL: process.env.FIRECRAWL_BASE_URL || "https://api.firecrawl.dev",
    FIRECRAWL_SEARCH_LIMIT: process.env.FIRECRAWL_SEARCH_LIMIT || "6",
    FIRECRAWL_SCRAPE_CONCURRENCY: process.env.FIRECRAWL_SCRAPE_CONCURRENCY || "3",
  };

  const missing = Object.entries(ok)
    .filter(([k, v]) => k === "FIRECRAWL_API_KEY" && v === false)
    .map(([k]) => k);

  const status = missing.length ? 500 : 200;

  return new Response(JSON.stringify({ status, ok, missing }, null, 2), {
    status,
    headers: { "content-type": "application/json" },
  });
}
