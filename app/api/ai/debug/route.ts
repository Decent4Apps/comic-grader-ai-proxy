// app/api/ai/debug/route.ts
export const runtime = "nodejs";

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

export async function GET() {
  try {
    const base = normalizeFirewallBase(process.env.SUPERAGENT_PROXY_URL);
    const upstreamUrl = `${base}/chat/completions`;
    const payload = {
      model: process.env.DEFAULT_MODEL || "gpt-4o-mini",
      messages: [{ role: "user", content: "Hello from /api/ai/debug" }],
      stream: false,
    };

    const res = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        "Authorization": getAuthHeader(),
        "Content-Type": "application/json",
        "Accept-Encoding": "identity",
      },
      body: JSON.stringify(payload),
    });

    const txt = await res.text().catch(() => "");
    const hdrs: Record<string, string> = {};
    res.headers.forEach((v, k) => (hdrs[k] = v));

    return new Response(
      JSON.stringify(
        {
          ok: res.ok,
          status: res.status,
          upstreamUrl,
          request: { model: payload.model, stream: payload.stream },
          responseHeaders: hdrs,
          body: txt || "No body",
        },
        null,
        2
      ),
      { status: res.ok ? 200 : 502, headers: { "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ ok: false, error: err?.message || String(err) }, null, 2),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
