// app/api/pricing/firecrawl/route.ts
export const runtime = "nodejs";

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
const API_KEY = process.env.FIRECRAWL_API_KEY;

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
const median = (ns: number[]) => ns.length ? (ns.slice().sort((a,b)=>a-b)[Math.floor((ns.length-1)/2)] + ns.slice().sort((a,b)=>a-b)[Math.ceil((ns.length-1)/2)]) / 2 : null;

async function firecrawl(path: string, payload: any) {
  const res = await fetch(`${FIRECRAWL_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "Authorization": `Bearer ${API_KEY}` },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const t = await res.text();
    return { ok: false as const, status: res.status, text: t };
  }
  return { ok: true as const, json: await res.json() };
}

export const POST = async (req: Request) => {
  try {
    if (!API_KEY) {
      return new Response(JSON.stringify({ error: "Missing FIRECRAWL_API_KEY" }), { status: 500 });
    }
    const body = (await req.json().catch(() => ({}))) as QueryInput;

    const query = buildQuery(body);
    const domain = ebayDomain(body.country);
    const limit = Math.min(Math.max(body.maxResults ?? DEFAULT_RESULTS, 3), MAX_RESULTS);

    // 1) Search (small payload)
    const search = await firecrawl("/search", {
      query: query.replace("site:ebay.com", `site:${domain}`),
      limit,
      scrapeOptions: { formats: [] }, // SERP only
    });
    if (!search.ok) {
      // If Firecrawl says 413 here, your query/limit were too big for their side
      return new Response(JSON.stringify({ error: "firecrawl_search_failed", code: search.status, details: search.text }), { status: 502 });
    }
    const hits: Array<{ url: string }> = (search.json as any)?.data ?? (search.json as any)?.results ?? [];
    const ebayUrls = (hits || [])
      .map(h => h.url)
      .filter(Boolean)
      .filter(u => u.includes(domain) && (/itm\/|sch\/|p\//.test(u) || /LH_Sold|LH_Complete|sold/i.test(u)))
      .slice(0, limit);

    if (!ebayUrls.length) {
      return new Response(JSON.stringify({ ok: true, query, items: [], stats: null }), { status: 200 });
    }

    // 2) Extract in CHUNKS to avoid large request bodies to Firecrawl
    const chunkSize = Math.min(Math.max(body.chunkSize ?? DEFAULT_CHUNK, 1), MAX_CHUNK);
    const chunks: string[][] = [];
    for (let i = 0; i < ebayUrls.length; i += chunkSize) chunks.push(ebayUrls.slice(i, i + chunkSize));

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
        // If Firecrawl returns 413 here, the individual chunk was still too big -> halve chunkSize
        return new Response(JSON.stringify({ error: "firecrawl_extract_failed", code: extract.status, details: extract.text }), { status: 502 });
      }
      const data = (extract.json as any)?.data?.items ?? (extract.json as any)?.items ?? [];
      allExtracted.push(...data);
    }

    const normalized = allExtracted.map((it) => {
      const price = parsePrice(it.soldPriceText || it.priceText);
      return price ? { url: it.url, title: it.title, condition: it.condition || null, dateText: it.dateText || null, price, _raw: undefined } : null;
    }).filter(Boolean) as Array<{url:string;title:string;condition:string|null;dateText:string|null;price:number}>;

    const prices = normalized.map(x => x.price);
    const stats = {
      count: normalized.length,
      mean: prices.length ? prices.reduce((a,b)=>a+b,0)/prices.length : null,
      median: median(prices),
      min: prices.length ? Math.min(...prices) : null,
      max: prices.length ? Math.max(...prices) : null,
    };

    // **Keep the response small** (avoid 4.5MB response cap on Vercel)
    const page = Math.max(body.page ?? 1, 1);
    const pageSize = Math.min(Math.max(body.pageSize ?? DEFAULT_PAGE_SIZE, 5), 100);
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    const itemsPage = body.statsOnly ? [] : normalized.slice(start, end);

    return new Response(JSON.stringify({
      ok: true, query,
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
