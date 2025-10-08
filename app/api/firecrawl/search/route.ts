// app/api/firecrawl/search/route.ts
export const runtime = "nodejs";
export const maxDuration = 60; // enable cold-start headroom


import { NextRequest } from "next/server";
import {
  firecrawlSearch,
  firecrawlScrape,
  parseSaleFromMarkdown,
  computeStats,
  buildEbaySoldQuery,
  DEFAULT_SCRAPE_CONCURRENCY,
} from "@/src/lib/firecrawl";

// Simple concurrency pool (avoid hammering Firecrawl and speed up batch)
async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, idx: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length) as any;
  let i = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

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
      scrapeConcurrency = Number(process.env.FIRECRAWL_SCRAPE_CONCURRENCY || DEFAULT_SCRAPE_CONCURRENCY),
    } = body || {};

    const query = (incomingQuery?.trim() || buildEbaySoldQuery({ title, issue, grade, site }));

    // 1) Search
    const results = await firecrawlSearch(query, limit);

    // 2) Scrape + parse (concurrently)
    const scraped = await mapPool(results, Math.max(1, scrapeConcurrency), async (r) => {
      try {
        const { markdown } = await firecrawlScrape(r.url);
        if (!markdown) {
          return { ok: false as const, url: r.url, title: r.title, reason: "no-markdown" };
        }
        const parsed = parseSaleFromMarkdown(r.url, r.title, markdown);
        return { ok: true as const, parsed };
      } catch (err: any) {
        return { ok: false as const, url: r.url, title: r.title, reason: String(err?.message || err) };
      }
    });

    const sales = scraped.filter((s) => s.ok).map((s: any) => s.parsed);
    const stats = computeStats(sales);

    const response = {
      ok: true,
      took_ms: Date.now() - started,
      query,
      inputs: { title, issue, grade, site, limit, scrapeConcurrency },
      results_found: results.length,
      sales,     // [{ url, title, price, currency, gradeDetected, dateText }]
      stats,     // { count, avg, median, min, max, currency }
      failures: scraped.filter((s) => !s.ok).map((s: any) => ({ url: s.url, title: s.title, reason: s.reason })),
    };

    return new Response(JSON.stringify(response, null, 2), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: "FIRECRAWL_SEARCH_FAILED", detail: String(err?.message || err) }, null, 2),
      { status: 502, headers: { "content-type": "application/json" } }
    );
  }
}
