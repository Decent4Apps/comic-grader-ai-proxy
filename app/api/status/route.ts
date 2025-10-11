// app/api/status/route.ts
export const runtime = 'edge';

function normalizeBase(raw?: string) {
  if (!raw) return '';
  let url = raw.trim().replace(/\/+$/, '');
  if (!/\/v1$/i.test(url)) url += '/v1';
  return url;
}

export async function GET() {
  const base = normalizeBase(process.env.SUPERAGENT_PROXY_URL);
  const key = (process.env.SUPERAGENT_API_KEY || '').trim();

  const ok = {
    SUPERAGENT_PROXY_URL: !!base,
    SUPERAGENT_API_KEY: !!key,
    DEFAULT_MODEL: process.env.DEFAULT_MODEL || 'gpt-4o-mini',
    ANTHROPIC_API_KEY: !!(process.env.ANTHROPIC_API_KEY || '').trim(),
  };

  const ai_ready = ok.SUPERAGENT_PROXY_URL && ok.SUPERAGENT_API_KEY;
  const missing = Object.entries(ok)
    .filter(([k, v]) => !v && k !== 'DEFAULT_MODEL')
    .map(([k]) => k);

  const status = ai_ready ? 200 : 500;

  return new Response(
    JSON.stringify(
      {
        status,
        ai_ready,
        ok,
        missing,
        SUPERAGENT_PROXY_URL_preview: (base || '').replace(
          /(firewall\.superagent\.sh\/)[^/]+/,
          '$1<config_id>'
        ),
      },
      null,
      2
    ),
    { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } }
  );
}
