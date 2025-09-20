import { db } from '@/src/db/client';
import { otpCodes, users } from '@/src/db/schema';
import { eq, and, gt } from 'drizzle-orm';
import { withCORS } from '@/src/lib/cors';
import { createSessionJWT } from '@/src/auth/tokens';

export const POST = withCORS(async (req) => {
  const { email, code } = await req.json();
  if (!email || !code) return Response.json({ error: 'email and code required' }, { status: 400 });

  const now = new Date();
  const rows = await db.select().from(otpCodes).where(and(eq(otpCodes.email, email), eq(otpCodes.code, code), gt(otpCodes.expiresAt, now)));
  if (!rows.length) return Response.json({ error: 'invalid code' }, { status: 401 });

  let user = (await db.select().from(users).where(eq(users.email, email)))[0];
  if (!user) {
    const inserted = await db.insert(users).values({ email }).returning();
    user = inserted[0];
  }

  const token = await createSessionJWT(user.id);
  return Response.json({ token, user: { id: user.id, email: user.email } });
});
