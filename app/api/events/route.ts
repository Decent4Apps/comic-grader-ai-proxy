// app/api/events/route.ts
import { withCORS } from "../_lib/cors"; // use the local CORS helper to avoid path alias issues

export const runtime = "nodejs";

/**
 * Simple gate:
 * - In production: require Authorization: Bearer <sessionJWT>
 *   (If you want to mirror your /api/ai gate, you can import verifySessionJWT.)
 * - In non-production: allow dev bypass via X-Bypass-Token matching process.env.BYPASS_TOKEN,
 *   otherwise fall back to allowing unauthenticated (toggleable).
 */
const isProd =
  process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";

async function gate(req: Request) {
  // Dev bypass
  const bypass = req.headers.get("x-bypass-token");
  if (!isProd && bypass && process.env.BYPASS_TOKEN && bypass === process.env.BYPASS_TOKEN) return;

  // Optional: require auth in prod
  if (isProd) {
    const auth = req.headers.get("authorization");
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) {
      throw Object.assign(new Error("unauthorized"), { status: 401 });
    }
    // If you want full signature verification like /api/ai, uncomment:
    // import { verifySessionJWT } from "@/src/auth/tokens";
    // await verifySessionJWT(token).catch(() => {
    //   throw Object.assign(new Error("unauthorized"), { status: 401 });
    // });
  }
}

type IncomingEvent = {
  name: string;
  props?: Record<string, any>;
  platform?: string;
  appVersion?: string;
  deviceId?: string;
  timestamp?: number;
  eventId?: string;
};

type BatchBody = {
  events: IncomingEvent[];
  batchId?: string;
  batchSize?: number;
  batchTimestamp?: number;
};

function ensureBody(obj: any): BatchBody {
  if (!obj || typeof obj !== "object") {
    throw Object.assign(new Error("bad_request"), { status: 400 });
  }
  const { events } = obj;
  if (!Array.isArray(events)) {
    throw Object.assign(new Error("missing events array"), { status: 400 });
  }
  return obj as BatchBody;
}

// In-memory no-op sink (you can later wire this to Neon/Supabase if desired)
async function storeEvents(events: IncomingEvent[]) {
  // Minimal validation; expand as needed
  for (const ev of events) {
    if (!ev?.name || typeof ev.name !== "string") {
      throw Object.assign(new Error("invalid event (missing name)"), { status: 400 });
    }
  }
  // Log to server console for now so you can verify flow in Vercel logs
  console.log(`[events] received ${events.length} event(s)`, {
    first: events[0]?.name,
    last: events.at(-1)?.name,
  });
}

export const POST = withCORS(async (req: Request) => {
  try {
    await gate(req);
    const body = await req.json().catch(() => ({}));
    const { events, batchId, batchSize, batchTimestamp } = ensureBody(body);

    // Optional: sanity check client-declared batchSize
    if (typeof batchSize === "number" && batchSize !== events.length) {
      console.warn(`[events] batchSize mismatch: declared=${batchSize} actual=${events.length}`);
    }

    await storeEvents(events);

    return new Response(
      JSON.stringify({
        ok: true,
        received: events.length,
        batchId: batchId ?? null,
        ts: new Date().toISOString(),
      }),
      { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" } }
    );
  } catch (err: any) {
    const status =
      (err?.status && Number.isInteger(err.status) && err.status >= 400 && err.status < 600)
        ? err.status
        : 500;
    return new Response(
      JSON.stringify({ error: err?.message || "server_error" }),
      { status, headers: { "content-type": "application/json" } }
    );
  }
});

export const GET = withCORS(async () => {
  return new Response(
    JSON.stringify({ ok: true, message: "events endpoint ready" }),
    { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" } }
  );
});

// Handle OPTIONS via withCORS preflight
