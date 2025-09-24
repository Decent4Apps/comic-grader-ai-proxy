// src/lib/http.ts
import { PROXY_URL, BYPASS_TOKEN, IS_PREVIEW, assertProxyConfigured } from "./env";

export async function pingProxy() {
  assertProxyConfigured();
  const url = `${PROXY_URL}/api/health`;
  const res = await fetch(url, { method: "GET", headers: { accept: "application/json" } });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text, vercelId: res.headers.get("x-vercel-id") };
}

export async function postJSON(
  path: string,
  body: unknown,
  opts?: { jwt?: string }
) {
  assertProxyConfigured();
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts?.jwt) headers["authorization"] = `Bearer ${opts.jwt}`;
  else if (IS_PREVIEW && BYPASS_TOKEN) headers["x-bypass-token"] = BYPASS_TOKEN;

  const res = await fetch(`${PROXY_URL}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* keep raw text */ }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} – ${json ? JSON.stringify(json) : text}`);
  }
  return json ?? { ok: true };
}
