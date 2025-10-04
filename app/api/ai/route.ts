// app/api/ai/route.ts
import type { NextRequest } from "next/server";

export const runtime = "nodejs"; // stable streaming & logging

function requireEnv(name: string) {
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
    const SUPERAGENT_API_KEY = requireEnv("SUPERAGENT_API_KEY");
    const SUPERAGENT_BASE_URL = requireEnv("SUPERAGENT_BASE_URL"); // e.g. https://firewall.superagent.sh/<route-id>

    const auth = req.headers.get("authorization") || "";
    if (!auth.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Missing bearer token" }), { status: 401 });
    }

    const body = await req.json().catch(() => ({} as any));
    if (!Array.isArray(body?.messages) || body.messages.length === 0) {
      return new Response(
        JSON.stringify({
          error:
            "Invalid 'messages'. Use: { model, messages:[{ role:'user', content:'Hello' }] }",
        }),
        { status: 400 },
      );
    }

    // ✅ Many Superagent OpenAI-compatible firewalls require /v1/chat/completions
    const upstreamUrl = `${SUPERAGENT_BASE_URL.replace(/\/+$/, "")}/v1/chat/completions`;

    const controller = new AbortController();
    const timeoutMs = Number(process.env.REQUEST_TIMEOUT_MS || 45000);
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        // Send BOTH common auth header styles (one will be accepted)
        "Authorization": `Bearer ${SUPERAGENT_API_KEY}`,
        "x-api-key": SUPERAGENT_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));

    // If upstream failed, read its text so we see the true reason in Vercel logs & client
    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => upstream.statusText);
      return new Response(
        JSON.stringify({
          error: "Upstream (Superagent) error",
          status: upstream.status,
          detail,
        }),
        {
          status: 502, // reflect gateway error
          headers: { "Content-Type": "application/json", "X-Proxy-Upstream": "superagent" },
        },
      );
    }

    // Streaming or JSON: pass-through
    const headers = new Headers(upstream.headers);
    headers.set("Access-Control-Allow-Origin", process.env.ALLOW_ORIGIN || "*");
    headers.set("X-Proxy-Upstream", "superagent");
    headers.delete("content-length");
    headers.delete("transfer-encoding");
    headers.set(
      "Content-Type",
      upstream.headers.get("content-type") || "application/json; charset=utf-8",
    );

    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (err: any) {
    const status = Number(err?.status || 500);
    const detail = err?.message || "Proxy error (Superagent)";
    return new Response(JSON.stringify({ error: "AI proxy error", detail }), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }
}
