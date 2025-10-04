// app/api/ai/route.ts
import type { NextRequest } from "next/server";

export const runtime = "nodejs"; // ✅ Node runtime avoids Edge streaming quirks

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
      "Access-Control-Allow-Headers": "authorization, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  });
}

export async function POST(req: NextRequest) {
  try {
    const SUPERAGENT_API_KEY = requireEnv("SUPERAGENT_API_KEY");
    const SUPERAGENT_BASE_URL = requireEnv("SUPERAGENT_BASE_URL"); // e.g. https://firewall.superagent.sh/<route>

    // Require Bearer (your anon token)
    const auth = req.headers.get("authorization") || "";
    if (!auth.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Missing bearer token" }), { status: 401 });
    }

    // Read request body once, then forward the same JSON
    const body = await req.json().catch(() => ({} as any));
    if (!Array.isArray(body?.messages) || body.messages.length === 0) {
      return new Response(
        JSON.stringify({
          error: "Invalid 'messages'. Use: { model, messages:[{ role:'user', content:'Hello' }] }",
        }),
        { status: 400 },
      );
    }

    // Superagent OpenAI-compatible endpoint
    const url = `${SUPERAGENT_BASE_URL.replace(/\/+$/, "")}/chat/completions`;

    const controller = new AbortController();
    const timeoutMs = Number(process.env.REQUEST_TIMEOUT_MS || 45000);
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const upstream = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SUPERAGENT_API_KEY}`,
        "Content-Type": "application/json",
        // Optional: forward a minimal client-ip for firewall rules
        "X-Forwarded-For": req.headers.get("x-forwarded-for") || "",
      },
      body: JSON.stringify(body),
      // Important: no 'duplex' in Next’s fetch; Node runtime will stream fine.
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));

    // Normalize headers to avoid ECONNRESET due to mismatched lengths/encoding
    const headers = new Headers(upstream.headers);

    // Always allow the app origin (or * while testing)
    headers.set("Access-Control-Allow-Origin", process.env.ALLOW_ORIGIN || "*");
    headers.set("X-Proxy-Upstream", "superagent");

    // These can be wrong after pass-through; better to drop them
    headers.delete("content-length");
    headers.delete("transfer-encoding"); // Node/Next will set correctly
    // Keep content-type from upstream if present, else default to JSON
    const ct = upstream.headers.get("content-type") || "application/json; charset=utf-8";
    headers.set("Content-Type", ct);

    // Return the upstream body as-is (handles JSON or SSE stream)
    return new Response(upstream.body, {
      status: upstream.status,
      headers,
    });
  } catch (err: any) {
    const status = Number(err?.status || 500);
    const msg = err?.message || "Proxy error (Superagent)";
    return new Response(JSON.stringify({ error: "AI proxy error", detail: msg }), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }
}
