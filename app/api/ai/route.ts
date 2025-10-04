// app/api/ai/route.ts
import { NextRequest } from "next/server";

export const runtime = "edge";

function requireEnv(name: string) {
  const val = process.env[name];
  if (!val) throw new Error(`Missing env var: ${name}`);
  return val;
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

    // (Keep your app's auth requirement)
    const auth = req.headers.get("authorization") || "";
    if (!auth.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Missing bearer token" }), { status: 401 });
    }

    const body = await req.json().catch(() => ({} as any));
    if (!Array.isArray(body?.messages) || body.messages.length === 0) {
      return new Response(
        JSON.stringify({
          error:
            "Invalid 'messages': include at least one item. Example: { messages: [{ role:'user', content:'Hello'}] }",
        }),
        { status: 400 },
      );
    }

    // Send to Superagent’s OpenAI-compatible endpoint
    const url = `${SUPERAGENT_BASE_URL.replace(/\/+$/, "")}/chat/completions`;

    const controller = new AbortController();
    const timeoutMs = Number(process.env.REQUEST_TIMEOUT_MS || 45000);
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const upstream = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${SUPERAGENT_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));

    // Pass-through response (supports JSON or SSE streaming)
    const headers = new Headers(upstream.headers);
    headers.set("Access-Control-Allow-Origin", process.env.ALLOW_ORIGIN || "*");
    headers.set("X-Proxy-Upstream", "superagent");

    return new Response(upstream.body, {
      status: upstream.status,
      headers,
    });
  } catch (err: any) {
    const status = Number(err?.status || 500);
    return new Response(JSON.stringify({ error: "AI proxy error", detail: String(err?.message || err) }), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }
}
