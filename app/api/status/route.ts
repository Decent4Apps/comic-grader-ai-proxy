export const runtime = "edge";

function hasV1(url?: string) {
  if (!url) return false;
  const clean = url.trim().replace(/\/+$/, "");
  return /\/v1$/.test(clean);
}

export async function GET() {
  const env = {
    SUPERAGENT_PROXY_URL: !!process.env.SUPERAGENT_PROXY_URL,
    SUPERAGENT_PROXY_URL_value: (process.env.SUPERAGENT_PROXY_URL || "").replace(
      /(firewall\.superagent\.sh\/[^/]+)\/?.*$/i,
      "$1/…"
    ),
    OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
    DEFAULT_MODEL: (process.env.DEFAULT_MODEL || "gpt-4o-mini") as string,
    urlHasV1Suffix: hasV1(process.env.SUPERAGENT_PROXY_URL),
  };

  const missing = [];
  if (!env.SUPERAGENT_PROXY_URL) missing.push("SUPERAGENT_PROXY_URL");
  if (!env.OPENAI_API_KEY) missing.push("OPENAI_API_KEY");

  const status = missing.length ? 500 : 200;

  return new Response(
    JSON.stringify(
      {
        status,
        ok: status === 200,
        env,
        missing,
        hints: [
          "SUPERAGENT_PROXY_URL must end with /v1 exactly once (no double /v1).",
          "OPENAI_API_KEY must be a valid OpenAI key (starts with sk-).",
        ],
      },
      null,
      2
    ),
    { status, headers: { "content-type": "application/json" } }
  );
}
