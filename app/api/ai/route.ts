export const runtime = "nodejs";

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export async function POST(req: Request) {
  try {
    const SUPERAGENT_API_KEY = requireEnv("SUPERAGENT_API_KEY");
    const SUPERAGENT_PROXY_URL = requireEnv("SUPERAGENT_PROXY_URL"); // ✅ new name

    const auth = req.headers.get("authorization") || "";
    if (!auth.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Missing bearer token" }), { status: 401 });
    }

    const body = await req.json();
    if (!Array.isArray(body?.messages)) {
      return new Response(JSON.stringify({ error: "Invalid body" }), { status: 400 });
    }

    // ✅ Use the /v1/chat/completions endpoint under Superagent proxy URL
    const upstreamUrl = `${SUPERAGENT_PROXY_URL.replace(/\/+$/, "")}/v1/chat/completions`;

    const upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${SUPERAGENT_API_KEY}`,
        "x-api-key": SUPERAGENT_API_KEY, // both headers supported
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => upstream.statusText);
      return new Response(JSON.stringify({ error: "Upstream (Superagent) error", status: upstream.status, detail }), {
        status: 502,
        headers: { "Content-Type": "application/json", "X-Proxy-Upstream": "superagent" },
      });
    }

    // Pass-through (JSON or stream)
    const headers = new Headers(upstream.headers);
    headers.set("Access-Control-Allow-Origin", process.env.ALLOW_ORIGIN || "*");
    headers.set("X-Proxy-Upstream", "superagent");
    headers.delete("content-length");
    headers.delete("transfer-encoding");
    headers.set("Content-Type", upstream.headers.get("content-type") || "application/json; charset=utf-8");

    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: "AI proxy error", detail: err?.message || String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
