// api/ai.ts — Classic Vercel Serverless Function fallback for /api/ai
import type { VercelRequest, VercelResponse } from "@vercel/node";

function need(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

const cors = {
  "Access-Control-Allow-Origin": process.env.ALLOW_ORIGIN || "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", cors["Access-Control-Allow-Origin"]);
    res.setHeader("Access-Control-Allow-Headers", cors["Access-Control-Allow-Headers"]);
    res.setHeader("Access-Control-Allow-Methods", cors["Access-Control-Allow-Methods"]);
    return res.status(204).send("");
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const auth = req.headers.authorization || "";
    if (!auth.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Missing bearer token" });
    }

    const { model, messages, stream = false, ...rest } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({
        error:
          "Invalid 'messages'. Use: { model:'gpt-4o-mini', messages:[{ role:'user', content:'Hello'}] }",
      });
    }

    const base = need("OPENAI_BASE_URL").replace(/\/+$/, ""); // must include /v1
    const url = `${base}/chat/completions`;

    const upstream = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${need("OPENAI_API_KEY")}`, // sk_...
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model, messages, stream, ...rest }),
    });

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => upstream.statusText);
      console.error("[proxy-upstream]", upstream.status, detail);
      return res.status(502).json({ error: "Upstream error", status: upstream.status, detail });
    }

    // Forward JSON or stream — classic functions can’t stream reliably; return JSON
    const data = await upstream.json();
    res.setHeader("Access-Control-Allow-Origin", cors["Access-Control-Allow-Origin"]);
    res.setHeader("X-Proxy-Upstream", "superagent-proxy");
    return res.status(200).json(data);
  } catch (e: any) {
    console.error("[ai-fn-error]", e);
    return res.status(500).json({ error: "AI proxy error", detail: e?.message || String(e) });
  }
}
