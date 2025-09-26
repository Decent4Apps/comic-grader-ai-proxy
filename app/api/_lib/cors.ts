// app/api/_lib/cors.ts
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type, authorization, x-bypass-token",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "cache-control": "no-store",
};

export function withCORS(handler: (req: Request) => Promise<Response> | Response) {
  return async (req: Request) => {
    const res = await handler(req);
    const h = new Headers(res.headers);
    Object.entries(CORS).forEach(([k, v]) => h.set(k, v));
    return new Response(res.body, { status: res.status, headers: h });
  };
}

export function preflight() {
  return new Response(null, { status: 204, headers: CORS as Record<string, string> });
}
