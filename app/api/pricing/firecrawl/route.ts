// app/api/pricing/firecrawl/route.ts
import { withCORS } from "../../_lib/cors";
import crypto from "node:crypto";

export const runtime = "nodejs";

/**
 * Env required:
 * - FIRECRAWL_API_KEY  (string)
 * - DATABASE_URL       (Neon postgres URL)
 * Optional:
 * - FIRECRAWL_BASE_URL (default https://api.firecrawl.dev)
 * - PRICING_TTL_SEC    (default 21600 = 6h)
 */

type ReqBody =
  | { query: string; ttlSeconds?: number }
  | {
      title?: string;
      issue?: string | number;
      publisher?: string;
      year?: string | number;
      ttlSeconds?: number;
    };

type PriceResult = {
  averagePrice: number | null;
  sampleSize: number;
  marketTrend: "up" | "down" | "stable" | null;
  lastUpdated: string;
  query: string;
  raw: any;
};

const FIRECRAWL = process.env.FIRECRAWL_BASE_URL?.replace(/\/+$/, "") || "https://api.firecrawl.dev";
const DEFAULT_TTL = Math.max(300, Number(process.env.PRICING_TTL_SEC || 21600)); // 5m–6h+

// Lazy import to avoid cold-start cost unless used
async function getSql() {
  const { neon } = await import("@neondatabase/serverless");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Missing DATABASE_URL");
  return neon(url);
}

function normalizeQuery(b: ReqBody): string {
  if ("query" in b && b.query) return String(b.query).trim();
  const parts: string[] = [];
  if ("title" in b && b.title) parts.push(String(b.title));
  if ("issue" in b && b.issue) parts.push(`#${b.issue}`);
  if ("publisher" in b && b.publisher) parts.push(`(${b.publisher})`);
  if ("year" in b && b.year) parts.push(String(b.year));
  const q = parts.join(" ").trim();
  if (!q) throw new Error("missing query");
  return q;
}

function cacheKey(q: string): string {
  return "firecrawl:" + crypto.createHash("sha1").update(q.toLowerCase()).digest("hex");
}

// Very light heuristic: pull $ amounts from titles/snippets and average them.
function extractAveragePrice(results: any[]): { avg: number | null; count: number } {
  const dollars: number[] = [];
  const rx = /\$([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)/g;
  for (const r of results || []) {
    const text = `${r?.title ?? ""} ${r?.snippet ?? r?.description ?? ""}`;
    if (!text) continue;
    let m;
    while ((m = rx.exec(text))) {
      const n = Number(m[1].replace(/,/g, ""));
      if (Number.isFinite(n) && n > 0 && n < 50000) dollars.push(n);
    }
  }
  if (!dollars.length) return { avg: null, count: 0 };
  const avg = Math.round((dollars.reduce((a, b) => a + b, 0) / dollars.length) * 100) / 100;
  return { avg, count: dollars.length };
}

async function fetchFirecrawl(query: string) {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) throw new Error("missing FIRECRAWL_API_KEY");
  // Prefer search—adjust path if you use a different Firecrawl endpoint
  const res = await fetch(`${FIRECRAWL}/v1/search`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key },
    body: JSON.stringify({ query, limit: 10 })
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`firecrawl_error ${res.status}: ${text.slice(0, 500)}`);
  }
  const json = await res.json();
  // Normalize to an array of items with title/snippet/URL if available
  const items = Array.isArray(json?.data) ? json.data : Array.isArray(json?.results) ? json.results : [];
  return items;
}

export const POST = withCORS(async (req) => {
  try {
    const body = (await req.json().catch(() => ({}))) as ReqBody;
    const query = normalizeQuery(body);
    const ttl = Math.max(300, Math.min(86400, Number(body?.ttlSeconds ?? DEFAULT_TTL)));
    const key = cacheKey(query);

    // 1) Try cache
    try {
      const sql = await getSql();
      const rows = await sql<
        { payload: any }[]
      >`select payload from pricing_cache where key=${key} and expires_at > now() limit 1`;
      if (rows.length) {
        return Response.json(rows[0].payload as PriceResult, { status: 200 });
      }
    } catch (e) {
      // Best-effort: ensure table exists if first run
      try {
        const sql = await getSql();
        await sql`create table if not exists pricing_cache (
          key varchar(200) primary key,
          payload jsonb not null,
          expires_at timestamptz not null
        )`;
      } catch {/* ignore */}
    }

    // 2) Live fetch
    const results = await fetchFirecrawl(query);
    const { avg, count } = extractAveragePrice(results);

    // Trend is unknown without history—mark stable unless null
    const payload: PriceResult = {
      averagePrice: avg,
      sampleSize: count,
      marketTrend: avg == null ? null : "stable",
      lastUpdated: new Date().toISOString(),
      query,
      raw: results
    };

    // 3) Save cache
    try {
      const sql = await getSql();
      await sql`
        insert into pricing_cache (key, payload, expires_at)
        values (${key}, ${payload as any}, now() + interval '${ttl} seconds')
        on conflict (key) do update set
          payload = excluded.payload,
          expires_at = excluded.expires_at
      `;
    } catch {/* ignore cache errors */}

    return Response.json(payload, { status: 200 });
  } catch (err: any) {
    const msg = err?.message || "unknown error";
    const status = /missing .*_API_KEY|missing DATABASE_URL|missing query/i.test(msg) ? 400 : 502;
    return Response.json({ error: "pricing_error", message: msg }, { status });
  }
});

// Optional GET for manual testing: /api/pricing/firecrawl?query=Amazing%20Spider-Man%20#300
export const GET = withCORS(async (req) => {
  const { searchParams } = new URL(req.url);
  const query = searchParams.get("query");
  if (!query) return Response.json({ error: "missing query" }, { status: 400 });
  const proxyReq = new Request(req, {
    method: "POST",
    body: JSON.stringify({ query })
  });
  return POST(proxyReq);
});
