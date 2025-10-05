export const runtime = "edge";

const FIREWALL_BASE = process.env.SUPERAGENT_PROXY_URL; // e.g. https://firewall.superagent.sh/<FIREWALL_ID>/v1
const FIREWALL_AUTH_MODE = process.env.SUPERAGENT_AUTH_MODE || "openai"; 
// "openai" -> use OPENAI_API_KEY as Bearer
// "proxy"  -> use SUPERAGENT_PROXY_KEY as Bearer

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const SUPERAGENT_PROXY_KEY = process.env.SUPERAGENT_PROXY_KEY || "";
const DEFAULT_MODEL = process.env.DEFAULT_MODEL || "gpt-4o-mini";

function bearer() {
  if (FIREWALL_AUTH_MODE === "proxy") {
    if (!SUPERAGENT_PROXY_KEY) throw new Error("Missing SUPERAGENT_PROXY_KEY");
    return `Bearer ${SUPERAGENT_PROXY_KEY}`;
  }
  if (!OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");
  return `Bearer ${OPENAI_API_KEY}`;
}

export async function POST(req: Request) {
  try {
    if (!FIREWALL_BASE) {
      return new Response(JSON.stringify({ error: "Missing SUPERAGENT_PROXY_URL" }), { status: 500 });
    }

    const body = await req.json().catch(() => ({}));
    const { messages, model, temperature, max_tokens, stream } = body || {};

    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: "Invalid messages[]" }), { status: 400 });
    }

    // For initial debug, disable stream to simplify gzip/transport issues.
    const payload = {
      model: model || DEFAULT_MODEL,
      messages,
      temperature: typeof temperature === "number" ? temperature : 0.7,
      max_tokens: typeof max_tokens === "number" ? max_tokens : undefined,
      stream: false,
    };

    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 20000); // 20s debug timeout

    const res = await fetch(`${FIREWALL_BASE}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Authorization": bearer(),
        "Content-Type": "application/json",
        // Prevent gzipped payloads while debugging client parse errors:
        "Accept-Encoding": "identity",
      },
      body: JSON.stringify(payload),
      // Edge runtime ignores some node fetch options; this keeps it simple.
    }).catch((e) => {
      throw new Error(`Upstream fetch error: ${e.message || e}`);
    }).finally(() => clearTimeout(id));

    // Surface firewall 4xx/5xx with body for easier diagnosis
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return new Response(JSON.stringify({
        error: "Upstream (Superagent) error",
        status: res.status,
        detail: text || "No body",
      }), { status: 502 });
    }

    // Return JSON straight through
    const json = await res.json();
    return new Response(JSON.stringify(json), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        // Send identity to keep RN happy during debug
        "Content-Encoding": "identity",
        "Cache-Control": "no-store",
      },
    });
  } catch (err: any) {
    const msg = err?.message || String(err);
    // Map aborts/timeouts to 504 for clarity
    const isAbort = /abort/i.test(msg) || /The operation was aborted/i.test(msg);
    return new Response(JSON.stringify({
      error: isAbort ? "Gateway timeout to Superagent" : "AI proxy error",
      detail: msg,
    }), { status: isAbort ? 504 : 500 });
  }
}
