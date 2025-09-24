// src/lib/env.ts
const RAW = (process.env.EXPO_PUBLIC_PROXY_URL || "").trim();

function normalizeUrl(url: string) {
  return url.replace(/\/+$/, "");
}

export const PROXY_URL = normalizeUrl(RAW);

export const IS_PREVIEW =
  (process.env.EXPO_PUBLIC_ENVIRONMENT || "").toLowerCase() === "preview";

export const BYPASS_TOKEN = process.env.EXPO_PUBLIC_BYPASS_TOKEN || "";

export function assertProxyConfigured() {
  if (!PROXY_URL || /your-vercel-app/.test(PROXY_URL)) {
    throw new Error(
      "Proxy URL is not configured. Set EXPO_PUBLIC_PROXY_URL to your real Vercel URL."
    );
  }
}
