import { after, NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import { sendEmail } from "@/lib/email";
import { renderPasswordResetEmail } from "@/lib/email/templates/passwordReset";

/**
 * POST /api/auth/forgot-password
 *
 * Sends the password-reset email ourselves (via our SMTP, branded like the
 * collaborator-invite email) instead of using `supabase.auth.resetPasswordForEmail`,
 * which sends Supabase's own default-branded email through Supabase's mailer.
 * `admin.generateLink({ type: "recovery" })` still does the real work of
 * minting the one-time reset token — only delivery (and the link shape) is ours.
 *
 * The email link points at our own /reset-password page with a `token_hash`
 * query param, NOT at Supabase's hosted `/auth/v1/verify` GET-and-redirect
 * link (`action_link`). That hosted link auto-consumes the one-time token on
 * the first GET request to it — which email clients' link-scanning/prefetch
 * (Gmail, Outlook Safe Links, antivirus link checkers, etc.) does before the
 * user ever clicks, burning the token and producing "otp_expired" the moment
 * the real user clicks. Routing through our own page instead means the token
 * is only consumed when `verifyOtp` runs client-side in reset-password/page.tsx
 * — prefetchers fetch the HTML, they don't execute the JS that calls it.
 *
 * Always responds 200 immediately (even if the email doesn't match an
 * account) to avoid leaking which emails are registered through this
 * endpoint. The actual work — the Supabase admin API round trip plus the SMTP
 * send (a fresh TLS handshake to Gmail every time, easily 1-3s) — runs via
 * `after()` once the response has already gone out, so the popup doesn't sit
 * waiting on either of them.
 *
 * Body: { email: string }
 */
export async function POST(request: NextRequest) {
  let body: { email?: string };
  try {
    body = (await request.json()) as { email?: string };
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase();
  if (!email) {
    return NextResponse.json({ error: "email is required." }, { status: 400 });
  }

  const origin = request.nextUrl.origin;

  after(async () => {
    const supabase = createServiceClient();
    const { data, error } = await supabase.auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo: `${origin}/reset-password` },
    });

    if (error || !data.properties?.hashed_token) return;

    const resetUrl = `${origin}/reset-password?token_hash=${data.properties.hashed_token}&type=recovery`;
    const rendered = renderPasswordResetEmail({ toEmail: email, resetUrl, homeUrl: origin });
    try {
      await sendEmail({ to: email, ...rendered });
    } catch (err) {
      console.error("Failed to send password-reset email to %s:", email, err);
    }
  });

  return NextResponse.json({ ok: true });
}
