// app/api/ai/route.ts
export const runtime = "nodejs";
export const maxDuration = 15;

/**
 * This route:
 * - Detects if the request includes images
 * - For image jobs → only uses *vision-capable* providers (OpenAI gpt-4o / Anthropic Claude 3.5 Sonnet)
 * - For text jobs → tries your preferred text provider, then falls back to others
 * - Returns the first successful response (others can fail without breaking the call)
 * - Sends OpenAI traffic *through Superagent* if SUPERAGENT_PROXY_URL is set, while keeping YOUR OpenAI key
 * - Forces `Accept-Encoding: identity` to avoid gzip "Unexpected token 0x1F" issues
 */

type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: string }
  | { type: "image_b64"; b64: string; mime?: string };

type ChatMessage =
  | { role: "system" | "user" | "assistant"; content: string }
  | { role: "user" | "assistant"; content: ContentPart[] };

type AiRequest = {
  // Optional per-request override
  provider?: "openai" | "anthropic" | "gemini" | "grok";
  model?: string;

  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  // Optional: force-flag if the caller knows it's a vision job
  forceVision?: boolean;
};

type AiSuccess = { provider: string; model: string; text: string };
type AiError = { provider: string; error: string };

const ENV = {
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || "",
  GOOGLE_API_KEY: process.env.GOOGLE_API_KEY || "",
  XAI_API_KEY: process.env.XAI_API_KEY || "",

  // If present, all OpenAI calls go through Superagent as an OpenAI-compatible proxy.
  SUPERAGENT_PROXY_URL: process.env.SUPERAGENT_PROXY_URL || "", // e.g. https://firewall.superagent.sh/<config_id>/v1

  DEFAULT_TEXT_PROVIDER: (process.env.DEFAULT_TEXT_PROVIDER || "anthropic") as NonNullable<
    AiRequest["provider"]
  >,
  DEFAULT_VISION_PROVIDER: (process.env.DEFAULT_VISION_PROVIDER || "openai") as NonNullable<
    AiRequest["provider"]
  >,

  OPENAI_MODEL_TEXT: process.env.OPENAI_MODEL_TEXT || "gpt-4o-mini",
  OPENAI_MODEL_VISION: process.env.OPENAI_MODEL_VISION || "gpt-4o",
  ANTHROPIC_MODEL_TEXT: process.env.ANTHROPIC_MODEL_TEXT || "claude-3-5-sonnet-latest",
  ANTHROPIC_MODEL_VISION: process.env.ANTHROPIC_MODEL_VISION || "claude-3-5-sonnet-latest",
  GEMINI_MODEL_TEXT: process.env.GEMINI_MODEL_TEXT || "gemini-1.5-pro-latest",
  GROK_MODEL_TEXT: process.env.GROK_MODEL_TEXT || "grok-2-latest",
};

// ---------- utils -----------------------------------------------------------

function json(status: number, data: any): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-expose-headers": "*",
    },
  });
}

function hasImageInput(messages: ChatMessage[]): boolean {
  return messages.some((m) => Array.isArray((m as any).content) &&
    (m as any).content.some((c: ContentPart) => c?.type === "image_url" || c?.type === "image_b64"));
}

// Map to OpenAI Chat Completions content (supports text + image_url/data URI)
function normalizeToOpenAIChat(messages: ChatMessage[]): any[] {
  return messages.map((m) => {
    if (Array.isArray((m as any).content)) {
      const parts = (m as any).content
        .map((c: ContentPart) => {
          if (c.type === "text") return { type: "text", text: c.text };
          if (c.type === "image_url") return { type: "image_url", image_url: c.image_url };
          if (c.type === "image_b64") {
            return {
              type: "image_url",
              image_url: `data:${c.mime || "image/jpeg"};base64,${c.b64}`,
            };
          }
          return null;
        })
        .filter(Boolean);
      return { role: (m as any).role, content: parts };
    }
    return m as any; // plain string content
  });
}

// Map to Anthropic v1/messages: text + base64 images
function toAnthropicMessages(messages: ChatMessage[]): any[] {
  const out: any[] = [];
  for (const m of messages) {
    if (Array.isArray((m as any).content)) {
      const parts: any[] = [];
      for (const c of (m as any).content as ContentPart[]) {
        if (c.type === "text") parts.push({ type: "text", text: c.text });
        if (c.type === "image_b64") {
          parts.push({
            type: "image",
            source: { type: "base64", media_type: c.mime || "image/jpeg", data: c.b64 },
          });
        }
        if (c.type === "image_url") {
          const url = c.image_url;
          if (url.startsWith("data:")) {
            const [, rest] = url.split("base64,");
            parts.push({
              type: "image",
              source: { type: "base64", media_type: "image/jpeg", data: rest },
            });
          } else {
            // For remote URLs, you can optionally fetch and b64-encode here.
            parts.push({ type: "text", text: `[image: ${url}]` });
          }
        }
      }
      out.push({ role: m.role === "system" ? "user" : m.role, content: parts });
    } else {
      out.push({
        role: m.role === "system" ? "user" : m.role,
        content: [{ type: "text", text: (m as any).content }],
      });
    }
  }
  return out;
}

// ---------- provider callers ------------------------------------------------

// OpenAI via Superagent proxy (preferred if SUPERAGENT_PROXY_URL is set)
async function callOpenAI_viaSuperagent(model: string, body: AiRequest): Promise<AiSuccess> {
  if (!ENV.OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");
  if (!ENV.SUPERAGENT_PROXY_URL) throw new Error("Missing SUPERAGENT_PROXY_URL");

  const messages = normalizeToOpenAIChat(body.messages);
  const url = `${ENV.SUPERAGENT_PROXY_URL.replace(/\/+$/, "")}/chat/completions`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      // Per Superagent proxy docs: keep your OpenAI key in Authorization
      authorization: `Bearer ${ENV.OPENAI_API_KEY}`,
      "content-type": "application/json",
      "accept-encoding": "identity", // avoid gzip "0x1F" JSON parsing issues
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: body.temperature ?? 0.2,
      max_tokens: body.max_tokens ?? 1000,
    }),
  });

  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const json = await res.json();
  const text = json?.choices?.[0]?.message?.content ?? "";
  return { provider: "openai(superagent)", model, text };
}

// OpenAI direct (fallback if proxy not configured)
async function callOpenAI_direct(model: string, body: AiRequest): Promise<AiSuccess> {
  if (!ENV.OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");
  const messages = normalizeToOpenAIChat(body.messages);

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${ENV.OPENAI_API_KEY}`,
      "content-type": "application/json",
      "accept-encoding": "identity",
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: body.temperature ?? 0.2,
      max_tokens: body.max_tokens ?? 1000,
    }),
  });

  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const json = await res.json();
  const text = json?.choices?.[0]?.message?.content ?? "";
  return { provider: "openai", model, text };
}

async function callOpenAI(model: string, body: AiRequest): Promise<AiSuccess> {
  if (ENV.SUPERAGENT_PROXY_URL) return callOpenAI_viaSuperagent(model, body);
  return callOpenAI_direct(model, body);
}

async function callAnthropic(model: string, body: AiRequest): Promise<AiSuccess> {
  if (!ENV.ANTHROPIC_API_KEY) throw new Error("Missing ANTHROPIC_API_KEY");
  const messages = toAnthropicMessages(body.messages);

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ENV.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
      "accept-encoding": "identity",
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: body.temperature ?? 0.2,
      max_tokens: body.max_tokens ?? 1000,
    }),
  });

  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const json = await res.json();
  const text =
    json?.content?.map((p: any) => (p?.type === "text" ? p?.text : "")).join("") ?? "";
  return { provider: "anthropic", model, text };
}

async function callGemini(model: string, body: AiRequest): Promise<AiSuccess> {
  if (!ENV.GOOGLE_API_KEY) throw new Error("Missing GOOGLE_API_KEY");
  // Text-only mapping for now
  const parts: any[] = [];
  for (const m of body.messages) {
    if (Array.isArray((m as any).content)) {
      for (const c of (m as any).content) if (c.type === "text") parts.push({ text: c.text });
    } else if (typeof (m as any).content === "string") {
      parts.push({ text: (m as any).content });
    }
  }

  const url = `https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent(
    model
  )}:generateContent?key=${ENV.GOOGLE_API_KEY}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "accept-encoding": "identity" },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: {
        temperature: body.temperature ?? 0.2,
        maxOutputTokens: body.max_tokens ?? 1000,
      },
    }),
  });

  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const json = await res.json();
  const text =
    json?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text || "").join("") ?? "";
  return { provider: "gemini", model, text };
}

async function callGrok(model: string, body: AiRequest): Promise<AiSuccess> {
  if (!ENV.XAI_API_KEY) throw new Error("Missing XAI_API_KEY");
  // Text-only. If images exist, router will skip Grok.
  const flattened = body.messages.map((m) => {
    if (typeof (m as any).content === "string") return m;
    if (Array.isArray((m as any).content)) {
      const text = (m as any).content
        .map((p: any) => (p?.type === "text" ? p.text : ""))
        .filter(Boolean)
        .join(" ");
      return { role: (m as any).role, content: text };
    }
    return m;
  });

  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${ENV.XAI_API_KEY}`,
      "content-type": "application/json",
      "accept-encoding": "identity",
    },
    body: JSON.stringify({
      model,
      messages: flattened,
      temperature: body.temperature ?? 0.2,
      max_tokens: body.max_tokens ?? 1000,
    }),
  });

  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const json = await res.json();
  const text = json?.choices?.[0]?.message?.content ?? "";
  return { provider: "grok", model, text };
}

// ---------- routing ---------------------------------------------------------

function pickCandidates(req: AiRequest): { provider: NonNullable<AiRequest["provider"]>; model: string }[] {
  const needsVision = req.forceVision || hasImageInput(req.messages);

  // Respect explicit override if sensible (don’t allow text-only with images)
  if (req.provider && req.model) {
    if (needsVision && req.provider !== "openai" && req.provider !== "anthropic") {
      // ignore invalid override for vision
    } else {
      return [{ provider: req.provider, model: req.model }];
    }
  }

  if (needsVision) {
    // Vision-capable only
    const primary =
      ENV.DEFAULT_VISION_PROVIDER === "anthropic"
        ? [{ provider: "anthropic", model: ENV.ANTHROPIC_MODEL_VISION }]
        : [{ provider: "openai", model: ENV.OPENAI_MODEL_VISION }];

    const fallback =
      primary[0].provider === "openai"
        ? [{ provider: "anthropic", model: ENV.ANTHROPIC_MODEL_VISION }]
        : [{ provider: "openai", model: ENV.OPENAI_MODEL_VISION }];

    return [...primary, ...fallback];
  }

  // Text candidates
  const order: NonNullable<AiRequest["provider"]>[] = ["anthropic", "openai", "gemini", "grok"];
  // Place DEFAULT_TEXT_PROVIDER first
  const sorted = [
    ENV.DEFAULT_TEXT_PROVIDER,
    ...order.filter((p) => p !== ENV.DEFAULT_TEXT_PROVIDER),
  ];

  return sorted.map((p) => {
    switch (p) {
      case "anthropic":
        return { provider: "anthropic", model: ENV.ANTHROPIC_MODEL_TEXT };
      case "openai":
        return { provider: "openai", model: ENV.OPENAI_MODEL_TEXT };
      case "gemini":
        return { provider: "gemini", model: ENV.GEMINI_MODEL_TEXT };
      case "grok":
        return { provider: "grok", model: ENV.GROK_MODEL_TEXT };
      default:
        return { provider: "openai", model: ENV.OPENAI_MODEL_TEXT };
    }
  });
}

export async function POST(req: Request) {
  const started = Date.now();
  let body: AiRequest;

  try {
    body = (await req.json()) as AiRequest;
  } catch {
    return json(400, { ok: false, error: "Invalid JSON body" });
  }

  const candidates = pickCandidates(body);
  const needsVision = body.forceVision || hasImageInput(body.messages);

  const tried: string[] = [];
  const errors: AiError[] = [];

  for (const c of candidates) {
    tried.push(`${c.provider}:${c.model}`);
    try {
      let out: AiSuccess;
      switch (c.provider) {
        case "openai":
          // If SUPERAGENT_PROXY_URL is set, this call goes *through* Superagent automatically
          out = await callOpenAI(c.model, body);
          return json(200, { ok: true, ...out, ms: Date.now() - started });

        case "anthropic":
          out = await callAnthropic(c.model, body);
          return json(200, { ok: true, ...out, ms: Date.now() - started });

        case "gemini":
          if (needsVision) throw new Error("Gemini vision not configured in this route.");
          out = await callGemini(c.model, body);
          return json(200, { ok: true, ...out, ms: Date.now() - started });

        case "grok":
          if (needsVision) throw new Error("Grok does not support image inputs here.");
          out = await callGrok(c.model, body);
          return json(200, { ok: true, ...out, ms: Date.now() - started });

        default:
          throw new Error(`Unknown provider: ${c.provider}`);
      }
    } catch (e: any) {
      errors.push({ provider: c.provider, error: e?.message || String(e) });
      // continue to next candidate
    }
  }

  return json(500, {
    ok: false,
    error: "All providers failed",
    tried,
    errors,
    ms: Date.now() - started,
  });
}
