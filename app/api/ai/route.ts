export const runtime = "edge";

/**
 * REQUIRED ENVS (see .env.example):
 * - SUPERAGENT_PROXY_URL: e.g. https://firewall.superagent.sh/<FIREWALL_ID>/v1
 * - OPENAI_API_KEY:       e.g. sk-...
 *
 * Optional:
 * - DEFAULT_MODEL: e.g. gpt-4o-mini
 */

const DEFAULT_MODEL = process.env.DEFAULT_MODEL || "gpt-4o-mini";

// Normalize base to ensure it has exactly one trailing /v1 (no doubles)
function normalizeFirewallBase(raw?: string): string {
  if (!raw) throw new Error("Missing SUPERAGENT_PROXY_URL");
  let url = raw.trim();
  // strip any trailing slashes
  url = url.replace(/\/+$/, "");
  // ensure it ends with /v1
  if (!/\/v1$/.test(url)) url += "/v1";
  return url;
}

function getUpstreamUrl() {
  const base = normalizeFirewallBase(process.env.SUPERAGENT_PROXY_URL);
  return `${base}/chat/completions`;
}

// Always use OpenAI-compat auth for this handler:
function getAuthHeader() {
  const key = process.env.OPENAI_API_KEY;
  if (!key || !key.startsWith("sk-")) {
    throw new Error("OPENAI_API_KEY missing or invalid (must start with 'sk-').");
  }
  return `Bearer ${key}`;
}

export async function POST(req: Request) {
  try {
    const upstreamUrl = getUpstreamUrl();

    // Validate body
    const body = await req.json().catch(() => ({}));
    const { messages, model, temperature, max_tokens, stream } = body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: "Invalid 'messages': supply non-empty array." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Force non-stream for debug while you stabilize
    const payload = {
      model: model || DEFAULT_MODEL,
      messages,
      temperature: typeof temperature === "number" ? temperature : 0.7,
      max_tokens: typeof max_tokens === "number" ? max_tokens : undefined,
      stream: false,
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000); // 20s timeout

    const res = await fetch(upstreamUrl, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Authorization": getAuthHeader(),          // <-- MUST be OPENAI key for OpenAI-compat
        "Content-Type": "application/json",
        "Accept-Encoding": "identity",             // Avoid RN gzip parse issues while debugging
      },
      body: JSON.stringify(payload),
    }).finally(() => clearTimeout(timeoutId));

    const txt = await res.text().catch(() => "");
    const hdrs: Record<string, string> = {};
    res.headers.forEach((v, k) => (hdrs[k] = v));

    if (!res.ok) {
      // Bubble up ALL the context so you can see exactly what's wrong
      return new Response(
        JSON.stringify(
          {
            error: "Upstream (Superagent) error",
            status: res.status,
            upstreamUrl,
            request: {
              model: payload.model,
              stream: payload.stream,
            },
            responseHeaders: hdrs,
            body: txt || "No body",
          },
          null,
          2
        ),
        { status: res.status === 404 ? 502 : 502, headers: { "Content-Type": "application/json" } }
      );
    }

    // Success: return JSON directly
    let json: any = {};
    try {
      json = txt ? JSON.parse(txt) : {};
    } catch {
      // If Superagent replied with compressed or non-JSON unexpectedly
      return new Response(
        JSON.stringify(
          {
            error: "Invalid JSON from upstream",
            upstreamUrl,
            responseHeaders: hdrs,
            bodyPreview: txt.slice(0, 400),
          },
          null,
          2
        ),
        { status: 502, headers: { "Content-Type": "application/json" } }
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
    return new Response(
      JSON.stringify(
        {
          error: isAbort ? "Gateway timeout to Superagent" : "AI proxy error",
          detail: msg,
          hint:
            "Confirm SUPERAGENT_PROXY_URL ends with /v1 (exactly once) and OPENAI_API_KEY is present.",
        },
        null,
        2
      ),
      { status: isAbort ? 504 : 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
