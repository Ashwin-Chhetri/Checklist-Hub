import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { lookupBackbone } from "@/lib/taxonomy/backbone.server";

interface EvidenceSource {
  source: string;
  record_count?: number;
  unique_count?: number;
  [key: string]: unknown;
}

interface Evidence {
  occurrence_count?: number;
  publication_count?: number;
  checklist_matches_count?: number;
  sources?: EvidenceSource[];
  external_ids?: Record<string, string | number>;
  basis_of_record_breakdown?: Record<string, number>;
  revisions?: unknown[];
  [key: string]: unknown;
}

interface Classification {
  kingdom?: string | null;
  phylum?: string | null;
  class?: string | null;
  order?: string | null;
  family?: string | null;
  genus?: string | null;
  species?: string | null;
}

interface AuthorityConflict {
  authority: string;
  suggested_name: string;
  taxon_id?: number | null;
  classification?: Classification | null;
  year?: number | null;
  authorship?: string | null;
}

const HIERARCHY_FIELDS = ["kingdom", "phylum", "class", "order", "family", "genus"] as const;

/** Merges evidence from the other rows in a duplicate group into the canonical row's evidence. */
function mergeEvidence(canonical: Evidence, others: Evidence[]): Evidence {
  const sourcesMap = new Map<string, EvidenceSource>();
  for (const s of canonical.sources ?? []) sourcesMap.set(s.source, { ...s });

  let occurrence_count = canonical.occurrence_count ?? 0;
  let publication_count = canonical.publication_count ?? 0;
  let checklist_matches_count = canonical.checklist_matches_count ?? 0;
  const external_ids: Record<string, string | number> = { ...(canonical.external_ids ?? {}) };
  const basis_of_record_breakdown: Record<string, number> = { ...(canonical.basis_of_record_breakdown ?? {}) };
  const revisions = [...(canonical.revisions ?? [])];

  for (const e of others) {
    occurrence_count += e.occurrence_count ?? 0;
    publication_count += e.publication_count ?? 0;
    checklist_matches_count += e.checklist_matches_count ?? 0;
    for (const [k, v] of Object.entries(e.external_ids ?? {})) {
      if (!(k in external_ids)) external_ids[k] = v;
    }
    for (const [k, v] of Object.entries(e.basis_of_record_breakdown ?? {})) {
      basis_of_record_breakdown[k] = (basis_of_record_breakdown[k] ?? 0) + v;
    }
    revisions.push(...(e.revisions ?? []));
    for (const s of e.sources ?? []) {
      const existing = sourcesMap.get(s.source);
      sourcesMap.set(s.source, existing
        ? {
            ...existing,
            record_count: (existing.record_count ?? 0) + (s.record_count ?? 0),
            unique_count: (existing.unique_count ?? 0) + (s.unique_count ?? 0),
          }
        : { ...s });
    }
  }

  return {
    ...canonical,
    occurrence_count,
    publication_count,
    checklist_matches_count,
    sources: [...sourcesMap.values()],
    external_ids,
    basis_of_record_breakdown,
    revisions,
  };
}

/** Fills in any missing taxonomic hierarchy fields on the canonical row from related rows. */
function fillHierarchy(
  canonical: Record<string, unknown>,
  others: Record<string, unknown>[],
): Record<string, unknown> {
  const filled: Record<string, unknown> = {};
  for (const field of HIERARCHY_FIELDS) {
    if (canonical[field]) continue;
    const source = others.find((o) => o[field]);
    if (source) filled[field] = source[field];
  }
  return filled;
}

/**
 * POST /api/checklists/[id]/species/[speciesId]/resolve-conflict
 *
 * Applies a single chosen authority-conflict option as the species' name,
 * merges in evidence/occurrence data and taxonomic hierarchy from any other
 * rows sharing the same gbif_taxon_key (the duplicate group the conflict
 * options came from), soft-merges those other rows into this one, and
 * resolves all open conflicts. Unlike the consensus-based conflict-vote
 * endpoint, this requires no other collaborators to agree — any editor can
 * pick an option and commit it immediately.
 *
 * Body: { authority: string; suggested_name: string }
 *
 * imported_name is rewritten alongside current_name/accepted_name (not just
 * current_name) so the row's history reflects that the imported and accepted
 * names now match; taxonomy_status is set to "accepted" explicitly below.
 * taxonomy.authority_conflicts is left untouched so the resolved row can
 * still show what the original conflicting options were.
 *
 * The other duplicate-group rows are soft-merged (is_active=false) rather
 * than left active, because otherwise this row would keep satisfying the
 * "potential_duplicates" view's group-membership check even after its own
 * status flips to "accepted" — it would wrongly show up as a duplicate
 * instead of settling into "taxonomy clean".
 */
export async function POST(
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

  let authority: string, suggested_name: string;
  try {
    ({ authority, suggested_name } = (await request.json()) as {
      authority: string;
      suggested_name: string;
    });
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!authority || !suggested_name) {
    return NextResponse.json({ error: "authority and suggested_name are required." }, { status: 400 });
  }

  const { data: species, error: fetchError } = await supabase
    .from("species")
    .select(
      "id, checklist_id, gbif_taxon_key, evidence, taxonomy, taxonomy_status, kingdom, phylum, class, order, family, genus",
    )
    .eq("id", speciesId)
    .eq("checklist_id", checklistId)
    .single();

  if (fetchError || !species) {
    return NextResponse.json({ error: "Species not found." }, { status: 404 });
  }

  // Other active rows sharing the same gbif_taxon_key are the duplicate-group
  // members the conflicting names came from — fold their evidence in and
  // soft-merge them so the group collapses into this single resolved row.
  let relatedRows: {
    id: string;
    evidence: Evidence | null;
    kingdom: string | null;
    phylum: string | null;
    class: string | null;
    order: string | null;
    family: string | null;
    genus: string | null;
    is_active: boolean | null;
  }[] = [];

  if (species.gbif_taxon_key) {
    const { data: related } = await supabase
      .from("species")
      .select("id, evidence, kingdom, phylum, class, order, family, genus, is_active")
      .eq("checklist_id", checklistId)
      .eq("gbif_taxon_key", species.gbif_taxon_key)
      .neq("id", speciesId);
    relatedRows = (related ?? []).filter((r) => r.is_active !== false);
  }

  const mergedEvidence = mergeEvidence((species.evidence as Evidence) ?? {}, relatedRows.map((r) => r.evidence ?? {}));
  const taxonomy = (species.taxonomy as Record<string, unknown>) ?? {};

  // Find the chosen option among the row's recorded conflicts so its own
  // taxon ID, taxonomic hierarchy, and authority/year travel onto the
  // resolved row. The "keep current" option has no conflict entry (it's the
  // species' own existing data), so there's nothing to override for it.
  const authorityConflicts = (taxonomy.authority_conflicts as AuthorityConflict[] | undefined) ?? [];
  const chosenConflict = authorityConflicts.find(
    (c) => c.authority === authority && c.suggested_name === suggested_name,
  );

  // Older conflict entries (created before authorship/taxon_id were tracked) may
  // be missing those fields even though the local backbone has the data — look
  // the option up directly (by its taxon_id when known, else by name) and fill
  // in whatever the stored entry is missing, rather than leaving it blank.
  const needsBackfill =
    chosenConflict && (!chosenConflict.authorship || !chosenConflict.taxon_id || !chosenConflict.classification);
  const backfill = needsBackfill
    ? lookupBackbone({ gbifKey: chosenConflict.taxon_id ?? undefined, name: chosenConflict.taxon_id ? undefined : suggested_name })
    : null;
  const enrichedConflict: AuthorityConflict | undefined = chosenConflict && {
    ...chosenConflict,
    taxon_id: chosenConflict.taxon_id ?? backfill?.taxonKey ?? undefined,
    classification: chosenConflict.classification ?? backfill?.classification ?? undefined,
    authorship: chosenConflict.authorship ?? backfill?.ownAuthorship ?? backfill?.authorship ?? undefined,
    year: chosenConflict.year ?? backfill?.namePublishedInYear ?? undefined,
  };

  // The chosen option's own hierarchy takes priority; any fields it doesn't carry
  // fall back to the duplicate-group fill, then to whatever the row already has.
  const hierarchyFromChoice: Record<string, unknown> = {};
  if (enrichedConflict?.classification) {
    for (const field of HIERARCHY_FIELDS) {
      const value = enrichedConflict.classification[field];
      if (value) hierarchyFromChoice[field] = value;
    }
  }
  const hierarchyFill = fillHierarchy(
    { ...species, ...hierarchyFromChoice },
    relatedRows,
  );

  const hierarchy = { ...hierarchyFill, ...hierarchyFromChoice };
  const newTaxonomy = {
    ...taxonomy,
    current_name: suggested_name,
    accepted_name: suggested_name,
    imported_name: suggested_name,
    accepted_taxon_id: enrichedConflict?.taxon_id ?? taxonomy.accepted_taxon_id,
    classification: enrichedConflict?.classification ?? taxonomy.classification,
    // Backfill the resolved conflict entry itself too, so the "CONFLICT
    // RESOLVED" history expander shows authorship/year even for older
    // conflicts that were created before these fields were tracked.
    authority_conflicts: enrichedConflict
      ? authorityConflicts.map((c) =>
          c.authority === authority && c.suggested_name === suggested_name ? enrichedConflict : c,
        )
      : authorityConflicts,
    name_resolution: {
      decision: "agree",
      resolved_by: user.id,
      resolved_at: new Date().toISOString(),
      accepted_name: suggested_name,
      resolved_from_authority: authority,
      year: enrichedConflict?.year ?? undefined,
      authorship: enrichedConflict?.authorship ?? undefined,
    },
  };

  const { data: result, error: rpcError } = await supabase.rpc("resolve_authority_conflict", {
    p_species_id: speciesId,
    p_checklist_id: checklistId,
    p_scientific_name: suggested_name,
    p_gbif_taxon_key: enrichedConflict?.taxon_id ?? species.gbif_taxon_key,
    p_evidence: mergedEvidence,
    p_hierarchy: hierarchy,
    p_taxonomy: newTaxonomy,
    p_related_ids: relatedRows.map((r) => r.id),
  });

  if (rpcError) {
    return NextResponse.json({ error: rpcError.message }, { status: 400 });
  }

  return NextResponse.json(result ?? { ok: true, accepted_name: suggested_name, merged_count: relatedRows.length });
}
