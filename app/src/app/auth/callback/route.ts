import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/checklists";

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const user = data.user;
      if (user) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("profession, location, institution, designation")
          .eq("id", user.id)
          .single();

        const isProfileComplete =
          profile &&
          (profile.profession || profile.location || profile.institution || profile.designation);

        if (!isProfileComplete) {
          return NextResponse.redirect(`${origin}/onboarding`);
        }
      }
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
