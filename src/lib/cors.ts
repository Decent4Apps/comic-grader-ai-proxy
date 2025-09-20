export function withCORS(handler: (req: Request) => Promise<Response>) {
  return async (req: Request) => {
    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }
    const res = await handler(req);
    const headers = new Headers(res.headers);
    const ch = corsHeaders();
    ch.forEach((v, k) => headers.set(k, v));
    return new Response(res.body, { status: res.status, headers });
  };
}

function corsHeaders() {
  const origins = process.env.ALLOWED_ORIGINS?.split(",").map(s => s.trim()) ?? ["*"];
  return new Headers({
    "Access-Control-Allow-Origin": origins.includes("*") ? "*" : origins[0],
    "Access-Control-Allow-Headers": "authorization, content-type, x-bypass-token",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
  });
}
