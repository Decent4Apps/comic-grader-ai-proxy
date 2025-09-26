// src/auth/tokens.ts
// Minimal HS256 JWT issue/verify using Node's crypto (no extra deps)
import crypto from "node:crypto";

type JWTPayload = Record<string, any>;

function b64urlEncode(input: string | object): string {
  const str = typeof input === "string" ? input : JSON.stringify(input);
  return Buffer.from(str, "utf8").toString("base64url");
}

function b64urlDecodeJSON<T = any>(segment: string): T {
  const json = Buffer.from(segment, "base64url").toString("utf8");
  return JSON.parse(json);
}

function requireSecret(): string {
  const secret = process.env.AUTH_JWT_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new Error("missing JWT secret (set AUTH_JWT_SECRET)");
  if (secret.length < 16) throw new Error("JWT secret too short (use 32+ chars)");
  return secret;
}

/** Create a short-lived session token for the app */
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

  const h = b64urlEncode(header);
  const p = b64urlEncode(payload);
  const signature = crypto.createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url");
  return `${h}.${p}.${signature}`;
}

/** Verify signature + expiry; throws on failure */
export async function verifySessionJWT(token: string): Promise<void> {
  const secret = requireSecret();
  const parts = token?.split(".") ?? [];
  if (parts.length !== 3) throw new Error("invalid token");

  const [h, p, s] = parts;
  const expected = crypto.createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url");
  if (s !== expected) throw new Error("bad signature");

  const payload = b64urlDecodeJSON<Record<string, any>>(p);
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && now >= payload.exp) throw new Error("token expired");
}

/** Optional: decode payload (no verify) */
export function decodeSessionJWT<T = any>(token: string): T | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    return b64urlDecodeJSON<T>(parts[1]);
  } catch {
    return null;
  }
}
