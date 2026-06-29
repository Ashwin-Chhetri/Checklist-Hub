import { resolve4, resolve6, resolveMx } from "node:dns/promises";

/**
 * Best-effort check that a domain can receive mail: MX records first, falling
 * back to A/AAAA (RFC 5321 implicit-MX — some small domains accept mail via a
 * bare A record with no explicit MX). Any DNS error (NXDOMAIN, timeout, no
 * records) is treated as "not verified" rather than thrown — this is a
 * deliverability signal, not a hard requirement.
 */
export async function verifyDomainHasMx(domain: string): Promise<boolean> {
  try {
    const mxRecords = await resolveMx(domain);
    if (mxRecords.length > 0) return true;
  } catch {
    // fall through to A/AAAA fallback
  }

  try {
    const aRecords = await resolve4(domain);
    if (aRecords.length > 0) return true;
  } catch {
    // fall through to AAAA fallback
  }

  try {
    const aaaaRecords = await resolve6(domain);
    return aaaaRecords.length > 0;
  } catch {
    return false;
  }
}
