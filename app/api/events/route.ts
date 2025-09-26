// app/api/events/route.ts
import { withCORS, preflight } from "../_lib/cors";

export const runtime = "nodejs";

const MAX_EVENT_BYTES = Number(process.env.EVENTS_MAX_BYTES ?? 250_000); // ~250 KB
const MAX_EVENTS_PER_BATCH = Number(process.env.EVENTS_MAX_COUNT ?? 50);

type IncomingEvent = {
  name: string;
  props?: Record<string, any>;
  timestamp?: number;
  eventId?: string;
  deviceId?: string;
  platform?: string;
  appVersion?: string;
};

export const GET = withCORS(async () =>
  new Response(JSON.stringify({ ok: true, message: "events endpoint ready" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
);

export const POST = withCORS(async (req) => {
  try {
    const raw = await req.text();
    if (new TextEncoder().encode(raw).length > MAX_EVENT_BYTES) {
      return new Response(JSON.stringify({ error: "batch_too_large" }), { status: 413 });
    }
    const body = JSON.parse(raw || "{}");
    const arr = Array.isArray(body?.events) ? (body.events as IncomingEvent[]) : [];
    if (arr.length > MAX_EVENTS_PER_BATCH) {
      return new Response(JSON.stringify({ error: "too_many_events" }), { status: 413 });
    }
    for (const ev of arr) {
      if (!ev?.name || typeof ev.name !== "string") {
        return new Response(JSON.stringify({ error: "invalid_event" }), { status: 400 });
      }
    }
    console.log(`[events] received ${arr.length}`, {
      first: arr[0]?.name,
      last: arr.at(-1)?.name,
    });
    return new Response(JSON.stringify({ ok: true, received: arr.length }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "server_error" }), { status: 500 });
  }
});

export const OPTIONS = preflight;
