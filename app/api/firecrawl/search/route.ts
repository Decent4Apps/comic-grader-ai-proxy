// app/api/firecrawl/search/route.ts
export const runtime = "nodejs";

const BASE = process.env.FIRECRAWL_BASE || "https://api.firecrawl.dev/v1";
const KEY = process.env.FIRECRAWL_API_KEY || "";
const DEFAULT_FORMAT = process.env.FIRECRAWL_DEFAULT_FORMAT || "markdown";

export async function POST(req: Request) {
  if (!KEY) {
    return new Response(JSON.stringify({ error: "Missing FIRECRAWL_API_KEY" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { query, limit = 5, scrape = true, scrapeOptions } = await req.json().catch(() => ({}));
  if (!query) {
    return new Response(JSON.stringify({ error: "Body must include { query }" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const payload = {
    query,
    limit,
    ...(scrape
      ? {
          scrapeOptions: {
            formats: [{ type: DEFAULT_FORMAT }],
            ...(scrapeOptions || {}),
          },
        }
      : {}),
  };

  const r = await fetch(`${BASE}/search`, {
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
      JSON.stringify({ error: "Firecrawl search error", status: r.status, body: text }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }

  return new Response(text, {
    status: 200,
    headers: { "Content-Type": "application/json", "Content-Encoding": "identity" },
  });
}
