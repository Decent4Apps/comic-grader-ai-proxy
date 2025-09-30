// app/api/pricing/firecrawl/route.ts
export const runtime = "nodejs";

import { createGuard } from "superagent-ai";

type QueryInput = {
  title?: string;
  issue?: string | number;
  grade?: string;
  rawQuery?: string;
  maxResults?: number;   // total URLs to consider from search
  soldOnly?: boolean;    // default true
  country?: "US" | "UK" | "DE" | "AU";
  page?: number;         // 1-based page for returned items
  pageSize?: number;     // how many items to include in response
  chunkSize?: number;    // how many URLs per /extract call
  statsOnly?: boolean;   // return only stats, no items
};

const FIRECRAWL_URL = "https://api.firecrawl.dev/v1";
const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;
const SUPERAGENT_API_KEY = process.env.SUPERAGENT_API_KEY;

// Safety caps
const MAX_QUERY_LEN = 240;
const MAX_RESULTS = 25;          // limit search hits pulled
const DEFAULT_RESULTS = 12;
const DEFAULT_CHUNK = 5;         // urls per extract call
const MAX_CHUNK = 10;
const DEFAULT_PAGE_SIZE = 40;    // cap returned items to avoid >4.5MB responses

function ebayDomain(c?: QueryInput["country"]) {
  switch (c) {
    case "UK": return "ebay.co.uk";
    case "DE": return "ebay.de";
    case "AU": return "ebay.com.au";
    default:   return "ebay.com";
  }
}

function buildQuery(p: QueryInput) {
  if (p.rawQuery?.trim()) return p.rawQuery.trim().slice(0, MAX_QUERY_LEN);
  const bits = [
    p.title?.trim(),
    p.issue ? `#${p.issue}` : "",
    p.grade?.trim(),
    "site:ebay.com",
    p.soldOnly !== false ? "sold" : "",
  ].filter(Boolean);
  return bits.join(" ").replace(/\s+/g, " ").slice(0, MAX_QUERY_LEN);
}

function parsePrice(s?: string) {
  if (!s) return null;
  const m = s.replace(/[^\d.,-]/g, "").match(/[\d.,-]+/g);
  if (!m) return null;
  const num = Number(m[0].replace(/,/g, ""));
  return Number.isFinite(num) ? num : null;
}
const median = (ns: number[]) =>
  ns.length
    ? (ns.slice().sort((a, b) => a - b)[Math.floor((ns.length - 1) / 2)])
    : null;

async function firecrawl(path: string, payload: any) {
  const res = await fetch(`${FIRECRAWL_URL}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Authorization": `Bearer ${FIRECRAWL_API_KEY}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const t = await res.text();
    return { ok: false as const, status: res.status, text: t };
  }
  const json = await res.json().catch(() => ({}));
  return { ok: true as const, status: res.status, json };
}

function safeNumber(n: any, min: number, max: number, def: number) {
  const v = Number.isFinite(Number(n)) ? Number(n) : def;
  return Math.min(Math.max(v, min), max);
}

// ---------- SUPERAGENT GUARD ----------
const guard = SUPERAGENT_API_KEY
  ? createGuard({ apiKey: SUPERAGENT_API_KEY! })
  : null;

// If guard is present, vet arbitrary text.
async function guardText(text: string): Promise<{ allowed: boolean; reason?: string }> {
  if (!guard) return { allowed: true };
  try {
    const res = await guard(text);
    return res.rejected ? { allowed: false, reason: res.reasoning } : { allowed: true };
  } catch (e: any) {
    // Fail-closed for FETCH, fail-open for benign text. We’ll handle policy below.
    return { allowed: false, reason: e?.message || "Guard error" };
  }
}

// Guard a URL fetch request per docs (prefix with FETCH:)
async function guardFetch(url: string): Promise<{ allowed: boolean; reason?: string }> {
  if (!guard) return { allowed: true };
  try {
    const res = await guard(`FETCH: ${url}`);
    return res.rejected ? { allowed: false, reason: res.reasoning } : { allowed: true };
  } catch (e: any) {
    return { allowed: false, reason: e?.message || "Guard error" };
  }
}

// ---------- ROUTES ----------
export const POST = async (req: Request) => {
  try {
    if (!FIRECRAWL_API_KEY) {
      return new Response(JSON.stringify({ error: "Missing FIRECRAWL_API_KEY" }), { status: 500 });
    }
    const body = (await req.json().catch(() => ({}))) as QueryInput;

    const query = buildQuery(body);

    // 0) Pre-guard the user request/query (blocks prompt-injection / unsafe patterns early)
    if (guard) {
      const pre = await guardText(query);
      if (!pre.allowed) {
        return new Response(JSON.stringify({
          ok: false,
          error: "blocked_query",
          reason: pre.reason || "Query rejected by Guard",
        }), { status: 400, headers: { "content-type": "application/json" } });
      }
    }

    const domain = ebayDomain(body.country);
    const limit = safeNumber(body.maxResults, 3, MAX_RESULTS, DEFAULT_RESULTS);

    // 1) Firecrawl Search (small payload)
    const search = await firecrawl("/search", {
      query: query.replace("site:ebay.com", `site:${domain}`),
      limit,
      scrapeOptions: { formats: [] }, // SERP only
    });
    if (!search.ok) {
      return new Response(JSON.stringify({
        error: "firecrawl_search_failed",
        code: search.status,
        details: search.text,
      }), { status: 502 });
    }

    // Pull URLs from search results
    const hits: any[] =
      (search.json as any)?.data?.results ??
      (search.json as any)?.results ??
      [];

    const ebayUrls: string[] = hits
      .map((h: any) => (h?.url || h?.link || "").toString())
      .filter((u: string) => u && /ebay\./i.test(u));

    // 2) Guard each URL before requesting extraction (FETCH policy)
    let vettedUrls: string[] = ebayUrls;
    if (guard) {
      const results = await Promise.all(ebayUrls.map(async (u) => ({ u, g: await guardFetch(u) })));
      vettedUrls = results
        .filter(({ g }) => g.allowed)
        .map(({ u }) => u);

      // If everything got blocked, return a polite error
      if (!vettedUrls.length) {
        return new Response(JSON.stringify({
          ok: false,
          error: "blocked_all_urls",
          reason: "All candidate URLs were rejected by Guard",
        }), { status: 400, headers: { "content-type": "application/json" } });
      }
    }

    // 3) Extract in chunks
    const chunkSize = safeNumber(body.chunkSize, 1, MAX_CHUNK, DEFAULT_CHUNK);
    const chunks: string[][] = [];
    for (let i = 0; i < vettedUrls.length; i += chunkSize) chunks.push(vettedUrls.slice(i, i + chunkSize));

    const allExtracted: any[] = [];
    for (const urls of chunks) {
      const extract = await firecrawl("/extract", {
        urls,
        prompt: "Extract eBay listing info. Prefer SOLD/CLOSED prices if present.",
        schema: {
          type: "object",
          properties: {
            items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  url: { type: "string" },
                  title: { type: "string" },
                  priceText: { type: "string" },
                  soldPriceText: { type: "string" },
                  condition: { type: "string" },
                  dateText: { type: "string" },
                },
                required: ["url", "title"]
              }
            }
          },
          required: ["items"]
        },
      });

      if (!extract.ok) {
        return new Response(JSON.stringify({
          error: "firecrawl_extract_failed",
          code: extract.status,
          details: extract.text,
        }), { status: 502 });
      }

      const data =
        (extract.json as any)?.data?.items ??
        (extract.json as any)?.items ??
        [];

      // Optional: light content screening on extracted text (titles) before returning
      if (guard && data?.length) {
        const screened: any[] = [];
        for (const it of data) {
          const title = (it?.title || "").toString().slice(0, 8000);
          if (!title) continue;
          const check = await guardText(title);
          if (check.allowed) screened.push(it);
          // silently drop rejected items
        }
        allExtracted.push(...screened);
      } else {
        allExtracted.push(...data);
      }
    }

    // 4) Normalize to your shape
    const normalized = allExtracted.map((it) => {
      const price = parsePrice(it.soldPriceText || it.priceText);
      return price
        ? {
            url: it.url,
            title: it.title,
            condition: it.condition || null,
            dateText: it.dateText || null,
            price,
            _raw: undefined,
          }
        : null;
    }).filter(Boolean) as Array<{
      url: string; title: string; condition: string | null; dateText: string | null; price: number;
    }>;

    // 5) Stats
    const prices = normalized.map((n) => n.price).filter((n) => Number.isFinite(n));
    const stats = {
      count: prices.length,
      min: prices.length ? Math.min(...prices) : null,
      max: prices.length ? Math.max(...prices) : null,
      median: median(prices),
      mean: prices.length ? Math.round((prices.reduce((a, b) => a + b, 0) / prices.length) * 100) / 100 : null,
    };

    // 6) Pagination
    const page = safeNumber(body.page, 1, 9999, 1);
    const pageSize = safeNumber(body.pageSize, 5, 100, DEFAULT_PAGE_SIZE);
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    const itemsPage = body.statsOnly ? [] : normalized.slice(start, end);

    return new Response(JSON.stringify({
      ok: true,
      query,
      stats,
      page, pageSize, total: normalized.length,
      items: itemsPage,
    }), { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "server_error" }), { status: 500 });
  }
};

export const GET = async () =>
  new Response(JSON.stringify({ ok: true, message: "Firecrawl pricing endpoint ready" }), {
    status: 200, headers: { "content-type": "application/json" }
  });
