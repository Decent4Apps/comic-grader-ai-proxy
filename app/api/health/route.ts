// app/api/health/route.ts
import { NextRequest } from "next/server";

export const runtime = "edge";

export async function GET(_req: NextRequest) {
  const issues: string[] = [];
  const envOk = !!process.env.SUPERAGENT_API_KEY && !!process.env.SUPERAGENT_BASE_URL;

  if (!envOk) issues.push("Missing SUPERAGENT_API_KEY or SUPERAGENT_BASE_URL");

  // Optional: quick AI self-test (small, cheap)
  let aiOk = false;
  if (envOk) {
    try {
      const r = await fetch(new URL("/api/ai", process.env.NEXT_PUBLIC_BASE_URL || "http://localhost"), {
        // If running on Vercel, you can call the relative path, but for edge runtime we need absolute.
        // Safer approach: hit the same origin using a relative URL from the client. For server-side: skip this call and
        // just return envOk. If you keep it, inject base url via env at build (NEXT_PUBLIC_BASE_URL).
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Provide a limited internal bypass if you support it, else remove auth here.
          // In strict setups, skip AI selftest or require a short-lived service JWT.
        },
        body: JSON.stringify({
          model: process.env.MODEL_DEFAULT || "openai:gpt-4o-mini",
          messages: [{ role: "user", content: "ping" }],
        }),
        cache: "no-store",
      });
      aiOk = r.ok;
      if (!r.ok) issues.push("AI self-test failed");
    } catch {
      issues.push("AI self-test error");
    }
  }

  const ok = envOk && aiOk;

  return new Response(
    JSON.stringify({
      ok,
      envOk,
      aiOk,
      provider: "superagent",
      modelDefault: process.env.MODEL_DEFAULT || "openai:gpt-4o-mini",
      issues,
      ts: new Date().toISOString(),
    }),
    {
      status: ok ? 200 : 500,
      headers: { "Content-Type": "application/json" },
    },
  );
}
