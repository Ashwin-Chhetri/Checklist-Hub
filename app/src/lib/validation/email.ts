const EMAIL_FORMAT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Syntax-only check — no deliverability/mailbox verification. */
export function isValidEmailFormat(value: string): boolean {
  return EMAIL_FORMAT.test(value.trim());
}
