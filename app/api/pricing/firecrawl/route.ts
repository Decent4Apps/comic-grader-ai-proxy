// app/api/pricing/firecrawl/route.ts
export const runtime = "nodejs";
export const maxDuration = 60; // allow headroom on cold starts

import { NextRequest } from "next/server";
import {
  firecrawlSearch,
  firecrawlScrape,
  parseSaleFromMarkdown,
  computeStats,
  buildEbaySoldQuery,
  DEFAULT_SCRAPE_CONCURRENCY,
} from "@/src/lib/firecrawl";

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

// Simple concurrency pool to scrape in parallel without hammering the API
async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, idx: number) => Promise<R>
): Promise<R[]> {
  if (!items.length) return [];
  const results: R[] = new Array(items.length) as any;
  let i = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (i < items.length) {
      const idx = i++;
      try {
        results[idx] = await fn(items[idx], idx);
      } catch (err) {
        // @ts-ignore
        results[idx] = err;
      }
    }
  });
  await Promise.all(workers);
  return results;
}

type Body = {
  // optional direct query override
  query?: string;
  // structured fields for building an eBay sold search
  title?: string;
  issue?: string | number;
  grade?: string | number;
  site?: string; // defaults to ebay.com
  // tuning
  limit?: number; // number of search results to fetch (default env or 6)
  scrapeConcurrency?: number; // parallel scrapes (default env or 3)
};

export async function POST(req: NextRequest) {
  const started = Date.now();
  try {
    const body = (await req.json().catch(() => ({}))) as Partial<Body>;

    const {
      query: incomingQuery,
      title,
      issue,
      grade,
      site = "ebay.com",
      limit = Number(process.env.FIRECRAWL_SEARCH_LIMIT || 6),
      scrapeConcurrency = Number(process.env.FIRECRAWL_SCRAPE_CONCURRENCY || DEFAULT_SCRAPE_CONCURRENCY),
    } = body;

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
        return { ok: false as const, url: (r as any).url, title: (r as any).title, reason: String(err?.message || err) };
      }
    });

    const sales = scraped.filter((s: any) => s.ok).map((s: any) => s.parsed);
    const stats = computeStats(sales);

    const response = {
      ok: true,
      took_ms: Date.now() - started,
      query,
      limit,
      scrapeConcurrency,
      stats,
      sales,
      failures: scraped.filter((s: any) => !s.ok).map((s: any) => ({ url: s.url, title: s.title, reason: s.reason })),
    };

    return json(response, 200);
  } catch (err: any) {
    return json({ ok: false, error: "FIRECRAWL_PRICING_FAILED", detail: String(err?.message || err) }, 502);
  }
}

export async function GET() {
  const hasKey = !!process.env.FIRECRAWL_API_KEY;
  return json(
    {
      ok: hasKey,
      requires: ["FIRECRAWL_API_KEY"],
      endpoint: "/api/pricing/firecrawl",
      env: {
        FIRECRAWL_BASE_URL: process.env.FIRECRAWL_BASE_URL || "https://api.firecrawl.dev",
        FIRECRAWL_SEARCH_LIMIT: process.env.FIRECRAWL_SEARCH_LIMIT || "6",
        FIRECRAWL_SCRAPE_CONCURRENCY: process.env.FIRECRAWL_SCRAPE_CONCURRENCY || "3",
      },
      timestamp: new Date().toISOString(),
    },
    hasKey ? 200 : 500
  );
}

