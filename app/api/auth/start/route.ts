import { withCORS } from "@/src/lib/cors";
import { db } from "@/src/db/client";
import { otpCodes, users } from "@/src/db/schema";
import { Resend } from "resend";

export const runtime = "nodejs";

export const POST = withCORS(async (req) => {
  const { email } = await req.json();
  if (!email) return Response.json({ error: "email required" }, { status: 400 });

  const code = (Math.floor(100000 + Math.random() * 900000)).toString();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

  await db.insert(otpCodes).values({ email, code, expiresAt });

  const resend = new Resend(process.env.RESEND_API_KEY!);
  await resend.emails.send({
    from: "noreply@yourdomain",
    to: email,
    subject: "Your login code",
    text: `Code: ${code}`
  });

  return Response.json({ ok: true });
});
