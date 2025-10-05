import type { NextRequest } from "next/server";

export const runtime = "nodejs";

/** Ensure the base is a Superagent Proxy URL and includes /v1 */
function normalizeBaseUrl(raw: string) {
  let base = (raw || "").trim().replace(/\/+$/, "");
  if (!/\/v1$/.test(base)) base += "/v1";
  return base;
}

function need(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function cors() {
  return {
    "Access-Control-Allow-Origin": process.env.ALLOW_ORIGIN || "*",
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  } as const;
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: cors() });
}

export async function POST(req: NextRequest) {
  try {
    // Require app's anon bearer
    const auth = req.headers.get("authorization") || "";
    if (!auth.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Missing bearer token" }), {
        status: 401,
        headers: { "Content-Type": "application/json", ...cors() },
      });
    }

    const body = await req.json().catch(() => ({} as any));
    if (!Array.isArray(body?.messages) || body.messages.length === 0) {
      return new Response(
        JSON.stringify({
          error:
            "Invalid 'messages'. Use: { model:'gpt-4o-mini', messages:[{ role:'user', content:'Hello'}] }",
        }),
        { status: 400, headers: { "Content-Type": "application/json", ...cors() } },
      );
    }

    const base = normalizeBaseUrl(need("OPENAI_BASE_URL")); // REAL Superagent Proxy link
    const url = `${base}/chat/completions`;                 // append exactly once
    const key = need("OPENAI_API_KEY");                     // sk_ (vendor key)

    // Log once so we can verify the exact URL in Vercel logs
    console.log("[ai-proxy] base:", base);
    console.log("[ai-proxy] upstream URL:", url);

    const timeoutMs = Number(process.env.REQUEST_TIMEOUT_MS || 60000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const upstream = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,      // vendor key (stateless)
        "Content-Type": "application/json",
        "Accept-Encoding": "identity",       // ask upstream NOT to compress
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => upstream.statusText);
      console.error("[proxy-upstream]", upstream.status, detail);
      return new Response(
        JSON.stringify({ error: "Upstream error", status: upstream.status, detail }),
        { status: 502, headers: { "Content-Type": "application/json", ...cors() } },
      );
    }

    // Pass-through body (JSON or SSE) but force no compression to clients
    const headers = new Headers(upstream.headers);
    headers.delete("content-length");
    headers.delete("transfer-encoding");
    headers.delete("content-encoding");                  // strip any gzip from upstream
    headers.set("Content-Encoding", "identity");         // ensure RN gets plain bytes
    headers.set("Cache-Control", "no-transform");        // discourage re-compression
    headers.set("Access-Control-Allow-Origin", process.env.ALLOW_ORIGIN || "*");
    headers.set("X-Proxy-Upstream", "superagent-proxy");
    // keep upstream content-type if present; else default JSON
    headers.set(
      "Content-Type",
      headers.get("content-type") || "application/json; charset=utf-8",
    );

    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (err: any) {
    console.error("[ai-route-error]", err);
    return new Response(
      JSON.stringify({ error: "AI proxy error", detail: err?.message || String(err) }),
      { status: 500, headers: { "Content-Type": "application/json", ...cors() } },
    );
  }
}
