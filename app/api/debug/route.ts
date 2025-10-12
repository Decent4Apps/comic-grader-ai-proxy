// app/api/ai/debug/route.ts
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

function normalizeBase(raw?: string) {
  if (!raw) throw new Error('Missing SUPERAGENT_PROXY_URL');
  let url = raw.trim().replace(/\/+$/, '');
  if (!/\/v1$/i.test(url)) url += '/v1';
  return url;
}

function J(data: any, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export async function GET() {
  try {
    const base = normalizeBase(process.env.SUPERAGENT_PROXY_URL);
    const key = (process.env.SUPERAGENT_API_KEY || '').trim();
    if (!key) return J({ error: 'Missing SUPERAGENT_API_KEY' }, 500);

    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'x-superagent-api-key': key,
        'x-superagent-token': key,
        'content-type': 'application/json',
        'accept-encoding': 'identity',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'Say "ok"' }],
        stream: false,
      }),
    });

    const txt = await res.text();
    return J({
      ok: res.ok,
      status: res.status,
      body: res.ok ? JSON.parse(txt) : txt.slice(0, 500),
    }, res.ok ? 200 : 502);
  } catch (e: any) {
    return J({ error: 'debug failed', detail: String(e) }, 500);
  }
}
