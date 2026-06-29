import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isValidEmailFormat } from "@/lib/validation/email";
import { verifyDomainHasMx } from "@/lib/email/verifyDomainHasMx.server";

/**
 * GET /api/users/email-lookup?email=...
 *
 * Authoritative backing for the collaborator-invite email field: first
 * checks the user pool for an exact match (unlike the fuzzy `searchProfiles`
 * suggestion list, which is `ilike`-based and capped at 8 results, so it
 * isn't a reliable source of truth for "does this exact email have an
 * account"). If no account exists, falls back to an MX/A-record DNS check so
 * obviously-undeliverable addresses can't be queued as invites.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const email = request.nextUrl.searchParams.get("email")?.trim() ?? "";
  if (!email || !isValidEmailFormat(email)) {
    return NextResponse.json({ error: "A valid email is required." }, { status: 400 });
  }
  const normalizedEmail = email.toLowerCase();

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, full_name, avatar_url, email")
    .eq("email", normalizedEmail)
    .maybeSingle();

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 400 });
  }

  if (profile) {
    return NextResponse.json({ matched: true, profile });
  }

  const domain = normalizedEmail.split("@")[1];
  const verified = await verifyDomainHasMx(domain);
  return NextResponse.json({ matched: false, verified });
}
