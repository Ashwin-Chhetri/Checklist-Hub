import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ensureRegionBoundaryCached } from "@/lib/regions/ensureRegionBoundaryCached.server";

// Serves the boundary GeoJSON for a level-2 (sub-district) GADM region, used
// by the workbench Evidence panel to render a region outline for the
// checklist's `region_gadm_id`. Most requests should already be served from
// the Supabase cache that `ensureRegionBoundaryCached` checks first — new
// checklists pre-warm it at creation time (see
// src/app/api/checklists/route.ts), so this route's local-file fallback only
// runs for checklists created before that, or in case of a cache miss.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const gid = searchParams.get("gid");

  if (!gid) {
    return NextResponse.json({ geometry: null, name: null });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const result = await ensureRegionBoundaryCached(supabase, "gadm", gid);
  return NextResponse.json(result);
}
