/**
 * ORCID has separate hosts and separate app registrations for its sandbox
 * (testing) and production environments — a sandbox Client ID/Secret does
 * not work against orcid.org and vice versa. Set ORCID_ENV=sandbox locally
 * once a sandbox app is registered at https://sandbox.orcid.org; it defaults
 * to production since that's the only environment currently registered
 * (sandbox.orcid.org allows http://localhost redirect URIs, orcid.org does
 * not — production ORCID sign-in can only be exercised on a deployed HTTPS
 * origin).
 */
const isSandbox = process.env.ORCID_ENV === "sandbox";

const ORCID_BASE_URL = isSandbox ? "https://sandbox.orcid.org" : "https://orcid.org";

export const ORCID_AUTHORIZE_URL = `${ORCID_BASE_URL}/oauth/authorize`;
export const ORCID_TOKEN_URL = `${ORCID_BASE_URL}/oauth/token`;

const DEFAULT_PRODUCTION_REDIRECT_URI = "https://checklisthub.in/api/auth/orcid/callback";

/**
 * ORCID requires an exact, pre-registered redirect URI (no wildcards), so
 * this is fixed rather than derived from the incoming request's origin —
 * deriving it dynamically would silently break on preview deploys or any
 * origin other than the one actually registered with ORCID.
 */
export function getOrcidRedirectUri(): string {
  return process.env.ORCID_REDIRECT_URI ?? DEFAULT_PRODUCTION_REDIRECT_URI;
}
