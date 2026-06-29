export interface PasswordResetTemplateInput {
  toEmail: string;
  resetUrl: string;
  homeUrl: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * Password-reset email — sent from our own SMTP (checklisthub.review@gmail.com)
 * with the same look as the collaborator-invite email, instead of Supabase
 * Auth's default mailer/template. The link itself still comes from Supabase
 * (`admin.generateLink({ type: "recovery" })`, see /api/auth/forgot-password) —
 * only the email's delivery and branding are ours.
 */
export function renderPasswordResetEmail(input: PasswordResetTemplateInput): RenderedEmail {
  const { toEmail, resetUrl, homeUrl } = input;
  const subject = "Reset your Checklist Hub password";
  const year = new Date().getFullYear();

  const text = [
    "Checklist Hub is a tool for collaboratively building and reviewing biodiversity checklists.",
    "",
    "We received a request to reset the password for your account.",
    "",
    `Reset your password: ${resetUrl}`,
    "",
    `This link was requested for: ${toEmail}`,
    "",
    "If you didn't request this, you can safely ignore this email — your password won't change.",
    "",
    `© ${year} Checklist Hub`,
    "",
    `Visit Checklist Hub: ${homeUrl}`,
    "",
    "Need help?",
    "checklisthub.review@gmail.com",
  ]
    .filter((line) => line !== "")
    .join("\n");

  const html = `
    <div style="font-family: 'Geist', Arial, Helvetica, sans-serif; color: #1b1c1c; line-height: 1.6; width: 100%; max-width: 560px; margin: 0 auto; padding: 32px 24px; box-sizing: border-box;">

      <p style="margin: 0 0 20px; font-size: 13px; color: #4a4a4a;">
        Checklist Hub is a tool for collaboratively building and reviewing biodiversity checklists.
      </p>

      <p style="margin: 0 0 20px; font-size: 14px; color: #1b1c1c;">
        We received a request to reset the password for your account.
      </p>

      <table style="border-collapse: collapse; margin-bottom: 24px;">
        <tr>
          <td>
            <a href="${escapeHtml(resetUrl)}" style="display: inline-block; background: #c63939; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 2px; font-size: 13px; font-weight: 700;">Reset Password</a>
          </td>
        </tr>
      </table>

      <p style="margin: 0 0 20px; font-size: 12px; color: #6b6b6b; line-height: 1.6;">
        This link was requested for: ${escapeHtml(toEmail)}
      </p>

      <p style="margin: 0 0 20px; font-size: 11px; color: #8d706e; line-height: 1.5;">
        If you didn't request this, you can safely ignore this email — your password won't change.
      </p>

      <p style="margin: 0; font-size: 11px; color: #8d706e; line-height: 1.6;">
        &copy; ${year} Checklist Hub<br /><br />
        <a href="${escapeHtml(homeUrl)}" style="color: #a41f24; text-decoration: none;">Visit Checklist Hub</a><br /><br />
        Need help?<br />
        checklisthub.review@gmail.com
      </p>
    </div>
  `.trim();

  return { subject, html, text };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
