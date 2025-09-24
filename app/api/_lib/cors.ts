// app/api/_lib/cors.ts
export function withCORS(
  handler: (req: Request) => Promise<Response> | Response
) {
  return async (req: Request) => {
    const origin = req.headers.get("origin") ?? "*";

    // Handle preflight quickly
    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": origin,
          "access-control-allow-methods": "GET,POST,OPTIONS",
          "access-control-allow-headers":
            "authorization,content-type,x-bypass-token",
          "access-control-max-age": "86400",
        },
      });
    }

    // Normal request
    const res = await handler(req);
    const h = new Headers(res.headers);
    h.set("access-control-allow-origin", origin);
    h.set("vary", "origin");
    return new Response(res.body, { status: res.status, headers: h });
  };
}
