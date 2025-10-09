// app/api/firecrawl/search/route.ts
export const runtime = "nodejs";
export const maxDuration = 60; // enable cold-start headroom

import { NextRequest } from "next/server";
import {
  firecrawlSearchWithScrape,
  parseSaleFromMarkdown,
  computeStats,
  buildEbaySoldQuery,
} from "@/src/lib/firecrawl";

export async function POST(req: NextRequest) {
  const started = Date.now();

  try {
    if (!process.env.FIRECRAWL_API_KEY) {
      return new Response(JSON.stringify({ error: "Missing FIRECRAWL_API_KEY" }, null, 2), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({} as any));
    const {
      // Either supply a full text query...
      query: incomingQuery,
      // ...or we build it from these:
      title,
      issue,
      grade,
      site = "ebay.com",
      limit = Number(process.env.FIRECRAWL_SEARCH_LIMIT || 6),
    } = body || {};

    const query = (incomingQuery?.trim() || buildEbaySoldQuery({ title, issue, grade, site }));

    console.log('[Firecrawl Search v2] Query:', query, 'Limit:', limit);

    // v2: Single call gets search results WITH markdown
    const results = await firecrawlSearchWithScrape(query, limit);

    console.log('[Firecrawl Search v2] Got', results.length, 'results');

    // Parse sales from markdown
    const sales = results
      .filter(r => r.markdown)
      .map(r => parseSaleFromMarkdown(r.url, r.title, r.markdown!))
      .filter(s => s.price && s.price > 0);

    const stats = computeStats(sales);
    const failures = results
      .filter(r => !r.markdown)
      .map(r => ({ url: r.url, title: r.title, reason: "no-markdown" }));

    const response = {
      ok: true,
      took_ms: Date.now() - started,
      query,
      inputs: { title, issue, grade, site, limit },
      results_found: results.length,
      sales,
      stats,
      failures,
    };

    return new Response(JSON.stringify(response, null, 2), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err: any) {
    console.error('[Firecrawl Search v2] Error:', err);
    return new Response(
      JSON.stringify({ error: "FIRECRAWL_SEARCH_FAILED", detail: String(err?.message || err) }, null, 2),
      { status: 502, headers: { "content-type": "application/json" } }
    );
  }
}
