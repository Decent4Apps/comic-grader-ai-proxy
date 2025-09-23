// app/api/ai/route.ts
import { withCORS } from "@/src/lib/cors";
import { verifySessionJWT } from "@/src/auth/tokens";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

export const runtime = "nodejs";

const isProd =
  process.env.VERCEL_ENV === "production" ||
  process.env.NODE_ENV === "production";

// Optional OpenAI firewall; do NOT reuse for Anthropic
const SUPERAGENT_PROXY_URL = process.env.SUPERAGENT_PROXY_URL || undefined;

async function requireAuthOrAnon(req: Request) {
  const auth = req.headers.get("authorization");
  const bypass = req.headers.get("x-bypass-token");

  if (isProd) {
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) return Response.json({ error: "unauthorized" }, { status: 401 });
    await verifySessionJWT(token).catch(() => {
      throw new Error("unauthorized");
    });
    return;
  }

  // In non-prod you may bypass with a token
  if (bypass && bypass === process.env.BYPASS_TOKEN) return;

  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return Response.json({ error: "unauthorized" }, { status: 401 });
  await verifySessionJWT(token).catch(() => {
    throw new Error("unauthorized");
  });
}

type Msg = { role: "user" | "assistant" | "system"; content: any };

export const POST = withCORS(async (req) => {
  try {
    const gate = await requireAuthOrAnon(req);
    if (gate) return gate;

    const body = await req.json();
    const { provider, model, messages, temperature, maxTokens } = body;

    if (!messages?.length) {
      return Response.json({ error: "messages required" }, { status: 400 });
    }

    if (provider === "openai") {
      const client = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY!,
        baseURL: SUPERAGENT_PROXY_URL || undefined, // OK for OpenAI only
      });

      const r = await client.chat.completions.create({
        model: model ?? "gpt-4o-mini",
        temperature,
        max_tokens: maxTokens,
        messages,
      });

      const text = r.choices[0]?.message?.content ?? "";
      return Response.json({ content: text });
    }

    if (provider === "anthropic") {
      // IMPORTANT: do NOT pass baseURL unless you actually run an Anthropic-compatible gateway
      const a = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY!,
      });

      const r = await a.messages.create({
        model: model ?? "claude-3-7-sonnet-latest",
        temperature,
        max_tokens: maxTokens ?? 1024,
        messages: (messages as Msg[]).map((m) => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content:
            typeof m.content === "string"
              ? m.content
              : JSON.stringify(m.content),
        })),
      });

      const text =
        (Array.isArray(r.content) && (r.content[0] as any)?.text) || "";
      return Response.json({ content: text });
    }

    return Response.json({ error: "provider not implemented" }, { status: 400 });
  } catch (err: any) {
    // Bubble up useful diagnostics rather than a generic 500
    const details =
      err?.response?.data ||
      err?.error ||
      err?.message ||
      "unknown server error";
    const status =
      (err?.status && Number.isInteger(err.status) && err.status >= 400 && err.status < 600)
        ? err.status
        : 500;
    return Response.json({ error: "proxy_error", details }, { status });
  }
});
