import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchIptInstallations } from "@/lib/ipt/gbifRegistry.server";

// Backs both the auto-detected "publishing partners near you" list and the
// free-text "search all registered publishers" box on the IPT publish step.
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const countryParam = searchParams.get("country");
  const query = searchParams.get("q")?.trim() || undefined;
  const country = countryParam && countryParam.length === 2 ? countryParam.toUpperCase() : undefined;

  if (!country && !query) {
    return NextResponse.json({ installations: [] });
  }

  const installations = await fetchIptInstallations({ country, query });
  return NextResponse.json({ installations });
}
