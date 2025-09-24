// app/api/ai/route.ts
import { withCORS } from "../_lib/cors";
import { verifySessionJWT } from "@/src/auth/tokens";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

export const runtime = "nodejs";

const isProd =
  process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";

const OPENAI_BASE_URL =
  process.env.OPENAI_BASE_URL || process.env.SUPERAGENT_PROXY_URL || undefined;
const ANTHROPIC_BASE_URL = process.env.ANTHROPIC_BASE_URL || undefined;

async function gate(req: Request) {
  const auth = req.headers.get("authorization");
  const bypass = req.headers.get("x-bypass-token");
  if (!isProd && bypass && bypass === process.env.BYPASS_TOKEN) return; // dev-only bypass
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return Response.json({ error: "unauthorized" }, { status: 401 });
  await verifySessionJWT(token).catch(() => { throw new Error("unauthorized"); });
}

type Role = "user" | "assistant" | "system";
type Msg = { role: Role; content: string };

function ensureBody(obj: any) {
  if (!obj || typeof obj !== "object") throw new Error("bad_request");
  const { provider, model, temperature, maxTokens, messages } = obj;
  if (!provider) throw new Error("missing provider");
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error("missing messages");
  }
  return { provider, model, temperature, maxTokens, messages: messages as Msg[] };
}

export const POST = withCORS(async (req) => {
  try {
    const g = await gate(req);
    if (g instanceof Response) return g;

    const body = await req.json();
    const { provider, model, temperature, maxTokens, messages } = ensureBody(body);

    if (provider === "openai") {
      const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY!,
        baseURL: OPENAI_BASE_URL
      });

      const resp = await openai.chat.completions.create({
        model: model ?? "gpt-4o-mini",
        temperature: typeof temperature === "number" ? temperature : 0.2,
        max_tokens: typeof maxTokens === "number" ? maxTokens : undefined,
        messages: messages.map(m => ({ role: m.role, content: m.content }))
      });

      const choice = resp.choices?.[0];
      return Response.json({
        provider: "openai",
        model: resp.model,
        finish_reason: choice?.finish_reason,
        content: choice?.message?.content ?? ""
      }, { status: 200 });
    }

    if (provider === "anthropic") {
      const anthropic = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY!,
        baseURL: ANTHROPIC_BASE_URL
      });

      // Extract system prompt; Anthropic expects it separately
      const systemParts = messages.filter(m => m.role === "system").map(m => m.content);
      const system = systemParts.length ? systemParts.join("\n\n") : undefined;
      const chat = messages
        .filter(m => m.role !== "system")
        .map(m => ({ role: m.role as "user" | "assistant", content: m.content }));

      const resp = await anthropic.messages.create({
        model: model ?? "claude-3-7-sonnet-latest",
        temperature: typeof temperature === "number" ? temperature : 0.2,
        max_tokens: typeof maxTokens === "number" ? maxTokens : 512,
        system,
        messages: chat
      } as any);

      const text =
        Array.isArray(resp.content) && resp.content.length
          ? (resp.content[0] as any).text ?? ""
          : "";
      return Response.json({
        provider: "anthropic",
        model: resp.model,
        content: text
      }, { status: 200 });
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

export async function GET() {
  return new Response(JSON.stringify({ ok: true, ts: new Date().toISOString() }), {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "no-store" }
  });
}
