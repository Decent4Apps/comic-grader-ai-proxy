// app/api/pricing/firecrawl/route.ts
/* 
  ComicGraderAI — Firecrawl pricing endpoint
  - POST body: { title?: string; issue?: string | number; grade?: string; query?: string }
  - Builds an eBay sold-listings query, calls Firecrawl search, parses prices, returns stats + listings.
  - Requires: FIRECRAWL_API_KEY
*/

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

type Listing = {
  title: string;
  url: string;
  source?: string;
  dateText?: string;
  priceText?: string;
  price: number;
  grade?: string | null;
};

type PriceStats = {
  count: number;
  min: number;
  max: number;
  mean: number;
  median: number;
  p25: number;
  p75: number;
  stddev: number;
};

type FirecrawlSearchItem = {
  title?: string;
  url?: string;
  source?: string;
  snippet?: string;
};

type FirecrawlSearchResponse = {
  data?: FirecrawlSearchItem[];
};

function badRequest(detail: string, extra?: any) {
  return new Response(
    JSON.stringify({ error: "Bad request", detail, ...(extra || {}) }, null, 2),
    { status: 400, headers: { "content-type": "application/json" } }
  );
}

function serverError(detail: string, extra?: any) {
  return new Response(
    JSON.stringify({ error: "Server error", detail, ...(extra || {}) }, null, 2),
    { status: 500, headers: { "content-type": "application/json" } }
  );
}

function ok(payload: any, status = 200) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Build an eBay sold listings query. */
function buildQuery(params: { title?: string; issue?: string | number; grade?: string; query?: string }) {
  if (params.query && params.query.trim().length > 0) return params.query.trim();

  const parts: string[] = [];
  if (params.title) parts.push(params.title);
  if (params.issue) parts.push(`#${String(params.issue)}`);
  if (params.grade) parts.push(`CGC ${params.grade}`);
  // Focus on sold listings (eBay)
  parts.push(`site:ebay.com "sold"`);
  return parts.join(" ").trim();
}

/** Extract a numeric price from arbitrary strings like "$185.50", "USD 199", etc. */
function extractPrice(text?: string | null): number | null {
  if (!text) return null;
  // Remove commas, keep digits and dots
  const m = text.replace(/,/g, "").match(/(\$|USD)?\s*([0-9]+(?:\.[0-9]{1,2})?)/i);
  if (!m) return null;
  const n = Number(m[2]);
  return Number.isFinite(n) ? n : null;
}

/** Try to infer grade from text (very loose) */
function extractGrade(text?: string | null): string | null {
  if (!text) return null;
  const m = text.match(/\b(?:CGC\s*)?([0-9]\.[0-9])\b/i);
  return m ? m[1] : null;
}

/** Quantile helper */
function quantile(sorted: number[], q: number) {
  const n = sorted.length;
  if (n === 0) return 0;
  if (n === 1) return sorted[0];
  const pos = (n - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + (sorted[base + 1] - sorted[base]) * rest;
  }
  return sorted[base];
}

/** Compute stats from an array of prices (numbers). */
function computeStats(prices: number[]): PriceStats {
  const arr = (prices ?? []).filter((n) => Number.isFinite(n)) as number[];
  const count = arr.length;
  if (count === 0) {
    return { count: 0, min: 0, max: 0, mean: 0, median: 0, p25: 0, p75: 0, stddev: 0 };
  }

  const sorted = [...arr].sort((a, b) => a - b);
  const sum = sorted.reduce((s, n) => s + n, 0);
  const mean = sum / count;

  const variance =
    sorted.reduce((acc, n) => acc + Math.pow(n - mean, 2), 0) / (count > 1 ? count - 1 : 1);

  return {
    count,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean,
    median: quantile(sorted, 0.5),
    p25: quantile(sorted, 0.25),
    p75: quantile(sorted, 0.75),
    stddev: Math.sqrt(variance),
  };
}

/** Map Firecrawl result into our Listing shape; price is extracted from title/snippet heuristically. */
function mapToListing(item: FirecrawlSearchItem): Listing | null {
  const title = (item.title || "").trim();
  const url = (item.url || "").trim();
  const source = (item.source || "").trim();
  const snippet = (item.snippet || "").trim();

  if (!title || !url) return null;

  const priceFromTitle = extractPrice(title);
  const priceFromSnippet = extractPrice(snippet);
  const price = priceFromTitle ?? priceFromSnippet ?? null;

  if (price == null) return null; // skip items with no detectable price

  return {
    title,
    url,
    source,
    priceText: priceFromTitle != null ? title : snippet || undefined,
    price,
    grade: extractGrade(title) ?? extractGrade(snippet),
  };
}

/** Call Firecrawl search API */
async function firecrawlSearch(query: string, signal?: AbortSignal): Promise<Listing[]> {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) {
    throw new Error("Missing FIRECRAWL_API_KEY");
  }

  const res = await fetch("https://api.firecrawl.dev/v0/search", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      query,
      limit: 25,
      // You can tune sources; search tends to return web results we can parse
      // sources: ["web"],
    }),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Firecrawl search failed: ${res.status} ${res.statusText} ${text}`);
  }

  const json = (await res.json()) as FirecrawlSearchResponse;
  const items = (json.data ?? []).map(mapToListing).filter(Boolean) as Listing[];

  // Deduplicate by URL
  const seen = new Set<string>();
  const deduped: Listing[] = [];
  for (const it of items) {
    if (!seen.has(it.url)) {
      seen.add(it.url);
      deduped.push(it);
    }
  }
  return deduped;
}

export async function POST(req: Request) {
  const started = Date.now();

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return badRequest("Expected JSON body.");
  }

  const { title, issue, grade, query } = body ?? {};
  const q = buildQuery({ title, issue, grade, query });
  if (!q) return badRequest("Missing query/title/issue.");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const listings = await firecrawlSearch(q, controller.signal);

    // Filter obvious junk / outliers (optional)
    const cleaned = listings.filter((l) => l.price > 0 && l.price < 100000);

    // ✅ FIXED: computeStats now accepts number[]
    const stats = computeStats(cleaned.map((l) => l.price));

    clearTimeout(timeout);

    return ok({
      ok: true,
      took_ms: Date.now() - started,
      query: q,
      counts: {
        raw: listings.length,
        cleaned: cleaned.length,
      },
      stats,
      listings: cleaned,
    });
  } catch (err: any) {
    clearTimeout(timeout);
    return serverError(err?.message || String(err), {
      took_ms: Date.now() - started,
      query: q,
    });
  }
}

export async function GET() {
  // Lightweight health check for this route
  return ok({
    ok: true,
    route: "/api/pricing/firecrawl",
    requires: ["FIRECRAWL_API_KEY"],
    runtime,
  });
}
