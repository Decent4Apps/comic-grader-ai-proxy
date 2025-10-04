// app/api/ai/route.ts
import type { NextRequest } from "next/server";

/**
 * STATeless Superagent Proxy wiring:
 * - OPENAI_BASE_URL -> Superagent Proxy Link (must include /v1)
 * - OPENAI_API_KEY  -> your OpenAI sk_ key
 * No SUPERAGENT_* envs should be set/used in this mode.
 */
export const runtime = "nodejs";

function need(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function toUpstreamUrl() {
  // OPENAI_BASE_URL must be a Superagent Proxy URL that already includes /v1
  // We append /chat/completions so final is .../v1/chat/completions
  const base = need("OPENAI_BASE_URL").replace(/\/+$/, "");
  return `${base}/chat/completions`;
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": process.env.ALLOW_ORIGIN || "*",
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function POST(req: NextRequest) {
  try {
    // Require your app's bearer token (e.g., anon JWT) to call this endpoint
    const auth = req.headers.get("authorization") || "";
    if (!auth.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Missing bearer token" }), {
        status: 401,
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      });
    }

    const body = await req.json().catch(() => ({} as any));
    // OpenAI-style guard: require messages[]
    if (!Array.isArray(body?.messages) || body.messages.length === 0) {
      return new Response(
        JSON.stringify({
          error:
            "Invalid 'messages'. Use: { model:'gpt-4o-mini', messages:[{ role:'user', content:'Hello'}] }",
        }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders() } },
      );
    }

    const upstreamUrl = toUpstreamUrl();
    const timeoutMs = Number(process.env.REQUEST_TIMEOUT_MS || 60000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    // IMPORTANT:
    //  - Authorization header uses your OpenAI sk_ key (stateless proxy mode)
    //  - Content-Type JSON
    const upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${need("OPENAI_API_KEY")}`, // sk_...
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));

    // Bubble up upstream errors with detail so you can see exact cause in logs/client
    if (!upstream.ok) {
      const detailText = await upstream.text().catch(() => upstream.statusText);
      console.error("[proxy-upstream]", upstream.status, detailText);
      return new Response(
        JSON.stringify({
          error: "Upstream error",
          status: upstream.status,
          detail: detailText,
        }),
        { status: 502, headers: { "Content-Type": "application/json", ...corsHeaders() } },
      );
    }

    // Pass through (works for JSON and SSE stream). Normalize framing headers.
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
      JSON.stringify({
        error: "AI proxy error",
        detail: err?.message || String(err),
      }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders() } },
    );
  }
}
