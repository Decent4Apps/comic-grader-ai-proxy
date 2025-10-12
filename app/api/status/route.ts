// app/api/status/route.ts
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

function normalizeBase(raw?: string) {
  if (!raw) return '';
  let url = raw.trim().replace(/\/+$/, '');
  if (!/\/v1$/i.test(url)) url += '/v1';
  return url;
}

function j(data: any, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export async function GET() {
  const SUPERAGENT_PROXY_URL = normalizeBase(process.env.SUPERAGENT_PROXY_URL);
  const SUPERAGENT_API_KEY = (process.env.SUPERAGENT_API_KEY || '').trim();
  const DEFAULT_MODEL = process.env.DEFAULT_MODEL || 'gpt-4o-mini';

  const missing: string[] = [];
  if (!SUPERAGENT_PROXY_URL) missing.push('SUPERAGENT_PROXY_URL');
  if (!SUPERAGENT_API_KEY) missing.push('SUPERAGENT_API_KEY');

  const status = missing.length ? 500 : 200;

  // Optionally, do a cheap upstream ping if configured
  let upstreamOk: null | boolean = null;
  let upstreamStatus: number | null = null;
  let upstreamErr: string | null = null;

  if (status === 200) {
    try {
      const res = await fetch(`${SUPERAGENT_PROXY_URL}/models`, {
        method: 'GET',
        headers: {
          'x-api-key': SUPERAGENT_API_KEY,
          'x-superagent-api-key': SUPERAGENT_API_KEY,
          'x-superagent-token': SUPERAGENT_API_KEY,
          'accept-encoding': 'identity',
        },
      });
      upstreamStatus = res.status;
      upstreamOk = res.ok;
      if (!res.ok) {
        upstreamErr = (await res.text()).slice(0, 500);
      }
    } catch (e: any) {
      upstreamOk = false;
      upstreamErr = String(e);
    }
  }

  return j({
    ok: status === 200,
    missing,
    env: {
      DEFAULT_MODEL,
      SUPERAGENT_PROXY_URL_SET: !!SUPERAGENT_PROXY_URL,
      SUPERAGENT_API_KEY_SET: !!SUPERAGENT_API_KEY,
    },
    upstream: { ok: upstreamOk, status: upstreamStatus, err: upstreamErr },
  }, status);
}
