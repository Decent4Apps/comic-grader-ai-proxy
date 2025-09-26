// app/api/pricing/firecrawl/route.ts
export const runtime = "nodejs";

type QueryInput = {
  title?: string;        // "Amazing Spider-Man"
  issue?: string | number; // "300"
  grade?: string;        // "CGC 9.8"
  rawQuery?: string;     // optional manual override
  maxResults?: number;   // default 10
  soldOnly?: boolean;    // default true
  country?: "US" | "UK" | "DE" | "AU"; // affects ebay domain
};

const FIRECRAWL_URL = "https://api.firecrawl.dev/v1";
const API_KEY = process.env.FIRECRAWL_API_KEY;

function ebayDomain(country?: QueryInput["country"]) {
  switch (country) {
    case "UK": return "ebay.co.uk";
    case "DE": return "ebay.de";
    case "AU": return "ebay.com.au";
    default:   return "ebay.com";
  }
}

// Build a SERP query that favors sold listings & CGC grades
function buildQuery(p: QueryInput) {
  if (p.rawQuery) return p.rawQuery;
  const bits = [
    p.title?.trim(),
    p.issue ? `#${p.issue}` : "",
    p.grade?.trim(),
    "site:ebay.com",
    p.soldOnly !== false ? "sold" : ""
  ].filter(Boolean);
  return bits.join(" ").replace(/\s+/g, " ");
}

// Attempt to coerce a USD value from strings like "$1,234.56" or "US $89.99"
function parsePrice(s?: string) {
  if (!s) return null;
  const m = s.replace(/[^\d.,-]/g, "").match(/[\d.,-]+/g);
  if (!m) return null;
  const num = Number(m[0].replace(/,/g, ""));
  return Number.isFinite(num) ? num : null;
}

// Simple robust median
function median(nums: number[]) {
  if (!nums.length) return null;
  const a = nums.slice().sort((x,y)=>x-y);
  const mid = Math.floor(a.length/2);
  return a.length % 2 ? a[mid] : (a[mid-1] + a[mid]) / 2;
}

export const POST = async (req: Request) => {
  try {
    if (!API_KEY) {
      return new Response(JSON.stringify({ error: "Missing FIRECRAWL_API_KEY" }), { status: 500 });
    }

    const body = (await req.json().catch(() => ({}))) as QueryInput;
    const query = buildQuery(body);
    const maxResults = Math.min(Math.max(body.maxResults ?? 10, 3), 25);
    const domain = ebayDomain(body.country);

    // 1) Firecrawl Search -> get top ebay links (optionally scrape summaries)
    const searchResp = await fetch(`${FIRECRAWL_URL}/search`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Authorization": `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        query: query.replace("site:ebay.com", `site:${domain}`),
        limit: maxResults,
        // Get plain SERP; we'll extract later for accuracy
        scrapeOptions: { formats: [] }
      }),
    });

    if (!searchResp.ok) {
      const err = await searchResp.text();
      return new Response(JSON.stringify({ error: "firecrawl_search_failed", details: err }), { status: 502 });
    }

    const searchData = await searchResp.json();
    const hits: Array<{ url: string; title?: string; description?: string }> =
      searchData?.data ?? searchData?.results ?? [];

    // Heuristic: keep only ebay item pages and SOLD/completed result pages
    const ebayUrls = (hits || [])
      .map(h => h.url)
      .filter(Boolean)
      .filter((u: string) => {
        if (!u.includes(domain)) return false;
        // prefer individual items and "sold" views
        return /itm\/|sch\/|bin\/|p\/|bhp\//.test(u) || /LH_Sold|LH_Complete|sold/.test(u);
      })
      .slice(0, maxResults);

    if (!ebayUrls.length) {
      return new Response(JSON.stringify({ ok: true, items: [], stats: null, query }), { status: 200 });
    }

    // 2) Firecrawl Extract -> structured data from listing pages
    // We describe what to pull with a JSON-Schema-ish prompt+schema
    const extractResp = await fetch(`${FIRECRAWL_URL}/extract`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Authorization": `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        urls: ebayUrls,
        // Tip: you can include enableWebSearch:true to let it supplement—but not necessary here
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
                  priceText: { type: "string" },     // e.g. 'US $1,234.56'
                  soldPriceText: { type: "string" }, // if present (sold/completed)
                  condition: { type: "string" },
                  dateText: { type: "string" },      // 'Aug 21, 2025' etc.
                },
                required: ["url", "title"]
              }
            }
          },
          required: ["items"]
        }
      }),
    });

    if (!extractResp.ok) {
      const err = await extractResp.text();
      return new Response(JSON.stringify({ error: "firecrawl_extract_failed", details: err }), { status: 502 });
    }

    const extractData = await extractResp.json();
    const rawItems: any[] = extractData?.data?.items || extractData?.items || [];

    // Normalize: choose soldPriceText when available, else priceText
    const normalized = rawItems.map(it => {
      const price = parsePrice(it.soldPriceText || it.priceText);
      return {
        url: it.url,
        title: it.title,
        condition: it.condition || null,
        dateText: it.dateText || null,
        price,
        _raw: it,
      };
    }).filter(x => Number.isFinite(x.price));

    const prices = normalized.map(x => x.price as number);
    const stats = {
      count: normalized.length,
      mean: prices.length ? (prices.reduce((a,b)=>a+b,0)/prices.length) : null,
      median: median(prices),
      min: prices.length ? Math.min(...prices) : null,
      max: prices.length ? Math.max(...prices) : null,
      sample: normalized.slice(0, 20)
    };

    return new Response(JSON.stringify({ ok: true, query, items: normalized, stats }), {
      status: 200,
      headers: { "content-type": "application/json", "cache-control": "no-store" }
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "server_error" }), { status: 500 });
  }
};

export const GET = async () =>
  new Response(JSON.stringify({ ok: true, message: "Firecrawl pricing endpoint ready" }), {
    status: 200, headers: { "content-type": "application/json" }
  });
