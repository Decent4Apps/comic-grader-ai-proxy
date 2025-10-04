// app/api/health/route.ts
export const runtime = "edge";

export async function GET() {
  const envOk = !!process.env.SUPERAGENT_API_KEY && !!process.env.SUPERAGENT_BASE_URL;
  // No self-call to /api/ai here — your app already probes /api/ai directly.
  return new Response(
    JSON.stringify({
      ok: envOk,
      provider: "superagent",
      ts: new Date().toISOString(),
    }),
    {
      status: envOk ? 200 : 500,
      headers: { "Content-Type": "application/json" },
    },
  );
}
