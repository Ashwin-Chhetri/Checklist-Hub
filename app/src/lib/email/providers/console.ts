import type { EmailProvider, SendEmailInput, SendEmailResult } from "../types";

/**
 * Dev-safe default provider: logs the email instead of sending it.
 * Used whenever EMAIL_PROVIDER is unset or unrecognized, so the app works
 * without any email service configured.
 */
export const consoleProvider: EmailProvider = {
  async sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
    console.log("[email:console] to=%s subject=%s\n%s", input.to, input.subject, input.text);
    return {};
  },
};
