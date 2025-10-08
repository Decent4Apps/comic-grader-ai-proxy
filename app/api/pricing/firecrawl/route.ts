// app/api/pricing/firecrawl/route.ts
export const runtime = "nodejs";
export const maxDuration = 60;

import { withCORS, preflight } from "@/app/api/_lib/cors";
import {
  firecrawlSearch,          // (query: string) => Promise<SearchResult>
  firecrawlScrape,          // (url: string, options?: any) => Promise<ScrapeResult>
  parseSaleFromMarkdown,    // (md: string, { fallbackTitle?: string }) => { price?: number, soldDate?: string, grade?: string, condition?: string, currency?: string }
  computeStats,             // (nums: number[]) => { min, max, avg, median, currency }
  buildEbaySoldQuery,       // ({ title, issue, grade, site }) => string
  DEFAULT_SCRAPE_CONCURRENCY,
} from "@/src/lib/firecrawl";

type WebItem = {
  title: string;
  url: string;
  description: string;
  markdown: string;
};

type ScrapeResultOk = {
  ok: true;
  url: string;
  title: string;
  price?: number;
  currency?: string;
  soldDate?: string;
  grade?: string;
  condition?: string;
};

type ScrapeResultErr = {
  ok: false;
  url: string;
  title: string;
  reason: string;
};

type ScrapeResult = ScrapeResultOk | ScrapeResultErr;

// simple async pool with typing
async function scrapePool<T, R>(
  items: T[],
  worker: (item: T) => Promise<R>,
  limit = DEFAULT_SCRAPE_CONCURRENCY
): Promise<R[]> {
  const results: R[] = [];
  let i = 0;
  async function next(): Promise<void> {
    const idx = i++;
    if (idx >= items.length) return;
    results[idx] = await worker(items[idx]);
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

    // Build query: site:ebay.com "Spider-Man" "#1" "CGC 9.2" sold -lot -bundle -digital
    const query = buildEbaySoldQuery({ title, issue, grade, site });

    // 1) SEARCH — helper expects a string
    const limit = Math.max(1, Math.min(25, Number(maxResults) || 12));
    const search = await firecrawlSearch(query);

    // take up to `limit`
    const rawWeb = (search as any)?.data?.web ?? [];
    const web: WebItem[] = rawWeb.slice(0, limit).map((w: any) => ({
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

    // 2) SCRAPE — call with (url, options) and strongly type `item`
    const scraped = await scrapePool<WebItem, ScrapeResult>(
      web,
      async (item: WebItem): Promise<ScrapeResult> => {
        try {
          const s = await firecrawlScrape(item.url, {
            formats: ["markdown"],
            onlyMainContent: true,
            maxAge: (scrapeOptions?.maxAge as number | undefined) ?? 172800000, // 48h cache
            blockAds: true,
            removeBase64Images: true,
            proxy: "auto",
            skipTlsVerification: true,
            storeInCache: true,
          });

          const markdown = (s as any)?.data?.markdown || item.markdown || "";
          const parsed = parseSaleFromMarkdown(markdown, { fallbackTitle: item.title });

          return {
            ok: true,
            url: item.url,
            title: item.title,
            price: parsed.price,
            currency: parsed.currency,
            soldDate: parsed.soldDate,
            grade: parsed.grade,
            condition: parsed.condition,
          };
        } catch (e: any) {
          return {
            ok: false,
            url: item.url,
            title: item.title,
            reason: e?.message || String(e),
          };
        }
      },
      DEFAULT_SCRAPE_CONCURRENCY
    );

    // 3) NORMALIZE + STATS
    const listings = scraped
      .filter((s): s is ScrapeResultOk => (s as ScrapeResultOk).ok === true && typeof (s as ScrapeResultOk).price === "number" && (s as ScrapeResultOk).price! > 0)
      .map((s) => ({
        title: s.title,
        url: s.url,
        price: s.price!,
        currency: s.currency ?? "USD",
        soldDate: s.soldDate ?? null,
        condition: s.condition ?? null,
        grade: s.grade ?? null,
        source: "ebay",
      }));

    const stats = computeStats(listings.map((l) => l.price));

    return new Response(
      JSON.stringify(
        {
          success: true,
          query,
          count: listings.length,
          stats, // { min, max, avg, median, currency }
          listings,
          failures: scraped
            .filter((s): s is ScrapeResultErr => (s as ScrapeResultErr).ok === false)
            .map((f) => ({
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
