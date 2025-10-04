// app/api/ai/route.ts
import type { NextRequest } from "next/server";

/**
 * Superagent Proxy (stateless):
 * - OPENAI_BASE_URL = your Superagent Proxy link (must include /v1)
 * - OPENAI_API_KEY  = your OpenAI sk_ key
 * No SUPERAGENT_* envs in this mode.
 */
export const runtime = "nodejs";

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

function upstreamUrl() {
  // OPENAI_BASE_URL should already include /v1 (e.g., https://firewall.superagent.sh/v1)
  const base = need("OPENAI_BASE_URL").replace(/\/+$/, "");
  return `${base}/chat/completions`;
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: cors() });
}

export async function POST(req: NextRequest) {
  try {
    // Require app's bearer (anon token)
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

    const url = upstreamUrl();
    const timeoutMs = Number(process.env.REQUEST_TIMEOUT_MS || 60000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const upstream = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${need("OPENAI_API_KEY")}`, // sk_... (stateless proxy)
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

    // Pass-through JSON or SSE stream
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
