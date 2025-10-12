// app/api/ai/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

const DEFAULT_MODEL = (process.env.DEFAULT_MODEL || "gpt-4o-mini").trim();

function normalizeFirewallBase(raw?: string): string {
  if (!raw) throw new Error("Missing SUPERAGENT_PROXY_URL");
  let url = raw.trim().replace(/\/+$/, "");
  if (!/\/v1$/i.test(url)) url += "/v1";
  return url;
}

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export async function POST(req: Request) {
  const started = Date.now();

  try {
    const base = normalizeFirewallBase(process.env.SUPERAGENT_PROXY_URL);
    const saKey = (process.env.SUPERAGENT_API_KEY || "").trim();
    if (!saKey) return json({ error: "Missing SUPERAGENT_API_KEY" }, 500);

    // Read client body (be tolerant of bad JSON)
    const incoming = await req.json().catch(() => ({}));

    // Basic OpenAI-compatible shape
    let {
      model,
      messages,
      stream,
      temperature,
      max_tokens,
      top_p,
      response_format,
      tools,
      tool_choice,
      // allow passthrough for image content etc.
      ...rest
    } = incoming || {};

    // 🛡️ Ensure messages is an array
    if (!Array.isArray(messages) || messages.length === 0) {
      return json({ error: "Missing messages[] in request body" }, 400);
    }

    // 🛡️ Ensure model is present (fixes your Superagent error)
    model = (model || DEFAULT_MODEL).trim();
    if (!model) {
      return json({ error: "Model must be specified. Set DEFAULT_MODEL or pass model in body." }, 400);
    }

    // Construct upstream request
    const upstreamUrl = `${base}/chat/completions`;
    const payload: any = {
      model,
      messages,
      stream: !!stream,
      ...rest,
    };
    if (typeof temperature === "number") payload.temperature = temperature;
    if (typeof max_tokens === "number") payload.max_tokens = max_tokens;
    if (typeof top_p === "number") payload.top_p = top_p;
    if (response_format) payload.response_format = response_format;
    if (Array.isArray(tools)) payload.tools = tools;
    if (tool_choice) payload.tool_choice = tool_choice;

    const res = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // Superagent gateway accepts any of these; sending all is fine:
        "x-api-key": saKey,
        "x-superagent-api-key": saKey,
        "x-superagent-token": saKey,
        // Avoid gzip → React Native parsing issues
        "accept-encoding": "identity",
      },
      body: JSON.stringify(payload),
    });

    // Stream passthrough if requested
    if (payload.stream && res.ok && res.body) {
      // stream raw SSE
      const headers = new Headers(res.headers);
      headers.set("content-encoding", "identity");
      return new Response(res.body, { status: 200, headers });
    }

    // Non-stream: return parsed or first 2KB of error text
    const text = await res.text();
    if (!res.ok) {
      return json(
        {
          error: "Upstream (Superagent) error",
          status: res.status,
          body: text.slice(0, 2000),
          elapsed_ms: Date.now() - started,
        },
        502
      );
    }

    // Try to parse JSON, but don’t explode if it’s not
    try {
      const parsed = JSON.parse(text);
      return json(parsed, 200);
    } catch {
      return new Response(text, {
        status: 200,
        headers: { "content-type": res.headers.get("content-type") || "application/json" },
      });
    }
  } catch (e: any) {
    return json({ error: "AI proxy error", detail: String(e) }, 500);
  }
}
