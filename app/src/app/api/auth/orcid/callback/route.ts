import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import { ORCID_TOKEN_URL, getOrcidRedirectUri } from "@/lib/orcid/config";

interface OrcidTokenResponse {
  orcid?: string;
  name?: string;
  error?: string;
  error_description?: string;
}

function loginError(origin: string, code: string) {
  return NextResponse.redirect(`${origin}/login?error=${code}`);
}

/**
 * GET /api/auth/orcid/callback
 *
 * Finishes the ORCID OAuth2 flow started in /api/auth/orcid/start, then
 * bridges the result into a real Supabase session. Supabase has no ORCID
 * provider to hand this off to, so a Supabase user is matched/created by
 * ORCID iD (profiles.orcid_id) using a synthetic email — ORCID's free/public
 * API (the only tier registered for this app) does not return the user's
 * real email address, only their ORCID iD and, if public, their name.
 *
 * The session itself is established the same way
 * /api/auth/forgot-password's reset link is: `admin.generateLink` mints a
 * one-time token server-side, then `verifyOtp` consumes it against the
 * cookie-bound server client so this route's response carries real session
 * cookies, same as Supabase's own OAuth callback at /auth/callback.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const oauthError = searchParams.get("error");
  const storedState = request.cookies.get("orcid_oauth_state")?.value;

  if (oauthError || !code || !state || !storedState || state !== storedState) {
    return loginError(origin, "orcid_failed");
  }

  const clientId = process.env.ORCID_CLIENT_ID;
  const clientSecret = process.env.ORCID_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return loginError(origin, "orcid_not_configured");
  }

  const tokenRes = await fetch(ORCID_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "authorization_code",
      redirect_uri: getOrcidRedirectUri(),
      code,
    }),
  });

  const tokenData = (await tokenRes.json().catch(() => null)) as OrcidTokenResponse | null;
  const orcidId = tokenData?.orcid;
  if (!tokenRes.ok || !orcidId) {
    console.error("ORCID token exchange failed:", tokenData?.error, tokenData?.error_description);
    return loginError(origin, "orcid_failed");
  }

  const fullName = tokenData.name?.trim() || null;
  const serviceClient = createServiceClient();

  const { data: existingProfile } = await serviceClient
    .from("profiles")
    .select("id, email")
    .eq("orcid_id", orcidId)
    .maybeSingle();

  let email = existingProfile?.email as string | undefined;

  if (!email) {
    const syntheticEmail = `orcid-${orcidId}@users.checklisthub.in`;
    const { data: created, error: createError } = await serviceClient.auth.admin.createUser({
      email: syntheticEmail,
      email_confirm: true,
      user_metadata: { full_name: fullName, orcid_id: orcidId },
    });
    if (createError || !created.user) {
      console.error("Failed to create Supabase user for ORCID sign-in:", createError);
      return loginError(origin, "orcid_failed");
    }

    const { error: updateError } = await serviceClient
      .from("profiles")
      .update({ orcid_id: orcidId })
      .eq("id", created.user.id);
    if (updateError) {
      console.error("Failed to attach orcid_id to profile:", updateError);
      return loginError(origin, "orcid_failed");
    }

    email = syntheticEmail;
  }

  const { data: linkData, error: linkError } = await serviceClient.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  const tokenHash = linkData?.properties?.hashed_token;
  if (linkError || !tokenHash) {
    console.error("Failed to generate ORCID sign-in link:", linkError);
    return loginError(origin, "orcid_failed");
  }

  const supabase = await createClient();
  const { data: verifyData, error: verifyError } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: "magiclink",
  });
  if (verifyError || !verifyData.user) {
    console.error("Failed to verify ORCID sign-in link:", verifyError);
    return loginError(origin, "orcid_failed");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("profession, location, institution, designation")
    .eq("id", verifyData.user.id)
    .single();

  const isProfileComplete =
    profile &&
    (profile.profession || profile.location || profile.institution || profile.designation);

  const response = NextResponse.redirect(
    `${origin}${isProfileComplete ? "/checklists" : "/onboarding"}`,
  );
  response.cookies.delete("orcid_oauth_state");
  return response;
}
