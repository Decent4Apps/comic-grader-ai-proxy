// app/api/ai/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

const DEFAULT_MODEL_ENV = (process.env.DEFAULT_MODEL || "").trim(); // e.g., "openai:gpt-4o-mini"
const DEFAULT_PROVIDER = (process.env.DEFAULT_PROVIDER || "openai").trim(); // used to prefix non-namespaced models

function normalizeFirewallBase(raw?: string): string {
  if (!raw) throw new Error("Missing SUPERAGENT_PROXY_URL");
  let url = raw.trim().replace(/\/+$/, "");
  if (!/\/v1$/i.test(url)) url += "/v1";
  return url;
}

function normalizeModel(inputModel?: string): string {
  // Prefer explicit body model; else env DEFAULT_MODEL; else throw
  let m = (inputModel || DEFAULT_MODEL_ENV).trim();
  if (!m) throw new Error("No model supplied and DEFAULT_MODEL not set.");
  // If body/env model is not namespaced, prefix with provider (multitenant requires namespaced)
  if (!m.includes(":")) m = `${DEFAULT_PROVIDER}:${m}`;
  return m;
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

    // tolerate bad JSON
    const incoming = await req.json().catch(() => ({} as any));

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
      ...rest
    } = incoming || {};

    if (!Array.isArray(messages) || messages.length === 0) {
      return json({ error: "Missing messages[] in request body" }, 400);
    }

    // ✅ Ensure multitenant-friendly model
    model = normalizeModel(model);

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
        // Superagent gateway keys:
        "x-api-key": saKey,
        "x-superagent-api-key": saKey,
        "x-superagent-token": saKey,
        // Avoid gzip confusion with RN fetch:
        "accept-encoding": "identity",
      },
      body: JSON.stringify(payload),
    });

    if (payload.stream && res.ok && res.body) {
      // passthrough SSE
      const headers = new Headers(res.headers);
      headers.set("content-encoding", "identity");
      return new Response(res.body, { status: 200, headers });
    }

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
