// app/api/ai/route.ts
import { NextRequest } from "next/server";
import OpenAI from "openai";

const REQUIRED_ENV = ["SUPERAGENT_API_KEY", "SUPERAGENT_BASE_URL"] as const;

function assertEnv() {
  for (const k of REQUIRED_ENV) {
    if (!process.env[k]) {
      throw new Error(`Missing required env var: ${k}`);
    }
  }
}

function getTimeoutMs() {
  const d = parseInt(process.env.REQUEST_TIMEOUT_MS || "45000", 10);
  return Number.isFinite(d) ? d : 45000;
}

export const runtime = "edge"; // ✅ fast and cheap

export async function POST(req: NextRequest) {
  try {
    assertEnv();

    // ——— Auth (your app should attach Bearer JWT; keep this if your project enforces it) ———
    const auth = req.headers.get("authorization") || "";
    if (!auth.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Missing bearer token" }), { status: 401 });
    }
    // (Optionally: verify JWT here if this endpoint requires it. If you already do it in middleware, skip.)

    // ——— Parse body ———
    const body = await req.json().catch(() => ({} as any));
    const { model, messages, stream, ...rest } = body || {};

    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(
        JSON.stringify({
          error:
            "Invalid 'messages': include at least one item with non-empty text. Example: { messages: [{ role:'user', content:'Hello'}] }",
        }),
        { status: 400 },
      );
    }

    const resolvedModel =
      typeof model === "string" && model.length > 0
        ? model
        : process.env.MODEL_DEFAULT || "openai:gpt-4o-mini";

    // ——— Superagent as OpenAI-compatible upstream ———
    const client = new OpenAI({
      apiKey: process.env.SUPERAGENT_API_KEY!,
      baseURL: process.env.SUPERAGENT_BASE_URL!, // e.g., https://firewall.superagent.sh/<your-route>
      timeout: getTimeoutMs(),
    });

    // Streaming (SSE) path
    if (stream === true) {
      const completionStream = await client.chat.completions.create({
        model: resolvedModel,
        messages,
        stream: true,
        ...rest,
      });

      const encoder = new TextEncoder();
      const readable = new ReadableStream({
        async start(controller) {
          try {
            for await (const chunk of completionStream) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
            }
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          } catch (err: any) {
            controller.error(err);
          }
        },
      });

      return new Response(readable, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Proxy-Upstream": "superagent",
        },
      });
    }

    // Non-streaming JSON path
    const completion = await client.chat.completions.create({
      model: resolvedModel,
      messages,
      stream: false,
      ...rest,
    });

    return new Response(JSON.stringify(completion), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "X-Proxy-Upstream": "superagent",
      },
    });
  } catch (err: any) {
    const status = Number(err?.status || err?.response?.status || 500);
    const detail =
      err?.message ||
      err?.response?.data ||
      err?.response?.statusText ||
      "Proxy error (Superagent)";

    return new Response(JSON.stringify({ error: "AI proxy error", detail }), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export async function OPTIONS() {
  // CORS preflight (tune origins in production)
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": process.env.ALLOW_ORIGIN || "*",
      "Access-Control-Allow-Headers": "authorization, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  });
}
