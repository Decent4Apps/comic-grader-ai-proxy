import { authorizePaidRequest, readPaidJson, boundAIInput } from "../../../../lib/paid-security.mjs";
// app/api/ai/selftest/route.ts
/**
 * Sanity route: sends a 1-line prompt through Superagent Firewall
 * Returns upstream result or a clear env error
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

function normalizeBase(raw?: string) {
  if (!raw) return '';
  let url = raw.trim().replace(/\/+$/, '');
  if (!/\/v1$/i.test(url)) url += '/v1';
  return url;
}

const SUPERAGENT_PROXY_URL = normalizeBase(process.env.SUPERAGENT_PROXY_URL);
const SUPERAGENT_API_KEY = (process.env.SUPERAGENT_API_KEY || '').trim();
const DEFAULT_MODEL = process.env.DEFAULT_MODEL || 'gpt-4o-mini';

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export async function GET(req: Request) {
  const denied = await authorizePaidRequest(req); if (denied) return denied;
  if (!SUPERAGENT_PROXY_URL || !SUPERAGENT_API_KEY) {
    return json({
      ok: false,
      ai_ready: false,
      missing: {
        SUPERAGENT_PROXY_URL: !SUPERAGENT_PROXY_URL,
        SUPERAGENT_API_KEY: !SUPERAGENT_API_KEY,
      },
    }, 500);
  }

  const url = `${SUPERAGENT_PROXY_URL}/chat/completions`;
  const body = {
    model: DEFAULT_MODEL,
    stream: false,
    messages: [{ role: 'user', content: 'ping' }],
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      // IMPORTANT: no Authorization: Bearer sa_...
      'x-api-key': SUPERAGENT_API_KEY,
      'x-superagent-api-key': SUPERAGENT_API_KEY,
      'x-superagent-token': SUPERAGENT_API_KEY,
      'content-type': 'application/json',
      'accept': 'application/json',
      'accept-encoding': 'identity',
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  try {
    const data = JSON.parse(text);
    return json({ ok: true, ai_ready: true, upstream_status: res.status, data: { id: data.id, model: data.model } }, res.ok ? 200 : res.status);
  } catch {
    return json({ ok: false, ai_ready: false, upstream_status: res.status, raw: text.slice(0, 200) }, res.status);
  }
}
