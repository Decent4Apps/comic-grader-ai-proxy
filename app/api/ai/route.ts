export const runtime = "nodejs";

export async function POST(req: Request) {
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return new Response(JSON.stringify({ error: "missing bearer token" }), { status: 401 });

  const body = await req.json();
  if (!Array.isArray(body?.messages) || body.messages.length === 0) {
    return new Response(JSON.stringify({ error: "Invalid 'messages'" }), { status: 400 });
  }

  const base = process.env.SUPERAGENT_PROXY_URL!;
  const key  = process.env.SUPERAGENT_API_KEY!;
  const url  = `${base.replace(/\/+$/, "")}/v1/chat/completions`;

  const upstream = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${key}`, // many routes accept Bearer
      "x-api-key": key,                 // some expect x-api-key — send both
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => upstream.statusText);
    return new Response(JSON.stringify({ error: "Upstream (Superagent) error", status: upstream.status, detail }), {
      status: 502, headers: { "Content-Type": "application/json" },
    });
  }

  const headers = new Headers(upstream.headers);
  headers.delete("content-length"); headers.delete("transfer-encoding");
  headers.set("Access-Control-Allow-Origin", process.env.ALLOW_ORIGIN || "*");
  headers.set("Content-Type", upstream.headers.get("content-type") || "application/json; charset=utf-8");

  return new Response(upstream.body, { status: upstream.status, headers });
}
