import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { enrichSpeciesTaxonomy } from "@/lib/taxonomy/enrichSpeciesTaxonomy.server";

/**
 * POST /api/checklists/[id]/species/[speciesId]/enrich-taxonomy
 *
 * On-demand, persisted fallback for a species row whose taxonomy hierarchy/
 * authority/year is still incomplete after ingestion. Tries every
 * identifying string available for the row (own/accepted/imported scientific
 * names, recorded synonym/conflict names, every known common name) against
 * the local backbone and writes back whatever it finds. Called by the
 * workbench taxonomy panel when it notices a gap — runs once, persists, and
 * the client re-fetches the species row, so this never needs to re-run on
 * every render the way the old live-lookup-on-render approach did.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; speciesId: string }> },
) {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const { id: checklistId, speciesId } = await params;

  const { data: species, error: fetchError } = await supabase
    .from("species")
    .select("id, checklist_id, scientific_name, common_name, gbif_taxon_key, identity, taxonomy")
    .eq("id", speciesId)
    .eq("checklist_id", checklistId)
    .single();

  if (fetchError || !species) {
    return NextResponse.json({ error: "Species not found." }, { status: 404 });
  }

  const { data: checklist } = await supabase
    .from("checklists")
    .select("taxonomic_scope")
    .eq("id", checklistId)
    .single();

  const { taxonomy, changed } = await enrichSpeciesTaxonomy(
    species,
    (checklist?.taxonomic_scope as { kingdom?: string } | null)?.kingdom,
  );

  if (!changed) {
    return NextResponse.json({ ok: true, changed: false, taxonomy: species.taxonomy });
  }

  const { error: updateError } = await supabase
    .from("species")
    .update({ taxonomy })
    .eq("id", speciesId)
    .eq("checklist_id", checklistId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, changed: true, taxonomy });
}
