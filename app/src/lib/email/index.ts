import type { EmailProvider, SendEmailInput, SendEmailResult } from "./types";
import { consoleProvider } from "./providers/console";
import { smtpProvider } from "./providers/smtp";

export type { SendEmailInput, SendEmailResult, EmailProvider };

/**
 * Single switch point for email delivery. Add new providers under
 * ./providers/* (e.g. resend.ts using RESEND_API_KEY) and select them here
 * via EMAIL_PROVIDER. Defaults to the console provider, which is a safe no-op.
 */
function getProvider(): EmailProvider {
  switch (process.env.EMAIL_PROVIDER) {
    // case "resend": return resendProvider;
    case "smtp":
      return smtpProvider;
    default:
      return consoleProvider;
  }
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  return getProvider().sendEmail(input);
}
