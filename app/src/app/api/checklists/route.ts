import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendInviteEmail } from "@/lib/invites/sendInviteEmail.server";
import type { Checklist, CreateChecklistInput } from "@/types/checklist.types";
import { buildSpeciesPayload } from "@/lib/taxonomy/buildSpeciesPayload.server";
import { ensureRegionBoundaryCached } from "@/lib/regions/ensureRegionBoundaryCached.server";
import { fetchOsmGeometry, resolveAdministrativeBoundaryByName } from "@/lib/regions/osmBoundary.server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "You must be signed in to create a checklist." }, { status: 401 });
  }

  let input: CreateChecklistInput;
  try {
    input = (await request.json()) as CreateChecklistInput;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!input.title?.trim()) {
    return NextResponse.json({ error: "Title is required." }, { status: 400 });
  }

  const rawSpecies = input.species ?? [];
  const species = await buildSpeciesPayload(rawSpecies, input.taxonomic_scope?.kingdom);

  const invites = (input.invites ?? []).map((invite) => ({
    email: invite.email.trim().toLowerCase(),
    note: invite.note ?? null,
  }));

  const { data: checklistId, error: rpcError } = await supabase.rpc("create_checklist_with_species", {
    p_checklist: {
      title: input.title.trim(),
      region_name: input.region_name || null,
      region_country: input.region_country || null,
      region_state: input.region_state || null,
      region_district: input.region_district || null,
      region_gadm_id: input.region_gadm_id || null,
      region_osm_type: input.region_osm_type || null,
      region_osm_id: input.region_osm_id || null,
      region_pin: input.region_pin || null,
      taxonomic_scope: input.taxonomic_scope,
      status: species.length > 0 ? "validating" : "draft",
    },
    p_species: species,
    p_invites: invites,
  });

  if (rpcError) {
    return NextResponse.json({ error: rpcError.message }, { status: 400 });
  }

  // Best-effort: decode/fetch + cache this region's boundary GeoJSON now, so
  // the first person to open this checklist's Map/List/Evidence views never
  // waits on it — same pattern as the invite emails below (do the side work
  // inline here rather than firing it off unawaited, since this route may
  // run in an environment that freezes the process right after the response
  // is sent). Same tier order as regionApi.ts's fetchRegionBoundary: resolve
  // by district/state/country name first (Nominatim's actual administrative
  // boundary — more reliable than GADM's own bundled geometry, see
  // osmBoundary.server.ts's resolveAdministrativeBoundaryByName), then GADM,
  // then the specific OSM element the user selected.
  let boundaryFound = false;
  if (input.region_district && input.region_country) {
    try {
      const cacheKey = `${input.region_country}|${input.region_state ?? ""}|${input.region_district}`.toLowerCase();
      const result = await ensureRegionBoundaryCached(supabase, "osm-admin", cacheKey, () =>
        resolveAdministrativeBoundaryByName(input.region_district, input.region_state, input.region_country).then((r) => r ?? { geometry: null, name: null }),
      );
      boundaryFound = !!result.geometry;
    } catch (err) {
      console.error(`[checklists] Failed to pre-warm admin boundary cache for ${input.region_district}, ${input.region_state}, ${input.region_country}`, err);
    }
  }
  if (!boundaryFound && input.region_gadm_id) {
    try {
      const result = await ensureRegionBoundaryCached(supabase, "gadm", input.region_gadm_id);
      boundaryFound = !!result.geometry;
    } catch (err) {
      console.error(`[checklists] Failed to pre-warm GADM boundary cache for gid=${input.region_gadm_id}`, err);
    }
  }
  if (!boundaryFound && input.region_osm_type && input.region_osm_id) {
    try {
      const cacheKey = `${input.region_osm_type}:${input.region_osm_id}`;
      await ensureRegionBoundaryCached(supabase, "osm", cacheKey, () =>
        fetchOsmGeometry(input.region_osm_type!, input.region_osm_id!),
      );
    } catch (err) {
      console.error(
        `[checklists] Failed to pre-warm OSM boundary cache for ${input.region_osm_type}:${input.region_osm_id}`,
        err,
      );
    }
  }

  const { data: checklist, error: fetchError } = await supabase
    .from("checklists")
    .select("*")
    .eq("id", checklistId)
    .single();

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 400 });
  }

  // Send invite emails (best effort) — both to brand-new invitees (no
  // account yet, status 'pending') and to invitees who already had a
  // matching profile (status 'accepted', granted immediate access by the RPC).
  if (invites.length > 0) {
    const { data: inviteRows } = await supabase
      .from("checklist_invites")
      .select("email, note, status")
      .eq("checklist_id", checklistId);

    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name, email")
      .eq("id", user.id)
      .single();

    const inviterName = profile?.full_name || profile?.email || "A collaborator";
    const origin = request.nextUrl.origin;

    for (const row of inviteRows ?? []) {
      await sendInviteEmail({
        origin,
        inviterName,
        checklist,
        speciesCount: input.totalSpeciesCount ?? species.length,
        toEmail: row.email,
        hasAccount: row.status === "accepted",
        note: row.note ?? undefined,
      });
    }
  }

  return NextResponse.json({ checklist: checklist as Checklist });
}
