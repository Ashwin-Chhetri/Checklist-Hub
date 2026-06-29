import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ensureRegionBoundaryCached } from "@/lib/regions/ensureRegionBoundaryCached.server";
import { fetchOsmGeometry } from "@/lib/regions/osmBoundary.server";

// Serves a region's boundary GeoJSON fetched live from Nominatim (OpenStreetMap),
// used by the workbench Evidence panel whenever GADM has no stored geometry
// for the checklist's region (GADM only stores boundaries for level-2/district
// GIDs — see scripts/build-gadm.mjs — so any region whose lookup landed at
// state/country level, e.g. Sikkim, has no GADM geometry at all). Results are
// cached the same way GADM boundaries are (see ensureRegionBoundaryCached.server.ts),
// keyed by "<osmType>:<osmId>" so repeat requests skip the external call.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const osmType = searchParams.get("osmType");
  const osmId = searchParams.get("osmId");

  if (!osmType || !osmId) {
    return NextResponse.json({ geometry: null, name: null });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const cacheKey = `${osmType}:${osmId}`;
  const result = await ensureRegionBoundaryCached(supabase, "osm", cacheKey, () => fetchOsmGeometry(osmType, osmId));
  return NextResponse.json(result);
}
