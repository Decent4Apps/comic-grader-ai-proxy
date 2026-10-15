import { authorizePaidRequest, readPaidJson, boundAIInput } from "../../../../lib/paid-security.mjs";
// app/api/ai/models/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

function normalizeBase(raw?: string) {
  if (!raw) throw new Error("Missing SUPERAGENT_PROXY_URL");
  let url = raw.trim().replace(/\/+$/, "");
  if (!/\/v1$/i.test(url)) url += "/v1";
  return url;
}

function J(data: any, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export async function GET(req: Request) {
  const denied = await authorizePaidRequest(req); if (denied) return denied;
  try {
    const base = normalizeBase(process.env.SUPERAGENT_PROXY_URL);
    const key = (process.env.SUPERAGENT_API_KEY || "").trim();
    if (!key) return J({ error: "Missing SUPERAGENT_API_KEY" }, 500);

    // Try OpenAI-compatible /models first
    const res = await fetch(`${base}/models`, {
      method: "GET",
      headers: {
        "x-api-key": key,
        "x-superagent-api-key": key,
        "x-superagent-token": key,
        "accept-encoding": "identity",
      },
    });

    const text = await res.text();
    if (!res.ok) {
      // Some firewalls may not expose /models; surface the raw text for debugging
      return J({
        ok: false,
        status: res.status,
        body: text.slice(0, 2000),
        hint: "If this endpoint is disabled, define at least one model mapping in the Superagent dashboard for this firewall config.",
      }, 502);
    }

    // Return parsed if possible, otherwise raw
    try {
      return J(JSON.parse(text), 200);
    } catch {
      return J({ ok: true, raw: text.slice(0, 2000) }, 200);
    }
  } catch (e: any) {
    return J({ error: "models probe failed", detail: String(e) }, 500);
  }
}
