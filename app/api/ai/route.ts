// app/api/ai/route.ts
import type { NextRequest } from "next/server";

export const runtime = "nodejs";

/** Ensure the base is a stateless Superagent Proxy URL and includes /v1 */
function normalizeBaseUrl(raw: string) {
  let base = (raw || "").trim();
  // Strip trailing slashes
  base = base.replace(/\/+$/, "");
  // If someone pasted a route/config URL, this will still "work" syntactically,
  // but stateless proxy EXPECTS a pure proxy link (no config id). 404s are typical otherwise.
  // Make sure we have /v1
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
    // Require app token
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

    // Build upstream URL safely
    const base = normalizeBaseUrl(need("OPENAI_BASE_URL")); // must be the PROXY link
    const url = `${base}/chat/completions`; // append once
    const key = need("OPENAI_API_KEY");     // sk_... (vendor key)

    // Log once so we can verify the final URL in Vercel logs
    console.log("[ai-proxy] base:", base);
    console.log("[ai-proxy] upstream URL:", url);

    const timeoutMs = Number(process.env.REQUEST_TIMEOUT_MS || 60000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const upstream = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
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

    const headers = new Headers(upstream.headers);
    headers.delete("content-length");
    headers.delete("transfer-encoding");
    headers.set("Access-Control-Allow-Origin", process.env.ALLOW_ORIGIN || "*");
    headers.set("X-Proxy-Upstream", "superagent-proxy");
    headers.set("Content-Type", headers.get("content-type") || "application/json; charset=utf-8");

    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (err: any) {
    console.error("[ai-route-error]", err);
    return new Response(
      JSON.stringify({ error: "AI proxy error", detail: err?.message || String(err) }),
      { status: 500, headers: { "Content-Type": "application/json", ...cors() } },
    );
  }
}
