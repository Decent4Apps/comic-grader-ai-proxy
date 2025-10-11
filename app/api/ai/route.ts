// app/api/ai/route.ts
export const runtime = "nodejs";
export const maxDuration = 15;

type ChatMessage =
  | { role: "system" | "user" | "assistant"; content: string }
  | {
      role: "user";
      content: Array<
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: string }
        | { type: "image_b64"; b64: string; mime?: string }
      >;
    };

type AiRequest = {
  provider?: "openai" | "anthropic" | "gemini" | "grok" | "superagent";
  model?: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  // optional: forceVision means "this requires image support"
  forceVision?: boolean;
};

type AiSuccess = { provider: string; model: string; text: string };
type AiError = { provider: string; error: string };

const ENV = {
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || "",
  GOOGLE_API_KEY: process.env.GOOGLE_API_KEY || "",
  XAI_API_KEY: process.env.XAI_API_KEY || "",
  SUPERAGENT_PROXY_URL: process.env.SUPERAGENT_PROXY_URL || "", // e.g. https://firewall.superagent.sh/<config_id>/v1
  SUPERAGENT_API_KEY: process.env.SUPERAGENT_API_KEY || "",
  SUPERAGENT_API_KEY_HEADER: process.env.SUPERAGENT_API_KEY_HEADER || "x-api-key",
  DEFAULT_TEXT_PROVIDER: (process.env.DEFAULT_TEXT_PROVIDER || "anthropic") as AiRequest["provider"],
  DEFAULT_VISION_PROVIDER: (process.env.DEFAULT_VISION_PROVIDER || "openai") as AiRequest["provider"],
};

// --- Helpers ---------------------------------------------------------------

function hasImageInput(messages: ChatMessage[]): boolean {
  return messages.some((m) => {
    if (Array.isArray((m as any).content)) {
      return (m as any).content.some((c: any) => c?.type === "image_url" || c?.type === "image_b64");
    }
    // Heuristic: a single string content won't be treated as image
    return false;
  });
}

function pickProvider(req: AiRequest): { provider: NonNullable<AiRequest["provider"]>; model: string }[] {
  const needsVision = req.forceVision || hasImageInput(req.messages);

  // Preferred models (aliases kept fresh server-side)
  const CANDIDATES: Record<"text" | "vision", { provider: NonNullable<AiRequest["provider"]>; model: string }[]> =
    {
      text: [
        { provider: ENV.DEFAULT_TEXT_PROVIDER || "anthropic", model: "claude-3-5-sonnet-latest" },
        { provider: "openai", model: "gpt-4o-mini" },
        { provider: "gemini", model: "gemini-1.5-pro-latest" },
        { provider: "grok", model: "grok-2-latest" },
        // Superagent can front *any* model you configured – treat as text unless you know it's vision-enabled.
        { provider: "superagent", model: "openai:gpt-4o-mini" },
      ],
      vision: [
        { provider: ENV.DEFAULT_VISION_PROVIDER || "openai", model: "gpt-4o-mini" },
        { provider: "anthropic", model: "claude-3-5-sonnet-latest" },
        // You can add Gemini here if you implement its image content shape
        // { provider: "gemini", model: "gemini-1.5-pro-latest" },
      ],
    };

  const explicit: { provider?: AiRequest["provider"]; model?: string } = {
    provider: req.provider,
    model: req.model,
  };

  // If the caller explicitly set provider/model, respect it BUT if vision is required, make sure it’s vision-capable
  if (explicit.provider && explicit.model) {
    if (needsVision && (explicit.provider === "grok" || explicit.provider === "superagent")) {
      // fall through to vision candidates
    } else {
      return [{ provider: explicit.provider, model: explicit.model }];
    }
  }

  return needsVision ? CANDIDATES.vision : CANDIDATES.text;
}

function normalizeToOpenAIChat(messages: ChatMessage[]): any[] {
  // Convert our flexible content into OpenAI chat.completions shape
  return messages.map((m) => {
    if (Array.isArray((m as any).content)) {
      const parts = (m as any).content.map((c: any) => {
        if (c.type === "text") return { type: "text", text: c.text };
        if (c.type === "image_url") {
          return {
            type: "image_url",
            image_url: c.image_url,
          };
        }
        if (c.type === "image_b64") {
          return {
            type: "image_url",
            image_url: `data:${c.mime || "image/jpeg"};base64,${c.b64}`,
          };
        }
        return null;
      }).filter(Boolean);
      // OpenAI messages allow `content` as array of content parts
      return { role: m.role, content: parts };
    }
    // plain string
    return m as any;
  });
}

function toAnthropicMessages(messages: ChatMessage[]): any {
  // Anthropic v1/messages expects:
  // [{role:"user"|"assistant", content:[{type:"text",text:"..."},{type:"image",source:{type:"base64",media_type:"image/jpeg",data:"..."}}]}]
  const out: any[] = [];
  for (const m of messages) {
    if (Array.isArray((m as any).content)) {
      const parts: any[] = [];
      for (const c of (m as any).content) {
        if (c.type === "text") parts.push({ type: "text", text: c.text });
        if (c.type === "image_url" && typeof c.image_url === "string") {
          // We only pass through http(s) URLs here (Anthropic now supports "image_url" in some SDKs via tool),
          // but the safe/portable approach is base64. If the URL is a data: URL, split it.
          if (c.image_url.startsWith("data:")) {
            const [, rest] = c.image_url.split("base64,");
            parts.push({
              type: "image",
              source: { type: "base64", media_type: "image/jpeg", data: rest },
            });
          } else {
            // If you want to support remote URLs directly, you’d have to fetch and b64-encode server-side.
            // For simplicity, skip remote URLs here.
            parts.push({ type: "text", text: `[image: ${c.image_url}]` });
          }
        }
        if (c.type === "image_b64") {
          parts.push({
            type: "image",
            source: { type: "base64", media_type: c.mime || "image/jpeg", data: c.b64 },
          });
        }
      }
      out.push({ role: m.role === "system" ? "user" : m.role, content: parts });
    } else {
      out.push({ role: m.role === "system" ? "user" : m.role, content: [{ type: "text", text: (m as any).content }] });
    }
  }
  return out;
}

// --- Provider callers ------------------------------------------------------

async function callOpenAI(model: string, body: AiRequest): Promise<AiSuccess> {
  if (!ENV.OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");
  const messages = normalizeToOpenAIChat(body.messages);

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "authorization": `Bearer ${ENV.OPENAI_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: body.temperature ?? 0.2,
      max_tokens: body.max_tokens ?? 1000,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`${res.status} ${t}`);
  }
  const json = await res.json();
  const text = json?.choices?.[0]?.message?.content ?? "";
  return { provider: "openai", model, text };
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
    },
    body: JSON.stringify({
      model,
      max_tokens: body.max_tokens ?? 1000,
      temperature: body.temperature ?? 0.2,
      messages,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`${res.status} ${t}`);
  }
  const json = await res.json();
  const text = json?.content?.map((p: any) => (p.type === "text" ? p.text : "")).join("") ?? "";
  return { provider: "anthropic", model, text };
}

async function callGemini(model: string, body: AiRequest): Promise<AiSuccess> {
  if (!ENV.GOOGLE_API_KEY) throw new Error("Missing GOOGLE_API_KEY");
  // Use v1 + key query param
  // Simple text-only mapping. If you want multimodal, map image parts to inline_data.
  const parts: any[] = [];
  for (const m of body.messages) {
    if (Array.isArray((m as any).content)) {
      for (const c of (m as any).content) {
        if (c.type === "text") parts.push({ text: c.text });
      }
    } else if (typeof (m as any).content === "string") {
      parts.push({ text: (m as any).content });
    }
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent(model)}:generateContent?key=${ENV.GOOGLE_API_KEY}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: {
          temperature: body.temperature ?? 0.2,
          maxOutputTokens: body.max_tokens ?? 1000,
        },
      }),
    }
  );
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`${res.status} ${t}`);
  }
  const json = await res.json();
  const text = json?.candidates?.[0]?.content?.parts?.map((p: any) => p.text || "").join("") ?? "";
  return { provider: "gemini", model, text };
}

async function callGrok(model: string, body: AiRequest): Promise<AiSuccess> {
  if (!ENV.XAI_API_KEY) throw new Error("Missing XAI_API_KEY");
  // Text-only. Do not send images here.
  const plain = body.messages.map((m) =>
    typeof (m as any).content === "string" ? m : { ...m, content: (m as any).content?.map?.((p: any) => p?.text || "").join(" ") }
  );

  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "authorization": `Bearer ${ENV.XAI_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: plain,
      temperature: body.temperature ?? 0.2,
      max_tokens: body.max_tokens ?? 1000,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`${res.status} ${t}`);
  }
  const json = await res.json();
  const text = json?.choices?.[0]?.message?.content ?? "";
  return { provider: "grok", model, text };
}

async function callSuperagent(model: string, body: AiRequest): Promise<AiSuccess> {
  if (!ENV.SUPERAGENT_PROXY_URL) throw new Error("Missing SUPERAGENT_PROXY_URL");
  if (!ENV.SUPERAGENT_API_KEY) throw new Error("Missing SUPERAGENT_API_KEY");

  // IMPORTANT: Superagent expects its own API key header, NOT an OpenAI key.
  // Also: force identity to avoid gzip issues.
  const messages = normalizeToOpenAIChat(body.messages);
  const url = `${ENV.SUPERAGENT_PROXY_URL.replace(/\/+$/, "")}/chat/completions`;

  const headers: Record<string, string> = {
    "content-type": "application/json",
    "Accept-Encoding": "identity",
  };
  headers[ENV.SUPERAGENT_API_KEY_HEADER] = ENV.SUPERAGENT_API_KEY;

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model, // e.g. "openai:gpt-4o-mini" if your Superagent config uses provider prefixes
      messages,
      temperature: body.temperature ?? 0.2,
      max_tokens: body.max_tokens ?? 1000,
      stream: false,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`${res.status} ${t}`);
  }
  const json = await res.json();
  const text = json?.choices?.[0]?.message?.content ?? "";
  return { provider: "superagent", model, text };
}

// --- Router ---------------------------------------------------------------

export async function POST(req: Request) {
  const started = Date.now();
  let lastErrors: AiError[] = [];

  try {
    const body = (await req.json()) as AiRequest;
    const candidates = pickProvider(body);

    // If images are present, drop any text-only providers from the list.
    const needsVision = body.forceVision || hasImageInput(body.messages);
    const filtered = candidates.filter((c) => {
      if (!needsVision) return true;
      return c.provider === "openai" || c.provider === "anthropic";
      // (Optionally add gemini once you implement image mapping)
    });

    for (const c of filtered) {
      try {
        let out: AiSuccess;
        switch (c.provider) {
          case "openai":
            out = await callOpenAI(c.model, body);
            return json(200, { ok: true, ...out, ms: Date.now() - started });
          case "anthropic":
            out = await callAnthropic(c.model, body);
            return json(200, { ok: true, ...out, ms: Date.now() - started });
          case "gemini":
            out = await callGemini(c.model, body);
            return json(200, { ok: true, ...out, ms: Date.now() - started });
          case "grok":
            // safety: refuse if images
            if (needsVision) throw new Error("Grok/x.ai does not support image inputs in this route.");
            out = await callGrok(c.model, body);
            return json(200, { ok: true, ...out, ms: Date.now() - started });
          case "superagent":
            // treat as text unless your Superagent config is clearly vision-enabled
            if (needsVision) throw new Error("Superagent route is configured as text-only for this app.");
            out = await callSuperagent(c.model, body);
            return json(200, { ok: true, ...out, ms: Date.now() - started });
          default:
            throw new Error(`Unknown provider: ${c.provider}`);
        }
      } catch (e: any) {
        lastErrors.push({ provider: c.provider, error: e?.message || String(e) });
        // continue to next candidate
      }
    }

    return json(500, {
      ok: false,
      error: "All providers failed",
      tried: filtered.map((c) => c.provider),
      lastErrors,
      ms: Date.now() - started,
    });
  } catch (e: any) {
    return json(500, { ok: false, error: e?.message || String(e) });
  }
}

function json(status: number, data: any): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
  });
}
