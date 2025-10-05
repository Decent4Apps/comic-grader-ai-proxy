// app/api/ai/route.ts
export const runtime = "nodejs";
export const maxDuration = 10; // be explicit on Node func max runtime

const DEFAULT_MODEL = process.env.DEFAULT_MODEL || "gpt-4o-mini";

function normalizeFirewallBase(raw?: string): string {
  if (!raw) throw new Error("Missing SUPERAGENT_PROXY_URL");
  let url = raw.trim().replace(/\/+$/, "");
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
    const { messages, model, temperature, max_tokens } = body || {};

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
      stream: false,
    };

    // Abort before Vercel's 10s hard limit
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
    if (!res.ok) {
      return new Response(
        JSON.stringify(
          {
            error: "Upstream (Superagent) error",
            status: res.status,
            took_ms: Date.now() - started,
            upstreamUrl,
            request: { model: payload.model, stream: payload.stream },
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
    } catch {
      return new Response(
        JSON.stringify(
          {
            error: "Invalid JSON from upstream",
            took_ms: Date.now() - started,
            upstreamUrl,
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

export async function GET() {
  return new Response(
    JSON.stringify(
      {
        status: "ok",
        modelDefault: DEFAULT_MODEL,
        ts: new Date().toISOString(),
      },
      null,
      2
    ),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}
