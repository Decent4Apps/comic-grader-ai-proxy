// app/api/ai/route.ts
export const runtime = "nodejs";

/**
 * REQUIRED ENVS:
 * - SUPERAGENT_PROXY_URL: e.g. https://firewall.superagent.sh/<FIREWALL_ID>  (with or without /v1)
 *
 * ONE of these, based on SUPERAGENT_AUTH_MODE:
 * - (openai mode) OPENAI_API_KEY:       sk-...
 * - (proxy  mode) SUPERAGENT_PROXY_KEY: sa_proxy_...
 *
 * Optional:
 * - SUPERAGENT_AUTH_MODE: "openai" | "proxy"  (default "openai")
 * - DEFAULT_MODEL:        e.g. gpt-4o-mini
 *
 * Notes:
 * - We normalize SUPERAGENT_PROXY_URL to end with /v1 exactly once.
 * - While stabilizing, we send stream: false to avoid RN gzip/streaming traps.
 * - Add ?ping=1 on GET to run a live upstream test without the app.
 */

const AUTH_MODE = (process.env.SUPERAGENT_AUTH_MODE || "openai").toLowerCase();
const DEFAULT_MODEL = process.env.DEFAULT_MODEL || "gpt-4o-mini";

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
  // default: openai passthrough mode
  const openaiKey = process.env.OPENAI_API_KEY || "";
  if (!openaiKey || !openaiKey.startsWith("sk-")) {
    throw new Error(
      "OPENAI_API_KEY missing or invalid (must start with 'sk-'). Set SUPERAGENT_AUTH_MODE='proxy' to use SUPERAGENT_PROXY_KEY instead."
    );
  }
  return `Bearer ${openaiKey}`;
}

function makeJsonResponse(obj: any, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { "Content-Type": "application/json", "Content-Encoding": "identity" },
  });
}

export async function GET(req: Request) {
  // Health/debug: /api/ai => shows env presence; /api/ai?ping=1 => makes a live test call upstream
  const url = new URL(req.url);
  const doPing = url.searchParams.get("ping") === "1";

  const env = {
    runtime: "nodejs",
    SUPERAGENT_PROXY_URL_present: !!process.env.SUPERAGENT_PROXY_URL,
    SUPERAGENT_AUTH_MODE: AUTH_MODE,
    OPENAI_API_KEY_present: !!process.env.OPENAI_API_KEY,
    SUPERAGENT_PROXY_KEY_present: !!process.env.SUPERAGENT_PROXY_KEY,
    DEFAULT_MODEL,
  };

  if (!doPing) {
    return makeJsonResponse({ status: "ok", env, hint: "Append ?ping=1 to run a live upstream test." });
  }

  try {
    const base = normalizeFirewallBase(process.env.SUPERAGENT_PROXY_URL);
    const upstreamUrl = `${base}/chat/completions`;

    const payload = {
      model: DEFAULT_MODEL,
      messages: [{ role: "user", content: "Hello from /api/ai?ping=1" }],
      stream: false,
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

    const txt = await r.text().catch(() => "");
    const headersDump: Record<string, string> = {};
    r.headers.forEach((v, k) => (headersDump[k] = v));

    return makeJsonResponse(
      {
        status: r.ok ? "upstream-ok" : "upstream-error",
        upstreamStatus: r.status,
        upstreamUrl,
        request: { model: payload.model, stream: payload.stream },
        responseHeaders: headersDump,
        body: r.ok ? JSON.parse(txt || "{}") : (txt || "No body"),
      },
      r.ok ? 200 : 502
    );
  } catch (err: any) {
    return makeJsonResponse(
      {
        status: "ping-failed",
        error: err?.message || String(err),
        hints: [
          "Ensure SUPERAGENT_PROXY_URL points to your firewall ID (with or without /v1).",
          AUTH_MODE === "proxy"
            ? "Using SUPERAGENT_AUTH_MODE='proxy' → requires SUPERAGENT_PROXY_KEY."
            : "Using SUPERAGENT_AUTH_MODE='openai' → requires OPENAI_API_KEY (sk-...).",
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

    // Accept a superset of OpenAI-compatible fields.
    const body = await req.json().catch(() => ({}));
    const {
      messages,
      model,
      temperature,
      max_tokens,
      stream,
      // Extra OpenAI-compatible fields we’ll pass through if provided
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
      return makeJsonResponse({ error: "Invalid 'messages': provide a non-empty array." }, 400);
    }

    // Stabilization: force non-stream. Flip to true later once upstream is reliable.
    const payload: Record<string, any> = {
      model: model || DEFAULT_MODEL,
      messages,
      temperature: typeof temperature === "number" ? temperature : 0.7,
      max_tokens: typeof max_tokens === "number" ? max_tokens : undefined,
      stream: false,
    };

    // Pass through optional fields only if provided (avoid sending undefined)
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

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000); // 20s

    console.info("[ai-proxy] upstream:", upstreamUrl);
    console.info("[ai-proxy] auth_mode:", AUTH_MODE, "model:", payload.model, "stream:", payload.stream);

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
      console.error("[ai-proxy] upstream non-OK:", res.status, text?.slice(0, 400));
      return makeJsonResponse(
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

    let json: any = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch (e) {
      console.error("[ai-proxy] invalid JSON from upstream:", (e as Error)?.message);
      return makeJsonResponse(
        {
          error: "Invalid JSON from upstream",
          took_ms: Date.now() - started,
          upstreamUrl,
          responseHeaders: headersDump,
          bodyPreview: text.slice(0, 400),
        },
        502
      );
    }

    return new Response(JSON.stringify(json), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Encoding": "identity",
        "Cache-Control": "no-store",
      },
    });
  } catch (err: any) {
    const msg = err?.message || String(err);
    const isAbort = /abort/i.test(msg) || /The operation was aborted/i.test(msg);
    console.error("[ai-proxy] fatal:", msg);
    return makeJsonResponse(
      {
        error: isAbort ? "Gateway timeout to Superagent" : "AI proxy error",
        detail: msg,
        hints: [
          "Confirm SUPERAGENT_PROXY_URL is correct and ends with your firewall ID.",
          AUTH_MODE === "proxy"
            ? "Using proxy mode → check SUPERAGENT_PROXY_KEY validity."
            : "Using openai mode → check OPENAI_API_KEY (sk-...) validity.",
        ],
      },
      isAbort ? 504 : 500
    );
  }
}
