// app/api/firecrawl/scrape/route.ts
export const runtime = "nodejs";

const BASE = process.env.FIRECRAWL_BASE || "https://api.firecrawl.dev/v1";
const KEY = process.env.FIRECRAWL_API_KEY || "";
const DEFAULT_FORMAT = process.env.FIRECRAWL_DEFAULT_FORMAT || "markdown";
const DEFAULT_TIMEOUT = Number(process.env.FIRECRAWL_DEFAULT_TIMEOUT || 20000);

export async function POST(req: Request) {
  if (!KEY) {
    return new Response(JSON.stringify({ error: "Missing FIRECRAWL_API_KEY" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { url, scrapeOptions } = await req.json().catch(() => ({}));
  if (!url) {
    return new Response(JSON.stringify({ error: "Body must include { url }" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const payload = {
    url,
    scrapeOptions: {
      formats: [{ type: DEFAULT_FORMAT }], // markdown | summary | links | json | screenshot
      timeout: DEFAULT_TIMEOUT,
      ...scrapeOptions,
    },
  };

  const r = await fetch(`${BASE}/scrape`, {
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
      JSON.stringify({ error: "Firecrawl scrape error", status: r.status, body: text }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }

  return new Response(text, {
    status: 200,
    headers: { "Content-Type": "application/json", "Content-Encoding": "identity" },
  });
}
