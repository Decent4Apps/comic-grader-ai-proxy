import { authorizePaidRequest, readPaidJson, boundAIInput } from "../../../../lib/paid-security.mjs";
// app/api/pricing/firecrawl/route.ts
export const runtime = "nodejs";
export const maxDuration = 60;

import { NextRequest } from "next/server";
import {
  searchWithScrape,
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
  const denied = await authorizePaidRequest(req); if (denied) return denied;
  const started = Date.now();
  
  try {
    const body = await readPaidJson(req).catch(() => ({}));
    const {
      query: incomingQuery,
      title,
      issue,
      grade,
      site = "ebay.com",
      limit = Number(process.env.FIRECRAWL_SEARCH_LIMIT || 6),
    } = body;

    const query = incomingQuery?.trim() || buildEbaySoldQuery({ title, issue, grade, site });

    console.log('[Pricing v2] Starting search:', { query, limit });

    // v2: ONE call gets URLs + markdown
    const results = await searchWithScrape(query, Math.min(25, Math.max(1, Number(limit) || 6)));

    console.log('[Pricing v2] Got', results.length, 'results from Firecrawl');

    // Parse sales from the markdown that's already in results
    const parsedSales = results.map(r => 
      parseSaleFromMarkdown(r.url, r.title, r.markdown)
    );

    // Filter to only valid sales with prices
    const validSales = parsedSales.filter(s => s.price && s.price > 0);
    
    console.log('[Pricing v2] Parsed', validSales.length, 'valid sales from', results.length, 'results');

    const stats = computeStats(validSales);

    // Track which results had no markdown or no price
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
      limit,
      stats,
      sales: validSales,
      failures,
    };

    console.log('[Pricing v2] Returning:', {
      sales: validSales.length,
      failures: failures.length,
      avgPrice: stats.avg
    });

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

export async function GET(req: Request) {
  const denied = await authorizePaidRequest(req); if (denied) return denied;
  const hasKey = !!process.env.FIRECRAWL_API_KEY;
  return json(
    {
      ok: hasKey,
      version: "v2",
      apiVersion: "search with scrapeOptions (v2 pattern)",
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

