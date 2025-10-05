export const runtime = "edge";

export async function GET() {
  const ok = {
    SUPERAGENT_PROXY_URL: !!process.env.SUPERAGENT_PROXY_URL,
    SUPERAGENT_AUTH_MODE: (process.env.SUPERAGENT_AUTH_MODE || "openai") as string,
    OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
    SUPERAGENT_PROXY_KEY: !!process.env.SUPERAGENT_PROXY_KEY,
    DEFAULT_MODEL: (process.env.DEFAULT_MODEL || "gpt-4o-mini") as string,
  };

  const using =
    ok.SUPERAGENT_AUTH_MODE === "proxy"
      ? "proxy-key"
      : "openai-key";

  const missing = Object.entries({
    SUPERAGENT_PROXY_URL: ok.SUPERAGENT_PROXY_URL,
    ...(using === "proxy-key"
      ? { SUPERAGENT_PROXY_KEY: ok.SUPERAGENT_PROXY_KEY }
      : { OPENAI_API_KEY: ok.OPENAI_API_KEY }),
  })
    .filter(([, v]) => !v)
    .map(([k]) => k);

  const status =
    !ok.SUPERAGENT_PROXY_URL ||
    (using === "proxy-key" && !ok.SUPERAGENT_PROXY_KEY) ||
    (using === "openai-key" && !ok.OPENAI_API_KEY)
      ? 500
      : 200;

  return new Response(
    JSON.stringify(
      {
        status,
        using,
        ok,
        missing,
        hint:
          using === "proxy-key"
            ? "Expect Authorization: Bearer <SUPERAGENT_PROXY_KEY>"
            : "Expect Authorization: Bearer <OPENAI_API_KEY> (OpenAI-compat passthrough)",
      },
      null,
      2
    ),
    { status, headers: { "content-type": "application/json" } }
  );
}
