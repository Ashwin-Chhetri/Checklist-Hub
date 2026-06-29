import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/serviceClient";

/**
 * POST /api/auth/check-email
 *
 * Lets the login form tell "no account with this email" apart from "wrong
 * password" — Supabase's signInWithPassword deliberately returns the same
 * generic error for both, so this looks the email up directly via the
 * service-role client (bypassing RLS) against `profiles`, which a trigger
 * populates for every signed-up auth user (see migrations/0001_init.sql).
 *
 * Body: { email: string }
 */
export async function POST(request: NextRequest) {
  let body: { email?: string };
  try {
    body = (await request.json()) as { email?: string };
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase();
  if (!email) {
    return NextResponse.json({ error: "email is required." }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id")
    .ilike("email", email)
    .limit(1)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ exists: Boolean(data) });
}
