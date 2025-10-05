// app/api/ai/route.ts
export const runtime = "nodejs";

/**
 * REQUIRED ENVS:
 * - SUPERAGENT_PROXY_URL: e.g. https://firewall.superagent.sh/<FIREWALL_ID> OR .../v1
 * - OPENAI_API_KEY:       e.g. sk-...
 * Optional:
 * - DEFAULT_MODEL:        e.g. gpt-4o-mini
 *
 * NOTES:
 * - We normalize SUPERAGENT_PROXY_URL to end with /v1 exactly once.
 * - We always send Authorization: Bearer <OPENAI_API_KEY> (OpenAI-compat mode).
 * - Non-streaming for stability; you can re-enable later.
 */

const DEFAULT_MODEL = process.env.DEFAULT_MODEL || "gpt-4o-mini";

function normalizeFirewallBase(raw?: string): string {
  if (!raw) throw new Error("Missing SUPERAGENT_PROXY_URL");
  let url = raw.trim().replace(/\/+$/, "");
  // ensure single /v1 suffix
  if (!/\/v1$/i.test(url)) url += "/v1";
  return url;
}

function getAuthHeader(): string {
  const key = process.env.OPENAI_API_KEY || "";
  if (!key.startsWith("sk-")) {
    throw new Error("OPENAI_API_KEY missing or invalid (must start with 'sk-').");
  }
  return `Bearer ${key}`;
}

export async function POST(req: Request) {
  const started = Date.now();

  try {
    const base = normalizeFirewallBase(process.env.SUPERAGENT_PROXY_URL);
    const upstreamUrl = `${base}/chat/completions`;

    const body = await req.json().catch(() => ({}));
    const { messages, model, temperature, max_tokens, stream } = body || {};

    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: "Invalid 'messages': provide a non-empty array." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const payload = {
      model: model || DEFAULT_MODEL,
      messages,
      temperature: typeof temperature === "number" ? temperature : 0.7,
      max_tokens: typeof max_tokens === "number" ? max_tokens : undefined,
      // Force non-stream for now; flip to true after 200s are stable
      stream: false,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000); // 20s

    console.info("[ai-proxy] upstream:", upstreamUrl);
    console.info("[ai-proxy] model:", payload.model, "stream:", payload.stream);

    const res = await fetch(upstreamUrl, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Authorization": getAuthHeader(),
        "Content-Type": "application/json",
        // Avoid RN gzip parse issues while stabilizing
        "Accept-Encoding": "identity",
      },
      body: JSON.stringify(payload),
    }).finally(() => clearTimeout(timeout));

    const text = await res.text().catch(() => "");
    const headersDump: Record<string, string> = {};
    res.headers.forEach((v, k) => (headersDump[k] = v));

    if (!res.ok) {
      console.error("[ai-proxy] upstream non-OK:", res.status, text?.slice(0, 400));
      return new Response(
        JSON.stringify(
          {
            error: "Upstream (Superagent) error",
            status: res.status,
            took_ms: Date.now() - started,
            upstreamUrl,
            request: { model: payload.model, stream: payload.stream },
            responseHeaders: headersDump,
            body: text || "No body",
          },
          null,
          2
        ),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }

    let json: any = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch (e) {
      console.error("[ai-proxy] invalid JSON from upstream:", (e as Error)?.message);
      return new Response(
        JSON.stringify(
          {
            error: "Invalid JSON from upstream",
            took_ms: Date.now() - started,
            upstreamUrl,
            responseHeaders: headersDump,
            bodyPreview: text.slice(0, 400),
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
    console.error("[ai-proxy] fatal:", msg);
    return new Response(
      JSON.stringify(
        {
          error: isAbort ? "Gateway timeout to Superagent" : "AI proxy error",
          detail: msg,
        },
        null,
        2
      ),
      { status: isAbort ? 504 : 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
