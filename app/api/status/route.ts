// app/api/status/route.ts
export const runtime = "nodejs";

function hasV1(url?: string) {
  if (!url) return false;
  const clean = url.trim().replace(/\/+$/, "");
  return /\/v1$/i.test(clean);
}

export async function GET() {
  const env = {
    SUPERAGENT_PROXY_URL_present: !!process.env.SUPERAGENT_PROXY_URL,
    SUPERAGENT_PROXY_URL_preview:
      (process.env.SUPERAGENT_PROXY_URL || "").replace(
        /(firewall\.superagent\.sh\/[^/]+)\/?.*$/i,
        "$1/…"
      ) || null,
    urlHasV1Suffix: hasV1(process.env.SUPERAGENT_PROXY_URL),
    OPENAI_API_KEY_present: !!process.env.OPENAI_API_KEY,
    DEFAULT_MODEL: process.env.DEFAULT_MODEL || "gpt-4o-mini",
    runtime: "nodejs",
  };

  const missing: string[] = [];
  if (!env.SUPERAGENT_PROXY_URL_present) missing.push("SUPERAGENT_PROXY_URL");
  if (!env.OPENAI_API_KEY_present) missing.push("OPENAI_API_KEY");

  const status = missing.length ? 500 : 200;

  return new Response(
    JSON.stringify(
      {
        status,
        ok: status === 200,
        env,
        missing,
        hints: [
          "SUPERAGENT_PROXY_URL may be set to https://firewall.superagent.sh/<FIREWALL_ID> (we add /v1 automatically).",
          "OPENAI_API_KEY must be a valid OpenAI key (starts with sk-).",
          "Check Vercel logs for detailed upstream errors from /api/ai.",
        ],
      },
      null,
      2
    ),
    { status, headers: { "content-type": "application/json" } }
  );
}
