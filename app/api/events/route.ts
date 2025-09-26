// app/api/events/route.ts
export const runtime = "nodejs";

/**
 * Lightweight CORS helper
 */
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type, authorization, x-bypass-token",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "cache-control": "no-store",
};
const withCors = (res: Response) => {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) h.set(k, v);
  return new Response(res.body, { status: res.status, headers: h });
};
export const OPTIONS = async () => withCors(new Response(null, { status: 204 }));

/**
 * Gate:
 * - In production: require Authorization: Bearer <sessionJWT> (toggleable)
 * - In non-prod: allow dev bypass via X-Bypass-Token === process.env.BYPASS_TOKEN
 */
const isProd =
  process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";
const REQUIRE_AUTH_IN_PROD = process.env.EVENTS_REQUIRE_AUTH === "1";

/** Size limits (tunable via env) */
const MAX_EVENT_BYTES = Number(process.env.EVENTS_MAX_BYTES ?? 250_000); // ~250 KB request cap (body)
const MAX_EVENTS_PER_BATCH = Number(process.env.EVENTS_MAX_COUNT ?? 50); // max events per POST
const MAX_TITLE_LEN = Number(process.env.EVENTS_MAX_TITLE ?? 120);

async function gate(req: Request) {
  const bypass = req.headers.get("x-bypass-token");
  if (!isProd && bypass && process.env.BYPASS_TOKEN && bypass === process.env.BYPASS_TOKEN) return;

  if (isProd && REQUIRE_AUTH_IN_PROD) {
    const auth = req.headers.get("authorization");
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) {
      throw Object.assign(new Error("unauthorized"), { status: 401 });
    }
    // If you already have a JWT verifier used in /api/ai, import and verify here:
    // await verifySessionJWT(token).catch(() => { throw Object.assign(new Error("unauthorized"), { status: 401 }); });
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

function safeJsonParse<T = any>(raw: string): T {
  try {
    return JSON.parse(raw);
  } catch {
    throw Object.assign(new Error("invalid_json"), { status: 400 });
  }
}

/** Minimal validation + normalization */
function validateBatch(obj: any): IncomingEvent[] {
  if (!obj || typeof obj !== "object") {
    throw Object.assign(new Error("bad_request"), { status: 400 });
  }
  const { events } = obj;
  if (!Array.isArray(events)) {
    throw Object.assign(new Error("missing events array"), { status: 400 });
  }
  if (events.length === 0) return [];
  if (events.length > MAX_EVENTS_PER_BATCH) {
    throw Object.assign(new Error("too_many_events"), { status: 413 });
  }

  for (const ev of events) {
    if (!ev || typeof ev !== "object") {
      throw Object.assign(new Error("invalid_event"), { status: 400 });
    }
    if (!ev.name || typeof ev.name !== "string") {
      throw Object.assign(new Error("invalid_event_name"), { status: 400 });
    }
    if (ev.name.length > MAX_TITLE_LEN) {
      ev.name = ev.name.slice(0, MAX_TITLE_LEN);
    }
    // Prevent absurdly large props; keep request bodies small
    if (ev.props && typeof ev.props === "object") {
      // Remove functions/undefined/cycles by re-serializing
      try {
        ev.props = JSON.parse(JSON.stringify(ev.props));
      } catch {
        ev.props = { _dropped: true };
      }
    }
  }
  return events as IncomingEvent[];
}

/** Stub storage (logs only) */
async function storeEvents(events: IncomingEvent[]) {
  // Wire Neon/Supabase later; for now just log counts/first/last
  console.log(`[events] received ${events.length}`, {
    first: events[0]?.name,
    last: events.at(-1)?.name,
  });
}

export const GET = async () =>
  withCors(
    new Response(
      JSON.stringify({ ok: true, message: "events endpoint ready" }),
      { status: 200, headers: { "content-type": "application/json" } }
    )
  );

export const POST = async (req: Request) => {
  try {
    await gate(req);

    // Read raw first to measure actual size
    const raw = await req.text();
    const byteLen = Buffer.byteLength(raw, "utf8");
    if (byteLen > MAX_EVENT_BYTES) {
      // Hard fail early so the client learns to split batches
      return withCors(
        new Response(
          JSON.stringify({ error: "batch_too_large", maxBytes: MAX_EVENT_BYTES, got: byteLen }),
          { status: 413, headers: { "content-type": "application/json" } }
        )
      );
    }

    const body = safeJsonParse<any>(raw);
    const events = validateBatch(body);

    await storeEvents(events);

    return withCors(
      new Response(
        JSON.stringify({ ok: true, received: events.length, ts: new Date().toISOString() }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
  } catch (err: any) {
    const status =
      (err?.status && Number.isInteger(err.status) && err.status >= 400 && err.status < 600)
        ? err.status
        : 500;
    return withCors(
      new Response(
        JSON.stringify({ error: err?.message || "server_error" }),
        { status, headers: { "content-type": "application/json" } }
      )
    );
  }
};
