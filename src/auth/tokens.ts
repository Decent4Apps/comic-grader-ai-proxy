import { SignJWT, jwtVerify } from 'jose';
const secret = new TextEncoder().encode(process.env.AUTH_JWT_SECRET!);

export async function createSessionJWT(userId: string, ttlHours = 720 /* 30d */) {
  const exp = Math.floor(Date.now() / 1000) + ttlHours * 3600;
  return await new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime(exp)
    .sign(secret);
}

export async function verifySessionJWT(token: string) {
  const { payload } = await jwtVerify(token, secret);
  return payload.sub as string;
}
