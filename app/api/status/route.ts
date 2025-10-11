// app/api/status/route.ts
export const runtime = 'edge';

export async function GET() {
  const vars = {
    SUPERAGENT_PROXY_URL: !!process.env.SUPERAGENT_PROXY_URL,
    SUPERAGENT_API_KEY: !!process.env.SUPERAGENT_API_KEY,
    DEFAULT_MODEL: process.env.DEFAULT_MODEL || 'gpt-4o-mini',
    ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY,
  };

  const missing = Object.entries(vars)
    .filter(([k, v]) => !v && k !== 'DEFAULT_MODEL')
    .map(([k]) => k);

  const status = missing.length ? 500 : 200;

  return new Response(
    JSON.stringify(
      {
        status,
        ok: vars,
        missing,
        SUPERAGENT_PROXY_URL_preview: (process.env.SUPERAGENT_PROXY_URL || '').replace(/(firewall\.superagent\.sh\/)[^/]+/, '$1<config_id>'),
      },
      null,
      2
    ),
    { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } }
  );
}
