// src/lib/auth.ts
import { postJSON } from "./http";

let cachedToken: string | null = null;
let cachedExp: number | null = null;

export async function getServerToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedExp && now < cachedExp - 30) return cachedToken;

  const r = await fetchAnonToken();
  cachedToken = r.token;
  cachedExp = r.expiresAt ?? r.expiresIn ? now + Number(r.expiresIn) : now + 3600;
  return cachedToken!;
}

export async function fetchAnonToken(): Promise<{ token: string; expiresIn?: number; expiresAt?: number }> {
  const res = await fetch("/api/auth/anon-relay", { method: "GET" } as any).catch(() => null);
  // If you don't have a relay, call the proxy directly:
  if (!res) {
    return await postJSON("/api/auth/anon", {});
  }
  return (await res!.json()) as any;
}
