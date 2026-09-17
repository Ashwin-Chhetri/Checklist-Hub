import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ensureRegionBoundaryCached } from "@/lib/regions/ensureRegionBoundaryCached.server";
import { resolveAdministrativeBoundaryByName } from "@/lib/regions/osmBoundary.server";

// Serves a region's boundary resolved by NAME ("<district> District, <state>,
// <country>") rather than by a specific GADM GID or OSM element — this is
// the app's primary boundary source (see regionApi.ts's fetchRegionBoundary),
// tried before the region's own region_gadm_id, because GADM's bundled
// geometry for a district can be a stale/differently-digitized vintage (see
// resolveAdministrativeBoundaryByName's doc comment for how this was found).
// Cached the same way GADM/OSM-by-id boundaries are, under source
// "osm-admin" so it never collides with either of those cache tiers.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const district = searchParams.get("district");
  const state = searchParams.get("state");
  const country = searchParams.get("country");

  if (!district || !country) {
    return NextResponse.json({ geometry: null, name: null });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const cacheKey = `${country}|${state ?? ""}|${district}`.toLowerCase();
  const result = await ensureRegionBoundaryCached(supabase, "osm-admin", cacheKey, () =>
    resolveAdministrativeBoundaryByName(district, state, country).then((r) => r ?? { geometry: null, name: null }),
  );
  return NextResponse.json(result);
}
