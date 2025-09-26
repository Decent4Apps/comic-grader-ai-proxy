// src/auth/tokens.ts
import crypto from "node:crypto";

type JWTPayload = Record<string, any>;

function b64url(obj: any) {
  return Buffer.from(typeof obj === "string" ? obj : JSON.stringify(obj)).toString("base64url");
}
function b64urlJSON<T = any>(segment: string): T {
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
}
function requireSecret(): string {
  const secret = process.env.AUTH_JWT_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new Error("missing JWT secret (set AUTH_JWT_SECRET)");
  if (secret.length < 16) throw new Error("JWT secret too short (use 32+ random bytes)");
  return secret;
}

// Issue short-lived HS256 session token
export async function createSessionJWT(
  claims: { sub: string; scope?: string; aud?: string; iss?: string },
  ttlSeconds = 3600
): Promise<string> {
  const secret = requireSecret();
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload: JWTPayload = {
    sub: claims.sub,
    scope: claims.scope ?? "app",
    aud: claims.aud ?? "app",
    iss: claims.iss ?? "comic-grader-ai-proxy",
    iat: now,
    exp: now + Math.max(60, Math.min(ttlSeconds, 24 * 3600)),
  };
  const h = b64url(header);
  const p = b64url(payload);
  const s = crypto.createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url");
  return `${h}.${p}.${s}`;
}

// Verify signature + expiry
export async function verifySessionJWT(token: string): Promise<void> {
  const secret = requireSecret();
  if (!token || typeof token !== "string") throw new Error("invalid token");
  const [h, p, s] = token.split(".");
  if (!h || !p || !s) throw new Error("invalid token");
  const expected = crypto.createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url");
  if (s !== expected) throw new Error("bad signature");
  const payload = b64urlJSON<Record<string, any>>(p);
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && now >= payload.exp) throw new Error("token expired");
}

// Optional: decode payload (no verify)
export function decodeSessionJWT<T = any>(token: string): T | null {
  try { return b64urlJSON
