// app/api/ai/route.ts
import { withCORS } from "../_lib/cors"; // keep this path if you used api/_lib/cors.ts
import { verifySessionJWT } from "@/src/auth/tokens"; // or adjust if your verify lives elsewhere
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

export const runtime = "nodejs";

const isProd =
  process.env.VERCEL_ENV === "production" ||
  process.env.NODE_ENV === "production";

/**
 * ENV wiring
 * - For Anthropic via Superagent firewall: set ANTHROPIC_BASE_URL to your Superagent proxy URL
 *   (e.g. https://firewall.superagent.sh/j97882v2grrbt5epxb8xtr1pyh7py3re)
 *   and keep ANTHROPIC_API_KEY as your real Claude key (the firewall forwards it).
 * - For OpenAI via firewall/gateway (optional): set OPENAI_BASE_URL (or leave empty to hit OpenAI directly).
 */
const ANTHROPIC_BASE_URL = process.env.ANTHROPIC_BASE_URL || undefined;
const OPENAI_BASE_URL =
  process.env.OPENAI_BASE_URL || process.env.SUPERAGENT_PROXY_URL || undefined;

async function gate(req: Request) {
  const auth = req.headers.get("authorization");
  const bypass = req.headers.get("x-bypass-token");

  if (!isProd && bypass && bypass === process.env.BYPASS_TOKEN) return;

  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return Response.json({ error: "unauthorized" }, { status: 401 });

  await verifySessionJWT(token).catch(() => {
    throw new Error("unauthorized");
  });
}

type Msg = { role: "user" | "assistant" | "system"; content: any };

export const POST = withCORS(async (req) => {
  try {
    const g = await gate(req);
    if (g) return g;

    const body = await req.json();
    const { provider, model, messages, temperature, maxTokens } = body || {};

    if (!messages?.length) {
      return Response.json({ error: "messages required" }, { status: 400 });
    }

    if (provider === "openai") {
      const client = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY!,
        baseURL: OPENAI_BASE_URL, // optional: route OpenAI through a firewall/gateway
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
      // Superagent supports Anthropic SDK by swapping baseURL to your Superagent proxy URL
      // per docs: just set baseURL and keep your normal Anthropic API key. :contentReference[oaicite:1]{index=1}
      const a = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY!,
        baseURL: ANTHROPIC_BASE_URL, // ← set to your Superagent firewall URL
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
    const details =
      err?.response?.data ||
      err?.data ||
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
