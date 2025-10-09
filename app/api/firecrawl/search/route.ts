// app/api/firecrawl/search/route.ts
export const runtime = "nodejs";
export const maxDuration = 60;

import { NextRequest } from "next/server";
import {
  searchWithScrape,
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
      query: incomingQuery,
      title,
      issue,
      grade,
      site = "ebay.com",
      limit = Number(process.env.FIRECRAWL_SEARCH_LIMIT || 6),
    } = body || {};

    const query = (incomingQuery?.trim() || buildEbaySoldQuery({ title, issue, grade, site }));

    console.log('[Firecrawl Search v2] Query:', query, 'Limit:', limit);

    // v2: Single call with scrapeOptions gets URLs + markdown
    const results = await searchWithScrape(query, limit);

    console.log('[Firecrawl Search v2] Got', results.length, 'results');

    // Parse sales from markdown
    const parsedSales = results.map(r => 
      parseSaleFromMarkdown(r.url, r.title, r.markdown)
    );

    const validSales = parsedSales.filter(s => s.price && s.price > 0);
    const stats = computeStats(validSales);

    const failures = results
      .map((r, idx) => ({
        url: r.url,
        title: r.title,
        hadMarkdown: !!r.markdown && r.markdown.length > 0,
        hadPrice: !!parsedSales[idx].price
      }))
      .filter(f => !f.hadMarkdown || !f.hadPrice)
      .map(f => ({
        url: f.url,
        title: f.title,
        reason: !f.hadMarkdown ? "no-markdown" : "no-price-found"
      }));

    const response = {
      ok: true,
      took_ms: Date.now() - started,
      query,
      inputs: { title, issue, grade, site, limit },
      results_found: results.length,
      sales: validSales,
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

