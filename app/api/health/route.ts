// app/api/health/route.ts
import { withCORS } from "@/src/lib/cors";
export const runtime = "nodejs";

export const GET = withCORS(async () => {
  return Response.json({
    ok: true,
    service: "comic-grader-proxy",
    env: {
      db: !!process.env.DATABASE_URL,
      auth: !!process.env.AUTH_JWT_SECRET,
      openai: !!process.env.OPENAI_API_KEY,
      anthropic: !!process.env.ANTHROPIC_API_KEY,
      firecrawl: !!process.env.FIRECRAWL_API_KEY,
      superagentProxy: !!process.env.SUPERAGENT_PROXY_URL
    },
    ts: new Date().toISOString()
  });
});
