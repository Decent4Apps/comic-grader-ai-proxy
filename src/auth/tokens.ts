// src/auth/tokens.ts
// Minimal token gate for /api/ai in production.
// Replace with your real JWT verification when ready.
export async function verifySessionJWT(token: string): Promise<void> {
  if (!token || token.length < 16) throw new Error("invalid token");
  // Example (real check):
  // import { jwtVerify } from "jose";
  // await jwtVerify(token, new TextEncoder().encode(process.env.JWT_PUBLIC_KEY!));
}
