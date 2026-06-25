import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveGbifDataset } from "@/lib/ipt/gbifRegistry.server";

// Backs the "Fetch Publication Details" button on the IPT publish step —
// given the dataset URL the user pasted back after registering on their
// IPT, resolves it to the official GBIF Registry record so the user doesn't
// have to retype the UUID/DOI/citation/year by hand.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const { url } = (await request.json().catch(() => ({}))) as { url?: string };
  if (!url || !url.trim()) {
    return NextResponse.json({ error: "Enter a dataset URL first." }, { status: 400 });
  }

  const result = await resolveGbifDataset(url.trim());
  if (!result) {
    return NextResponse.json(
      {
        error:
          "Couldn't match that to a registered GBIF dataset yet. It can take a few minutes after registering — or try pasting the gbif.org/dataset/... link instead.",
      },
      { status: 404 },
    );
  }
  return NextResponse.json(result);
}
