// app/api/ai/route.ts
import { withCORS } from "../_lib/cors";
import { verifySessionJWT } from "@/src/auth/tokens";

export const runtime = "nodejs";

const isProd = process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";

async function gate(req: Request) {
  const bypass = req.headers.get("x-bypass-token");
  if (!isProd && bypass && process.env.BYPASS_TOKEN && bypass === process.env.BYPASS_TOKEN) return;

  const auth = req.headers.get("authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) throw Object.assign(new Error("unauthorized"), { status: 401 });
  await verifySessionJWT(token).catch((e) => {
    const err = new Error(e?.message || "unauthorized");
    (err as any).status = 401;
    throw err;
  });
}

type Msg = { role: "user" | "assistant" | "system"; content: string };
function ensureBody(obj: any) {
  if (!obj || typeof obj !== "object") throw Object.assign(new Error("bad_request"), { status: 400 });
  const { provider, model, messages, temperature, maxTokens } = obj;
  if (!Array.isArray(messages) || messages.length === 0 || !messages[0]?.content) {
    throw Object.assign(new Error("Invalid 'messages'"), { status: 400 });
  }
  return {
    provider: (provider || "openai") as "openai" | "anthropic",
    model: model as string | undefined,
    temperature: typeof temperature === "number" ? temperature : undefined,
    maxTokens: typeof maxTokens === "number" ? maxTokens : undefined,
    messages: messages as Msg[],
  };
}

export const POST = withCORS(async (req) => {
  try {
    await gate(req);
    const { provider, model, temperature, maxTokens, messages } = ensureBody(await req.json());

    if (provider === "openai") {
      const { default: OpenAI } = await import("openai");
      const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY!,
        baseURL: process.env.OPENAI_BASE_URL || undefined,
      });
      const r = await openai.chat.completions.create({
        model: model ?? "gpt-4o-mini",
        temperature,
        max_tokens: maxTokens,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      });
      const text = r.choices?.[0]?.message?.content ?? "";
      return new Response(JSON.stringify({ ok: true, provider, text }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    if (provider === "anthropic") {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const anthropic = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY!,
        baseURL: process.env.ANTHROPIC_BASE_URL || undefined,
      });
      const sys = messages.find((m) => m.role === "system")?.content ?? "";
      const user = messages
        .filter((m) => m.role !== "system")
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
      const r = await anthropic.messages.create({
        model: model ?? "claude-3-haiku-20240307",
        system: sys || undefined,
        messages: user as any,
        temperature,
        max_tokens: maxTokens ?? 256,
      });
      const text = r.content?.[0]?.type === "text" ? r.content[0].text : "";
      return new Response(JSON.stringify({ ok: true, provider, text }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "unsupported_provider" }), { status: 400 });
  } catch (err: any) {
    const status = err?.status && err.status >= 400 && err.status < 600 ? err.status : 500;
    return new Response(JSON.stringify({ error: err?.message || "proxy_error" }), {
      status,
      headers: { "content-type": "application/json" },
    });
  }
});

export const GET = async () =>
  new Response(JSON.stringify({ ok: true, ts: new Date().toISOString() }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
