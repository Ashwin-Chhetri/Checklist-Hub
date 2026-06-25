import nodemailer from "nodemailer";
import type { EmailProvider, SendEmailInput, SendEmailResult } from "../types";

/**
 * Gmail (or any SMTP host) provider. Requires SMTP_USER/SMTP_PASS — for
 * Gmail specifically, SMTP_PASS must be an App Password (Google Account ->
 * Security -> App Passwords, requires 2-Step Verification enabled), not the
 * account's regular login password, which Gmail's SMTP rejects.
 */
function buildTransport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST ?? "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT ?? 465),
    secure: true,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

export const smtpProvider: EmailProvider = {
  async sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
    const transport = buildTransport();
    const from = process.env.SMTP_FROM ?? process.env.SMTP_USER;
    const result = await transport.sendMail({
      from,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    });
    return { id: result.messageId };
  },
};
