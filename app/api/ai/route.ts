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
  const DEFAULT_MODEL = (process.env.DEFAULT_MODEL || '').trim();

  const missing: string[] = [];
  if (!SUPERAGENT_PROXY_URL) missing.push('SUPERAGENT_PROXY_URL');
  if (!SUPERAGENT_API_KEY) missing.push('SUPERAGENT_API_KEY');
  if (!DEFAULT_MODEL) missing.push('DEFAULT_MODEL');

  const envOk = missing.length === 0;
  let upstreamOk: boolean | null = null;
  let upstreamStatus: number | null = null;
  let upstreamErr: string | null = null;
  let upstreamBody: any = null;

  if (envOk) {
    try {
      const res = await fetch(`${SUPERAGENT_PROXY_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'x-api-key': SUPERAGENT_API_KEY,
          'x-superagent-api-key': SUPERAGENT_API_KEY,
          'x-superagent-token': SUPERAGENT_API_KEY,
          'content-type': 'application/json',
          'accept-encoding': 'identity',
        },
        body: JSON.stringify({
          model: DEFAULT_MODEL, // <-- use your tenant-mapped slug here
          messages: [{ role: 'user', content: 'ping' }],
          stream: false,
        }),
      });

      upstreamStatus = res.status;
      const txt = await res.text();

      try {
        upstreamBody = JSON.parse(txt);
      } catch {
        upstreamBody = txt.slice(0, 500);
      }

      upstreamOk = res.ok;
      if (!res.ok) {
        upstreamErr = typeof upstreamBody === 'string'
          ? upstreamBody
          : JSON.stringify(upstreamBody).slice(0, 500);
      }
    } catch (e: any) {
      upstreamOk = false;
      upstreamErr = String(e);
    }
  }

  const status = !envOk ? 500 : upstreamOk ? 200 : 502;

  return j({
    ok: envOk && !!upstreamOk,
    missing,
    env: {
      DEFAULT_MODEL,
      SUPERAGENT_PROXY_URL_SET: !!SUPERAGENT_PROXY_URL,
      SUPERAGENT_API_KEY_SET: !!SUPERAGENT_API_KEY,
    },
    upstream: { ok: upstreamOk, status: upstreamStatus, err: upstreamErr, body: upstreamBody },
  }, status);
}
