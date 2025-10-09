// app/api/pricing/firecrawl/route.ts
export const runtime = "nodejs";
export const maxDuration = 60;

import { NextRequest } from "next/server";
import {
  firecrawlSearchWithScrape,
  parseSaleFromMarkdown,
  computeStats,
  buildEbaySoldQuery,
} from "@/src/lib/firecrawl";

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export async function POST(req: NextRequest) {
  const started = Date.now();
  
  try {
    const body = await req.json().catch(() => ({}));
    const {
      query: incomingQuery,
      title,
      issue,
      grade,
      site = "ebay.com",
      limit = Number(process.env.FIRECRAWL_SEARCH_LIMIT || 6),
    } = body;

    const query = incomingQuery?.trim() || buildEbaySoldQuery({ title, issue, grade, site });

    console.log('[Pricing v2] Searching:', { query, limit });

    // v2: Single call gets URLs + markdown content
    const results = await firecrawlSearchWithScrape(query, limit);

    console.log('[Pricing v2] Got', results.length, 'results');

    // Parse sales from markdown
    const sales = results
      .filter(r => r.markdown)
      .map(r => parseSaleFromMarkdown(r.url, r.title, r.markdown!))
      .filter(s => s.price && s.price > 0);

    const stats = computeStats(sales);
    const failures = results
      .filter(r => !r.markdown)
      .map(r => ({ url: r.url, title: r.title, reason: "no-markdown" }));

    console.log('[Pricing v2] Parsed', sales.length, 'valid sales');

    const response = {
      ok: true,
      took_ms: Date.now() - started,
      query,
      limit,
      stats,
      sales,
      failures,
    };

    return json(response, 200);
    
  } catch (err: any) {
    console.error('[Pricing v2] Error:', err);
    return json(
      { 
        ok: false, 
        error: "FIRECRAWL_PRICING_FAILED", 
        detail: String(err?.message || err),
        took_ms: Date.now() - started
      },
      502
    );
  }
}

export async function GET() {
  const hasKey = !!process.env.FIRECRAWL_API_KEY;
  return json(
    {
      ok: hasKey,
      version: "v2",
      requires: ["FIRECRAWL_API_KEY"],
      endpoint: "/api/pricing/firecrawl",
      env: {
        FIRECRAWL_SEARCH_LIMIT: process.env.FIRECRAWL_SEARCH_LIMIT || "6",
      },
      timestamp: new Date().toISOString(),
    },
    hasKey ? 200 : 500
  );
}
