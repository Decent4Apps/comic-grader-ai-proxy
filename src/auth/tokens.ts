// src/auth/tokens.ts
// Minimal HS256 JWT issue + verify using Node's crypto (no external deps)
import crypto from "node:crypto";

function b64urlEncode(obj: any) {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}
function b64urlDecode<T = any>(b64url: string): T {
  return JSON.parse(Buffer.from(b64url, "base64url").toString("utf8"));
}

function requireSecret(): string {
  const secret = process.env.AUTH_JWT_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new Error("missing JWT secret (set AUTH_JWT_SECRET)");
  return secret;
}

export async function createSessionJWT(
  claims: Record<string, any>,
  ttlSeconds = 3600
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    iat: now,
    exp: now + ttlSeconds,
    iss: "comic-grader-ai-proxy",
    ...claims
  };

  const secret = requireSecret();
  const h = b64urlEncode(header);
  const p = b64urlEncode(payload);
  const sig = crypto.createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url");
  return `${h}.${p}.${sig}`;
}

export async function verifySessionJWT(token: string): Promise<void> {
  const secret = requireSecret();
  if (!token || typeof token !== "string") throw new Error("invalid token");
  const [h, p, s] = token.split(".");
  if (!h || !p || !s) throw new Error("invalid token");

  const expected = crypto.createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url");
  if (s !== expected) throw new Error("bad signature");

  const payload = b64urlDecode<Record<string, any>>(p);
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && now >= payload.exp) throw new Error("token expired");
}
