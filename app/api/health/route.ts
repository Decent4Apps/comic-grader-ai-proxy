// app/api/health/route.ts
export const runtime = "nodejs";

export const GET = async () => {
  const prod = process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";
  const hasSecret = !!(process.env.AUTH_JWT_SECRET || process.env.JWT_SECRET);
  return new Response(
    JSON.stringify({
      ok: true,
      env: prod ? "production" : "non-production",
      jwtSecret: hasSecret ? "present" : "missing",
      routes: ["/api/health", "/api/auth/anon", "/api/ai", "/api/events", "/api/analyses"],
      ts: new Date().toISOString(),
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
};
