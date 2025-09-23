// src/auth/tokens.ts
// Minimal “auth” shim so /api/ai can require a bearer in prod
export async function verifySessionJWT(token: string): Promise<void> {
  if (!token || token.length < 16) throw new Error("invalid token");
  // If you have real JWT validation, replace this with your check (e.g. jose.verify)
}
