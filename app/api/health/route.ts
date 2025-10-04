// app/api/ai/route.ts
import { NextRequest } from "next/server";

export const runtime = "edge";

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

    // Optional auth check for your app token (keep if you require it)
    const auth = req.headers.get("authorization") || "";
    if (!auth.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Missing bearer token" }), { status: 401 });
    }

    // Validate body (at least messages or input)
    const body = await req.json().catch(() => ({} as any));
    if (!Array.isArray(body?.messages) || body.messages.length === 0) {
      return new Response(
        JSON.stringify({
          error:
            "Invalid 'messages': include at least one item with non-empty text. Example: { messages: [{ role:'user', content:'Hello'}] }",
        }),
        { status: 400 },
      );
    }

    // Forward to Superagent (OpenAI-compatible)
    const upstreamUrl = `${SUPERAGENT_BASE_URL}/chat/completions`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(process.env.REQUEST_TIMEOUT_MS || 45000));

    const upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${SUPERAGENT_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    // Pass through status/body/stream
    const headers = new Headers(upstream.headers);
    // Normalize CORS + hint header
    headers.set("Access-Control-Allow-Origin", process.env.ALLOW_ORIGIN || "*");
    headers.set("X-Proxy-Upstream", "superagent");

    // If upstream streams (text/event-stream), we just pipe it through.
    return new Response(upstream.body, {
      status: upstream.status,
      headers,
    });
  } catch (err: any) {
    const status = Number(err?.status || 500);
    const detail = err?.message || "Proxy error (Superagent)";
    return new Response(JSON.stringify({ error: "AI proxy error", detail }), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }
}
