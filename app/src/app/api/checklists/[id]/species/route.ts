import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildSpeciesPayload } from "@/lib/taxonomy/buildSpeciesPayload.server";
import type { Checklist, CreateChecklistSpeciesInput } from "@/types/checklist.types";
import type { Species } from "@/types/species.types";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const { id: checklistId } = await params;

  const { data: checklist } = await supabase
    .from("checklists")
    .select("*")
    .eq("id", checklistId)
    .single();

  if (!checklist) {
    return NextResponse.json({ error: "Checklist not found." }, { status: 404 });
  }

  let body: { species?: CreateChecklistSpeciesInput[] };
  try {
    body = (await request.json()) as { species?: CreateChecklistSpeciesInput[] };
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const candidates = body.species ?? [];
  if (candidates.length === 0) {
    return NextResponse.json({ error: "No species provided." }, { status: 400 });
  }

  // Dedupe against species already in this checklist (by scientific name or
  // GBIF taxon key) before running the normalization pipeline.
  const { data: existingRows } = await supabase
    .from("species")
    .select("scientific_name, gbif_taxon_key")
    .eq("checklist_id", checklistId);

  const existingNames = new Set((existingRows ?? []).map((r) => r.scientific_name.trim().toLowerCase()));
  const existingKeys = new Set(
    (existingRows ?? []).map((r) => r.gbif_taxon_key).filter((k): k is number => k != null),
  );

  const toImport = candidates.filter((s) => {
    const nameMatch = existingNames.has(s.scientific_name.trim().toLowerCase());
    const keyMatch = s.gbif_taxon_key != null && existingKeys.has(s.gbif_taxon_key);
    return !nameMatch && !keyMatch;
  });
  const skipped = candidates.length - toImport.length;

  if (toImport.length === 0) {
    return NextResponse.json({ added: 0, skipped, species: [] });
  }

  const payload = await buildSpeciesPayload(toImport, (checklist as Checklist).taxonomic_scope?.kingdom);

  const { data: insertedIds, error: rpcError } = await supabase.rpc("add_species_to_checklist", {
    p_checklist_id: checklistId,
    p_species: payload,
  });

  if (rpcError) {
    return NextResponse.json({ error: rpcError.message }, { status: 400 });
  }

  const { data: insertedSpecies, error: fetchError } = await supabase
    .from("species")
    .select("*")
    .in("id", (insertedIds as string[]) ?? []);

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 400 });
  }

  return NextResponse.json({
    added: insertedSpecies?.length ?? 0,
    skipped,
    species: (insertedSpecies ?? []) as Species[],
  });
}
