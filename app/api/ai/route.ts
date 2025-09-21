import { withCORS } from "@/src/lib/cors";
import { verifySessionJWT } from "@/src/auth/tokens";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

export const runtime = "nodejs";

type Msg = { role: "user" | "assistant" | "system"; content: any };

async function requireAuth(req: Request) {
  const auth = req.headers.get("authorization");
  const bypass = req.headers.get("x-bypass-token");

  // In production: JWT only (no bypass).
  if (process.env.NODE_ENV === "production") {
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) return Response.json({ error: "unauthorized" }, { status: 401 });
    await verifySessionJWT(token).catch(() => {
      throw new Error("unauthorized");
    });
    return;
  }

  // Non-prod: allow BYPASS_TOKEN, else require JWT
  if (bypass && bypass === process.env.BYPASS_TOKEN) return;
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return Response.json({ error: "unauthorized" }, { status: 401 });
  await verifySessionJWT(token).catch(() => {
    throw new Error("unauthorized");
  });
}

export const POST = withCORS(async (req) => {
  const gate = await requireAuth(req);
  if (gate) return gate; // returned a Response (e.g., 401)

  const { provider, model, messages, temperature, maxTokens } = await req.json();

  if (!messages?.length) {
    return Response.json({ error: "messages required" }, { status: 400 });
  }

  if (provider === "openai") {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
    const r = await client.chat.completions.create({
      model: model ?? "gpt-4o-mini",
      temperature,
      max_tokens: maxTokens,
      messages,
    });
    const text = r.choices[0]?.message?.content ?? "";
    return Response.json({
      content: text,
      usage: r.usage
        ? {
            promptTokens: r.usage.prompt_tokens,
            completionTokens: r.usage.completion_tokens,
            totalTokens: r.usage.total_tokens,
          }
        : undefined,
    });
  }

  if (provider === "anthropic") {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
    const r = await client.messages.create({
      model: model ?? "claude-3-5-sonnet-20240620",
      temperature,
      max_tokens: maxTokens ?? 1024,
      messages: (messages as Msg[]).map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content:
          typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      })),
    });
    const text = (r.content[0] as any)?.text ?? "";
    return Response.json({ content: text });
  }

  return Response.json({ error: "provider not implemented" }, { status: 400 });
});
