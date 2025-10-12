// app/api/ai/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

const DEFAULT_MODEL = (process.env.DEFAULT_MODEL || "gpt-4o-mini").trim();

function normalizeProxyBase(raw?: string): string {
  if (!raw) throw new Error("Missing SUPERAGENT_PROXY_URL");
  let url = raw.trim().replace(/\/+$/, "");
  // PROXY MODE: do NOT append /v1 here; Superagent Proxy already speaks OpenAI-compat
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
    const base = normalizeProxyBase(process.env.SUPERAGENT_PROXY_URL);
    const openaiKey = (process.env.OPENAI_API_KEY || "").trim();
    if (!openaiKey) return json({ error: "Missing OPENAI_API_KEY" }, 500);

    const incoming = await req.json().catch(() => ({}));
    let { model, messages, stream, ...rest } = incoming || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return json({ error: "Missing messages[] in request body" }, 400);
    }
    model = (model || DEFAULT_MODEL).trim();

    const res = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // In PROXY mode, Superagent expects the upstream provider key in Authorization
        "authorization": `Bearer ${openaiKey}`,
        "accept-encoding": "identity",
      },
      body: JSON.stringify({ model, messages, stream: !!stream, ...rest }),
    });

    if (stream && res.ok && res.body) {
      const headers = new Headers(res.headers);
      headers.set("content-encoding", "identity");
      return new Response(res.body, { status: 200, headers });
    }

    const text = await res.text();
    if (!res.ok) {
      return json(
        { error: "Upstream (Superagent Proxy) error", status: res.status, body: text.slice(0, 2000), elapsed_ms: Date.now() - started },
        502
      );
    }

    try { return json(JSON.parse(text), 200); }
    catch { return new Response(text, { status: 200, headers: { "content-type": res.headers.get("content-type") || "application/json" } }); }
  } catch (e: any) {
    return json({ error: "AI proxy error", detail: String(e) }, 500);
  }
}
