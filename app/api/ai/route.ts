// app/api/ai/route.ts
export const runtime = "nodejs";
export const maxDuration = 10; // can't exceed platform cap

/**
 * ENV
 * ----
 * REQUIRED:
 * - SUPERAGENT_PROXY_URL   e.g. https://firewall.superagent.sh/<FIREWALL_ID>  (with or without /v1)
 *
 * AUTH (pick ONE mode via SUPERAGENT_AUTH_MODE):
 * - openai (default): requires OPENAI_API_KEY (sk-...)
 * - proxy           : requires SUPERAGENT_PROXY_KEY
 *
 * OPTIONAL:
 * - SUPERAGENT_AUTH_MODE = "openai" | "proxy"  (default "openai")
 * - DEFAULT_MODEL        = "gpt-4o-mini" (default)
 */

const DEFAULT_MODEL = process.env.DEFAULT_MODEL || "gpt-4o-mini";
const AUTH_MODE = (process.env.SUPERAGENT_AUTH_MODE || "openai").toLowerCase();

function normalizeFirewallBase(raw?: string): string {
  if (!raw) throw new Error("Missing SUPERAGENT_PROXY_URL");
  let url = raw.trim().replace(/\/+$/, "");
  if (!/\/v1$/i.test(url)) url += "/v1";
  return url;
}

function getAuthHeader(): string {
  if (AUTH_MODE === "proxy") {
    const proxyKey = process.env.SUPERAGENT_PROXY_KEY || "";
    if (!proxyKey) {
      throw new Error("SUPERAGENT_AUTH_MODE='proxy' but SUPERAGENT_PROXY_KEY is missing.");
    }
    return `Bearer ${proxyKey}`;
  }
  const key = process.env.OPENAI_API_KEY || "";
  if (!key.startsWith("sk-")) {
    throw new Error("OPENAI_API_KEY missing or invalid (must start with 'sk-').");
  }
  return `Bearer ${key}`;
}

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Content-Encoding": "identity",
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(req: Request) {
  // Health check. Append ?ping=1 to try a tiny upstream request.
  const url = new URL(req.url);
  const doPing = url.searchParams.get("ping") === "1";

  const env = {
    runtime,
    maxDuration,
    AUTH_MODE,
    has_SUPERAGENT_PROXY_URL: !!process.env.SUPERAGENT_PROXY_URL,
    has_OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
    has_SUPERAGENT_PROXY_KEY: !!process.env.SUPERAGENT_PROXY_KEY,
    DEFAULT_MODEL,
  };

  if (!doPing) return json({ status: "ok", env, hint: "Add ?ping=1 to test upstream." });

  try {
    const base = normalizeFirewallBase(process.env.SUPERAGENT_PROXY_URL);
    const upstreamUrl = `${base}/chat/completions`;

    const payload = {
      model: DEFAULT_MODEL,
      messages: [{ role: "user", content: "ping" }],
      stream: false,
      max_tokens: 5,
      temperature: 0,
    };

    const r = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        Authorization: getAuthHeader(),
        "Content-Type": "application/json",
        "Accept-Encoding": "identity",
      },
      body: JSON.stringify(payload),
    });

    const text = await r.text().catch(() => "");
    const headersDump: Record<string, string> = {};
    r.headers.forEach((v, k) => (headersDump[k] = v));

    if (!r.ok) {
      return json(
        {
          status: "upstream-error",
          upstreamStatus: r.status,
          upstreamUrl,
          request: { model: payload.model, stream: payload.stream },
          responseHeaders: headersDump,
          body: text || "No body",
        },
        502
      );
    }

    let parsed: any = {};
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch (e: any) {
      return json(
        {
          status: "upstream-invalid-json",
          upstreamUrl,
          responseHeaders: headersDump,
          bodyPreview: text.slice(0, 400),
          parseError: e?.message,
        },
        502
      );
    }

    return json({ status: "upstream-ok", upstreamUrl, responseHeaders: headersDump, body: parsed });
  } catch (err: any) {
    return json(
      {
        status: "ping-failed",
        error: err?.message || String(err),
        hints: [
          "Verify SUPERAGENT_PROXY_URL (with or without /v1).",
          AUTH_MODE === "proxy"
            ? "Mode 'proxy': ensure SUPERAGENT_PROXY_KEY is valid."
            : "Mode 'openai': ensure OPENAI_API_KEY starts with 'sk-'.",
        ],
      },
      500
    );
  }
}

export async function POST(req: Request) {
  const started = Date.now();

  try {
    const base = normalizeFirewallBase(process.env.SUPERAGENT_PROXY_URL);
    const upstreamUrl = `${base}/chat/completions`;

    // Accept OpenAI-compatible fields; pass through the common ones.
    const body = await req.json().catch(() => ({}));
    const {
      messages,
      model,
      temperature,
      max_tokens,
      // optional pass-throughs if present
      response_format,
      tools,
      tool_choice,
      metadata,
      logit_bias,
      top_p,
      frequency_penalty,
      presence_penalty,
      seed,
      stop,
      user,
    } = body || {};

    if (!Array.isArray(messages) || messages.length === 0) {
      return json({ error: "Invalid 'messages': provide a non-empty array." }, 400);
    }

    const payload: Record<string, any> = {
      model: model || DEFAULT_MODEL,
      messages,
      temperature: typeof temperature === "number" ? temperature : 0.7,
      max_tokens: typeof max_tokens === "number" ? max_tokens : undefined,
      stream: false, // keep non-stream for stability
    };

    if (typeof top_p === "number") payload.top_p = top_p;
    if (typeof frequency_penalty === "number") payload.frequency_penalty = frequency_penalty;
    if (typeof presence_penalty === "number") payload.presence_penalty = presence_penalty;
    if (response_format) payload.response_format = response_format;
    if (Array.isArray(tools)) payload.tools = tools;
    if (tool_choice) payload.tool_choice = tool_choice;
    if (metadata) payload.metadata = metadata;
    if (logit_bias) payload.logit_bias = logit_bias;
    if (seed !== undefined) payload.seed = seed;
    if (stop !== undefined) payload.stop = stop;
    if (user) payload.user = user;

    // Abort BEFORE Vercel's cap so we return a clean JSON instead of runtime kill
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8500);

    const res = await fetch(upstreamUrl, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: getAuthHeader(),
        "Content-Type": "application/json",
        "Accept-Encoding": "identity",
      },
      body: JSON.stringify(payload),
    }).finally(() => clearTimeout(timeout));

    const text = await res.text().catch(() => "");
    const headersDump: Record<string, string> = {};
    res.headers.forEach((v, k) => (headersDump[k] = v));

    if (!res.ok) {
      return json(
        {
          error: "Upstream (Superagent) error",
          status: res.status,
          took_ms: Date.now() - started,
          upstreamUrl,
          request: { model: payload.model, stream: payload.stream },
          responseHeaders: headersDump,
          body: text || "No body",
        },
        502
      );
    }

    let parsed: any = {};
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch (e: any) {
      return json(
        {
          error: "Invalid JSON from upstream",
          took_ms: Date.now() - started,
          upstreamUrl,
          responseHeaders: headersDump,
          bodyPreview: text.slice(0, 400),
          parseError: e?.message,
        },
        502
      );
    }

    return json(parsed, 200);
  } catch (err: any) {
    const msg = err?.message || String(err);
    const isAbort = /abort/i.test(msg) || /The operation was aborted/i.test(msg);
    return json(
      {
        error: isAbort ? "Gateway timeout to Superagent" : "AI proxy error",
        detail: msg,
      },
      isAbort ? 504 : 500
    );
  }
}
