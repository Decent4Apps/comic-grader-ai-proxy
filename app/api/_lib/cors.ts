// app/api/_lib/cors.ts
export function withCORS(
  handler: (req: Request) => Promise<Response> | Response
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-headers": "content-type, authorization, x-bypass-token",
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "cache-control": "no-store",
        },
      });
    }
    const res = await handler(req);
    const headers = new Headers(res.headers);
    headers.set("access-control-allow-origin", "*");
    headers.set("access-control-allow-headers", "content-type, authorization, x-bypass-token");
    headers.set("access-control-allow-methods", "GET, POST, OPTIONS");
    headers.set("cache-control", "no-store");
    return new Response(res.body, { status: res.status, headers });
  };
}
