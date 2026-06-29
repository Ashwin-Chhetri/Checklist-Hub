import nodemailer from "nodemailer";
import type { EmailProvider, SendEmailInput, SendEmailResult } from "../types";

/**
 * Gmail (or any SMTP host) provider. Requires SMTP_USER/SMTP_PASS — for
 * Gmail specifically, SMTP_PASS must be an App Password (Google Account ->
 * Security -> App Passwords, requires 2-Step Verification enabled), not the
 * account's regular login password, which Gmail's SMTP rejects.
 */
// Module-level singleton: reused across calls within the same warm server
// process so repeated sends skip a fresh TLS handshake to Gmail (pool: true
// keeps a small set of connections open instead of one-per-send).
let transport: nodemailer.Transporter | undefined;

function getTransport(): nodemailer.Transporter {
  transport ??= nodemailer.createTransport({
    host: process.env.SMTP_HOST ?? "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT ?? 465),
    secure: true,
    pool: true,
    maxConnections: 3,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  return transport;
}

export const smtpProvider: EmailProvider = {
  async sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
    const transport = getTransport();
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
