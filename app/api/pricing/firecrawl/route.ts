// app/api/pricing/firecrawl/route.ts
export const runtime = "nodejs";
export const maxDuration = 60;

import { withCORS, preflight } from "@/app/api/_lib/cors";
import {
  firecrawlSearch,
  firecrawlScrape,
  parseSaleFromMarkdown,
  computeStats,
  buildEbaySoldQuery,
  DEFAULT_SCRAPE_CONCURRENCY,
} from "@/src/lib/firecrawl";

// Lightweight concurrency pool (same pattern as /api/firecrawl/search)
async function scrapePool<T, R>(
  items: T[],
  worker: (item: T) => Promise<R>,
  limit = DEFAULT_SCRAPE_CONCURRENCY
): Promise<R[]> {
  const results: R[] = [];
  let i = 0;
  async function next(): Promise<void> {
    const index = i++;
    if (index >= items.length) return;
    results[index] = await worker(items[index]);
    return next();
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, next));
  return results;
}

export const OPTIONS = preflight;

export const POST = withCORS(async (req) => {
  const started = Date.now();
  try {
    const {
      title,
      issue,
      grade,
      maxResults = 12,
      site = "ebay.com",
      scrapeOptions,
    } = await req.json();

    if (!title || typeof title !== "string") {
      return new Response(
        JSON.stringify({ success: false, error: "Missing or invalid 'title'." }, null, 2),
        { status: 400, headers: { "content-type": "application/json" } }
      );
    }

    // Build an eBay solds query like: site:ebay.com "Spider-Man" "#1" "CGC 9.2" sold
    const query = buildEbaySoldQuery({ title, issue, grade, site });

    // 1) Search
    const search = await firecrawlSearch({
      query,
      limit: Math.max(1, Math.min(25, Number(maxResults) || 12)),
      sources: ["web"],
      tbs: undefined,
    });

    const web = (search?.data?.web ?? []).map((w: any) => ({
      title: w?.title || "",
      url: w?.url || "",
      description: w?.description || "",
      markdown: w?.markdown || "",
    }));

    if (!web.length) {
      return new Response(
        JSON.stringify(
          {
            success: true,
            query,
            count: 0,
            stats: { min: null, max: null, avg: null, median: null, currency: "USD" },
            listings: [],
            took_ms: Date.now() - started,
          },
          null,
          2
        ),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    // 2) Scrape each result for main content markdown
    const scraped = await scrapePool(
      web,
      async (item: any) => {
        try {
          const s = await firecrawlScrape({
            url: item.url,
            options: {
              formats: ["markdown"],
              onlyMainContent: true,
              maxAge: scrapeOptions?.maxAge ?? 172800000, // 48h cache
              blockAds: true,
              removeBase64Images: true,
              proxy: "auto",
              skipTlsVerification: true,
              storeInCache: true,
            },
          });
          const markdown = s?.data?.markdown || item.markdown || "";
          const parsed = parseSaleFromMarkdown(markdown, { fallbackTitle: item.title });
          return { ok: true, url: item.url, title: item.title, ...parsed };
        } catch (e: any) {
          return { ok: false, url: item.url, title: item.title, reason: e?.message || String(e) };
        }
      },
      DEFAULT_SCRAPE_CONCURRENCY
    );

    // 3) Normalize listings & compute stats
    const listings = scraped
      .filter((s: any) => s.ok && typeof s.price === "number" && s.price > 0)
      .map((s: any) => ({
        title: s.title,
        url: s.url,
        price: s.price,
        currency: s.currency ?? "USD",
        soldDate: s.soldDate ?? null,
        condition: s.condition ?? null,
        grade: s.grade ?? null,
        source: "ebay",
      }));

    const stats = computeStats(listings.map((l: any) => l.price));

    return new Response(
      JSON.stringify(
        {
          success: true,
          query,
          count: listings.length,
          stats, // { min, max, avg, median, currency }
          listings,
          failures: scraped.filter((s: any) => !s.ok).map((f: any) => ({
            url: f.url,
            title: f.title,
            reason: f.reason,
          })),
          took_ms: Date.now() - started,
        },
        null,
        2
      ),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify(
        { success: false, error: "FIRECRAWL_PRICING_FAILED", detail: String(err?.message || err) },
        null,
        2
      ),
      { status: 502, headers: { "content-type": "application/json" } }
    );
  }
});
