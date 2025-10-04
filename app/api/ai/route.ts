// app/api/ai/route.ts
import type { NextRequest } from "next/server";
export const runtime = "nodejs";

function need(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": process.env.ALLOW_ORIGIN || "*",
      "Access-Control-Allow-Headers": "authorization, content-type, x-api-key",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  });
}

export async function POST(req: NextRequest) {
  try {
    const SUPERAGENT_PROXY_URL = need("SUPERAGENT_PROXY_URL");
    const SUPERAGENT_API_KEY  = need("SUPERAGENT_API_KEY");

    // Require app’s anon JWT
    const auth = req.headers.get("authorization") || "";
    if (!auth.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Missing bearer token" }), { status: 401 });
    }

    const body = await req.json().catch(() => ({} as any));
    if (!Array.isArray(body?.messages) || body.messages.length === 0) {
      return new Response(JSON.stringify({ error: "Invalid 'messages' array" }), { status: 400 });
    }

    // Force OpenAI-compatible path
    const upstreamUrl = `${SUPERAGENT_PROXY_URL.replace(/\/+$/, "")}/v1/chat/completions`;

    const controller = new AbortController();
    const timeoutMs = Number(process.env.REQUEST_TIMEOUT_MS || 60000);
    const t = setTimeout(() => controller.abort(), timeoutMs);

    const upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${SUPERAGENT_API_KEY}`, // many routes accept this
        "x-api-key": SUPERAGENT_API_KEY,                 // some routes expect this
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    }).finally(() => clearTimeout(t));

    if (!upstream.ok) {
      const detailText = await upstream.text().catch(() => upstream.statusText);
      // log error so it shows in Vercel logs
      console.error("[superagent-upstream]", upstream.status, detailText);
      return new Response(
        JSON.stringify({
          error: "Upstream (Superagent) error",
          status: upstream.status,
          detail: detailText,
        }),
        { status: 502, headers: { "Content-Type": "application/json" } },
      );
    }

    // Pass-through stream/JSON
    const headers = new Headers(upstream.headers);
    headers.delete("content-length");
    headers.delete("transfer-encoding");
    headers.set("Access-Control-Allow-Origin", process.env.ALLOW_ORIGIN || "*");
    headers.set("X-Proxy-Upstream", "superagent");
    headers.set("Content-Type", upstream.headers.get("content-type") || "application/json; charset=utf-8");

    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (err: any) {
    console.error("[ai-route-error]", err);
    return new Response(JSON.stringify({ error: "AI proxy error", detail: String(err?.message || err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
