import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fillHierarchy, mergeEvidence, type MergeableEvidence } from "@/lib/taxonomy/mergeSpeciesData.server";

interface SpeciesRow {
  id: string;
  gbif_taxon_key: number | null;
  taxonomy_status: string;
  evidence: MergeableEvidence | null;
  kingdom: string | null;
  phylum: string | null;
  class: string | null;
  order: string | null;
  family: string | null;
  genus: string | null;
}

/**
 * POST /api/checklists/[id]/validate/merge-duplicates
 *
 * Resolves every duplicate group reported by GET /validate (active rows
 * sharing a gbif_taxon_key) in one pass: for each group, picks a canonical
 * row (the one already taxonomy_status='accepted', else the first), folds
 * the other rows' evidence/hierarchy into it, then deactivates them via the
 * existing merge_species RPC — same logic the species PATCH route applies
 * to a single edit, just run across every group at once instead of
 * requiring the user to open and re-save each duplicate row individually.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const { id: checklistId } = await params;

  // Excludes rejected rows — they'll never be published, so they're not
  // counted as a duplicate issue by GET /validate either; this keeps the two
  // routes in agreement about what counts as an outstanding duplicate.
  const { data: allSpecies, error: speciesErr } = await supabase
    .from("species")
    .select("id, gbif_taxon_key, taxonomy_status, evidence, kingdom, phylum, class, order, family, genus")
    .eq("checklist_id", checklistId)
    .eq("is_active", true)
    .neq("review_status", "rejected");

  if (speciesErr) {
    return NextResponse.json({ error: speciesErr.message }, { status: 400 });
  }

  const rows = (allSpecies ?? []) as SpeciesRow[];

  const byKey = new Map<number, SpeciesRow[]>();
  for (const r of rows) {
    if (!r.gbif_taxon_key) continue;
    const group = byKey.get(r.gbif_taxon_key) ?? [];
    group.push(r);
    byKey.set(r.gbif_taxon_key, group);
  }

  const mergedGroups: { gbif_taxon_key: number; canonical_species_id: string; merged_species_ids: string[] }[] = [];

  for (const [gbifTaxonKey, group] of byKey.entries()) {
    if (group.length <= 1) continue;

    const canonical = group.find((r) => r.taxonomy_status === "accepted") ?? group[0];
    const others = group.filter((r) => r.id !== canonical.id);

    const mergedEvidence = mergeEvidence(canonical.evidence ?? {}, others.map((o) => o.evidence ?? {}));
    const hierarchyFill = fillHierarchy(
      canonical as unknown as Record<string, unknown>,
      others as unknown as Record<string, unknown>[],
    );

    const { error: updateError } = await supabase
      .from("species")
      .update({ evidence: mergedEvidence, ...hierarchyFill })
      .eq("id", canonical.id)
      .eq("checklist_id", checklistId);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 400 });
    }

    for (const other of others) {
      const { error: mergeError } = await supabase.rpc("merge_species", {
        p_species_id: other.id,
        p_checklist_id: checklistId,
        p_target_species_id: canonical.id,
      });
      if (mergeError) {
        return NextResponse.json({ error: mergeError.message }, { status: 400 });
      }
    }

    mergedGroups.push({
      gbif_taxon_key: gbifTaxonKey,
      canonical_species_id: canonical.id,
      merged_species_ids: others.map((o) => o.id),
    });
  }

  return NextResponse.json({ ok: true, merged_groups: mergedGroups });
}
