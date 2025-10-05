// app/api/firecrawl/crawl/route.ts
export const runtime = "nodejs";

const BASE = process.env.FIRECRAWL_BASE || "https://api.firecrawl.dev/v1";
const KEY = process.env.FIRECRAWL_API_KEY || "";

export async function POST(req: Request) {
  if (!KEY) {
    return new Response(JSON.stringify({ error: "Missing FIRECRAWL_API_KEY" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const {
    url,
    includePaths,
    excludePaths,
    maxDiscoveryDepth,
    maxCrawledLinks,
    concurrency,
    webhook,       // { url, events: ["crawl.started","crawl.page","crawl.completed"] }
    scrapeOptions, // e.g. { formats: [{ type: "markdown" }], timeout: 20000 }
    zeroDataRetention,
  } = await req.json().catch(() => ({}));

  if (!url) {
    return new Response(JSON.stringify({ error: "Body must include { url }" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const payload = {
    url,
    includePaths,
    excludePaths,
    maxDiscoveryDepth,
    maxCrawledLinks,
    concurrency,
    webhook,
    scrapeOptions,
    zeroDataRetention,
  };

  const r = await fetch(`${BASE}/crawl`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      "Accept-Encoding": "identity",
    },
    body: JSON.stringify(payload),
  });

  const text = await r.text().catch(() => "");
  if (!r.ok) {
    return new Response(
      JSON.stringify({ error: "Firecrawl crawl start error", status: r.status, body: text }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }

  // Returns { id, ... }
  return new Response(text, {
    status: 200,
    headers: { "Content-Type": "application/json", "Content-Encoding": "identity" },
  });
}
