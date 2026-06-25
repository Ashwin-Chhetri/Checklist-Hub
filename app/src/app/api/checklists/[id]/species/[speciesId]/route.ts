import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fillHierarchy, mergeEvidence, type MergeableEvidence } from "@/lib/taxonomy/mergeSpeciesData.server";

const ALLOWED_FIELDS = [
  "scientific_name",
  "common_name",
  "gbif_taxon_key",
  "kingdom",
  "phylum",
  "class",
  "order",
  "family",
  "genus",
] as const;

export async function PATCH(
  request: NextRequest,
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

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  for (const key of ALLOWED_FIELDS) {
    if (key in body) updates[key] = body[key] === "" ? null : body[key];
  }

  // `classification` carries the same ranks (plus "species") for the
  // taxonomy.classification jsonb blob — every read path in the workbench
  // (TaxonomyPanel, SpeciesRow) checks that blob before the direct species
  // columns above, so both must be kept in sync or an edit would appear to
  // silently no-op.
  const classification =
    body.classification && typeof body.classification === "object"
      ? (body.classification as Record<string, unknown>)
      : null;

  if (Object.keys(updates).length === 0 && !classification) {
    return NextResponse.json({ error: "No valid fields to update." }, { status: 400 });
  }

  // Verify species belongs to this checklist
  const { data: existing, error: fetchError } = await supabase
    .from("species")
    .select(
      "id, checklist_id, taxonomy, evidence, scientific_name, gbif_taxon_key, kingdom, phylum, class, order, family, genus",
    )
    .eq("id", speciesId)
    .eq("checklist_id", checklistId)
    .single();

  if (fetchError || !existing) {
    return NextResponse.json({ error: "Species not found." }, { status: 404 });
  }

  if (classification) {
    const existingTaxonomy = (existing.taxonomy ?? {}) as Record<string, unknown>;
    const existingClassification = (existingTaxonomy.classification ?? {}) as Record<string, unknown>;
    const mergedClassification: Record<string, unknown> = { ...existingClassification };
    for (const [key, value] of Object.entries(classification)) {
      mergedClassification[key] = value === "" ? null : value;
    }
    updates.taxonomy = { ...existingTaxonomy, classification: mergedClassification };
  }

  // ── Duplicate detection ─────────────────────────────────────────────────
  // If this edit makes the row's gbif_taxon_key (or, lacking that,
  // scientific_name) match another active row in the checklist, fold that
  // other row's evidence/hierarchy into this one and deactivate it instead
  // of leaving two active rows for the same taxon.
  const effectiveGbifKey =
    "gbif_taxon_key" in updates ? (updates.gbif_taxon_key as number | null) : existing.gbif_taxon_key;
  const effectiveScientificName =
    "scientific_name" in updates ? (updates.scientific_name as string | null) : existing.scientific_name;

  let duplicateRow: {
    id: string;
    evidence: MergeableEvidence | null;
    kingdom: string | null;
    phylum: string | null;
    class: string | null;
    order: string | null;
    family: string | null;
    genus: string | null;
  } | null = null;

  if (effectiveGbifKey) {
    const { data } = await supabase
      .from("species")
      .select("id, evidence, kingdom, phylum, class, order, family, genus")
      .eq("checklist_id", checklistId)
      .eq("is_active", true)
      .eq("gbif_taxon_key", effectiveGbifKey)
      .neq("id", speciesId)
      .limit(1)
      .maybeSingle();
    duplicateRow = data ?? null;
  } else if (effectiveScientificName) {
    const { data } = await supabase
      .from("species")
      .select("id, evidence, kingdom, phylum, class, order, family, genus")
      .eq("checklist_id", checklistId)
      .eq("is_active", true)
      .ilike("scientific_name", effectiveScientificName)
      .neq("id", speciesId)
      .limit(1)
      .maybeSingle();
    duplicateRow = data ?? null;
  }

  if (duplicateRow) {
    const mergedEvidence = mergeEvidence((existing.evidence as MergeableEvidence) ?? {}, [
      duplicateRow.evidence ?? {},
    ]);
    updates.evidence = mergedEvidence;

    const hierarchyFill = fillHierarchy({ ...existing, ...updates }, [duplicateRow]);
    Object.assign(updates, hierarchyFill);
  }

  const { data: updated, error: updateError } = await supabase
    .from("species")
    .update(updates)
    .eq("id", speciesId)
    .eq("checklist_id", checklistId)
    .select()
    .single();

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 });
  }

  if (duplicateRow) {
    const { error: mergeError } = await supabase.rpc("merge_species", {
      p_species_id: duplicateRow.id,
      p_checklist_id: checklistId,
      p_target_species_id: speciesId,
    });
    if (mergeError) {
      return NextResponse.json({ error: mergeError.message }, { status: 400 });
    }
  }

  return NextResponse.json({
    ok: true,
    species: updated,
    merged: Boolean(duplicateRow),
    merged_species_id: duplicateRow?.id ?? null,
  });
}
