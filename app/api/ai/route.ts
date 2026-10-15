import { authorizePaidRequest, readPaidJson, boundAIInput } from "../../../lib/paid-security.mjs";
// app/api/ai/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

// ENV
const FW_BASE = (process.env.SUPERAGENT_PROXY_URL || "").trim(); // firewall or proxy base; we detect which call we're making
const SA_KEY = (process.env.SUPERAGENT_API_KEY || "").trim();    // for FIREWALL calls
const OPENAI_KEY = (process.env.OPENAI_API_KEY || "").trim();    // for PROXY fallback
const DEFAULT_PROVIDER = (process.env.DEFAULT_PROVIDER || "openai").trim();
const DEFAULT_MODEL = (process.env.DEFAULT_MODEL || "gpt-4o-mini").trim();

function ensureBase(raw?: string, addV1 = false) {
  if (!raw) return "";
  let url = raw.trim().replace(/\/+$/, "");
  if (addV1 && !/\/v1$/i.test(url)) url += "/v1";
  return url;
}

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function isModelNotFound(txt: string) {
  return /Model .* not found|Model must be specified/i.test(txt);
}

function toFirewallModel(model?: string) {
  // Multitenant firewall expects provider/model
  let m = (model || DEFAULT_MODEL).trim();
  if (!m.includes("/")) m = `${DEFAULT_PROVIDER}/${m}`;
  return m;
}

function toProxyModel(model?: string) {
  // Proxy expects plain OpenAI slugs (no provider/)
  let m = (model || DEFAULT_MODEL).trim();
  return m.includes("/") ? m.split("/").slice(-1)[0] : m;
}

export async function POST(req: Request) {
  const denied = await authorizePaidRequest(req); if (denied) return denied;
  const started = Date.now();

  // read incoming
  const incoming = boundAIInput(await readPaidJson(req));
  let { model, messages, stream, ...rest } = incoming || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return json({ error: "Missing messages[] in request body" }, 400);
  }

  // ----- 1) Try FIREWALL (only if we have SA_KEY) -----
  if (FW_BASE && SA_KEY) {
    try {
      const firewallBase = ensureBase(FW_BASE, true); // append /v1
      const firewallModel = toFirewallModel(model);
      const res = await fetch(`${firewallBase}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": SA_KEY,
          "x-superagent-api-key": SA_KEY,
          "x-superagent-token": SA_KEY,
          "accept-encoding": "identity",
        },
        body: JSON.stringify({ model: firewallModel, messages, stream: !!stream, ...rest }),
      });

      if (stream && res.ok && res.body) {
        const headers = new Headers(res.headers);
        headers.set("content-encoding", "identity");
        return new Response(res.body, { status: 200, headers });
      }

      const text = await res.text();
      if (res.ok) {
        try { return json(JSON.parse(text), 200); }
        catch { return new Response(text, { status: 200, headers: { "content-type": res.headers.get("content-type") || "application/json" } }); }
      }

      // If firewall says "model not found" or "model must be specified" → try PROXY fallback
      if (isModelNotFound(text)) {
        // fall through to proxy
      } else {
        return json({ error: "Upstream (Superagent Firewall) error", status: res.status, body: text.slice(0, 2000), elapsed_ms: Date.now() - started }, 502);
      }
    } catch (e: any) {
      // if firewall throws network errors, we still may attempt proxy if configured
      // else, bubble the firewall error
      if (!FW_BASE || !OPENAI_KEY) {
        return json({ error: "Firewall call failed", detail: String(e) }, 502);
      }
    }
  }

  // ----- 2) PROXY fallback (requires OPENAI_KEY and a Proxy base) -----
  // In many setups the same env var is used for both (proxy vs firewall).
  // For Proxy mode, Superagent expects /v1 and Authorization: Bearer <OPENAI_KEY>.
  const proxyBase = ensureBase(FW_BASE, true);
  if (!proxyBase || !OPENAI_KEY) {
    return json({
      error: "No usable upstream configured",
      detail: "Firewall has no model mapping and Proxy is not configured. Either configure a model in Superagent Firewall or set OPENAI_API_KEY and SUPERAGENT_PROXY_URL to the Superagent Proxy URL.",
    }, 500);
  }

  try {
    const proxyModel = toProxyModel(model);
    const res = await fetch(`${proxyBase}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${OPENAI_KEY}`,
        "accept-encoding": "identity",
      },
      body: JSON.stringify({ model: proxyModel, messages, stream: !!stream, ...rest }),
    });

    if (stream && res.ok && res.body) {
      const headers = new Headers(res.headers);
      headers.set("content-encoding", "identity");
      return new Response(res.body, { status: 200, headers });
    }

    const text = await res.text();
    if (!res.ok) {
      return json({ error: "Upstream (Superagent Proxy) error", status: res.status, body: text.slice(0, 2000), elapsed_ms: Date.now() - started }, 502);
    }
    try { return json(JSON.parse(text), 200); }
    catch { return new Response(text, { status: 200, headers: { "content-type": res.headers.get("content-type") || "application/json" } }); }
  } catch (e: any) {
    return json({ error: "Proxy fallback failed", detail: String(e) }, 500);
  }
}
