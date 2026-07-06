import { NextRequest, NextResponse } from "next/server";
import { ORCID_AUTHORIZE_URL, getOrcidRedirectUri } from "@/lib/orcid/config";

/**
 * GET /api/auth/orcid/start
 *
 * Supabase Auth has no built-in ORCID provider (it's not in GoTrue's fixed
 * provider list), so we drive ORCID's own OAuth2 authorization-code flow
 * directly rather than `supabase.auth.signInWithOAuth`. This route kicks it
 * off; /api/auth/orcid/callback finishes it and hands the result to Supabase.
 */
export async function GET(request: NextRequest) {
  const clientId = process.env.ORCID_CLIENT_ID;
  if (!clientId) {
    return NextResponse.redirect(new URL("/login?error=orcid_not_configured", request.url));
  }

  const state = crypto.randomUUID();
  const authorizeUrl = new URL(ORCID_AUTHORIZE_URL);
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("scope", "openid");
  authorizeUrl.searchParams.set("redirect_uri", getOrcidRedirectUri());
  authorizeUrl.searchParams.set("state", state);

  const response = NextResponse.redirect(authorizeUrl);
  response.cookies.set("orcid_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 10,
    path: "/",
  });
  return response;
}
