import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { TaxonomyAuthorityConflict } from "@/types/species.types";

interface DuplicateGroupRow {
  gbif_taxon_key: number;
  accepted_name: string | null;
  rows: Array<{
    species_id: string;
    scientific_name: string;
    taxonomy_status: string;
  }>;
}

interface SynonymPairRow {
  species_id: string;
  imported_name: string;
  accepted_name: string | null;
  accepted_taxon_id: number | null;
  sources: string[];
}

interface UnresolvedRow {
  species_id: string;
  scientific_name: string;
}

interface ClassificationIssueRow {
  species_id: string;
  scientific_name: string;
  issue: "missing_rank" | "inconsistent_genus";
  detail: string;
}

interface AuthorityConflictRow {
  species_id: string;
  scientific_name: string;
  conflict_count: number;
  conflicts: TaxonomyAuthorityConflict[];
}

export interface ReviewStatusCounts {
  not_reviewed: number;
  under_review: number;
  accepted: number;
  rejected: number;
}

export interface ValidationReport {
  checklist_id: string;
  /** COUNT(*) WHERE is_active = true */
  total_species: number;
  /** COUNT(DISTINCT gbif_taxon_key) among active rows */
  unique_accepted_taxon_ids: number;
  /** Active rows that share a gbif_taxon_key with at least one other active row */
  duplicate_groups: DuplicateGroupRow[];
  /** Active rows with taxonomy_status = 'synonym' */
  synonym_pairs: SynonymPairRow[];
  /** Active rows with taxonomy_status = 'unresolved' */
  unresolved_taxa: UnresolvedRow[];
  /** Active rows with taxonomy_status = 'authority_conflict' */
  authority_conflicts: AuthorityConflictRow[];
  /**
   * Denormalized-classification integrity issues. `inconsistent_genus`
   * (two rows sharing a genus but disagreeing on family/order/class/phylum/
   * kingdom) is a real data-integrity bug and blocks readiness.
   * `missing_rank` (a higher-taxon column left blank) is informational only
   * — some legitimate taxa lack certain ranks — and never blocks.
   */
  classification_issues: ClassificationIssueRow[];
  /** Breakdown of active rows by review_status */
  review_status_counts: ReviewStatusCounts;
  /**
   * Publication readiness: every active species has been reviewed
   * (accepted or rejected — none not_reviewed/under_review), and there are
   * no outstanding duplicate groups, unresolved taxa, authority conflicts,
   * or inconsistent-genus classification issues. Synonyms and missing-rank
   * classification issues do not block readiness — they're either an
   * already resolved/documented taxonomy state or a legitimate gap.
   */
  is_ready: boolean;
  generated_at: string;
}

/**
 * GET /api/checklists/[id]/validate
 *
 * Returns a full taxonomy validation report for the checklist.
 * Used to verify ingestion quality — primary metric is `unique_accepted_taxon_ids`
 * (COUNT(DISTINCT gbif_taxon_key) among active rows), not total species count.
 *
 * A healthy checklist has:
 *   - duplicate_groups: []
 *   - synonym_pairs reviewed and merged or kept separate by the user
 *   - unresolved_taxa: [] (or explicitly deferred)
 *   - authority_conflicts reviewed by collaborators
 */
export async function GET(
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

  // Verify the user has at least read access to this checklist.
  const { data: checklist } = await supabase
    .from("checklists")
    .select("id, owner_id")
    .eq("id", checklistId)
    .single();

  if (!checklist) {
    return NextResponse.json({ error: "Checklist not found." }, { status: 404 });
  }

  // Fetch all active species rows with taxonomy data.
  const { data: allSpecies, error: speciesErr } = await supabase
    .from("species")
    .select(
      "id, scientific_name, gbif_taxon_key, taxonomy_status, review_status, taxonomy, evidence, is_active, kingdom, phylum, class, order, family, genus",
    )
    .eq("checklist_id", checklistId)
    .eq("is_active", true);

  if (speciesErr) {
    return NextResponse.json({ error: speciesErr.message }, { status: 400 });
  }

  const rows = allSpecies ?? [];

  // A rejected row will never be published (getAcceptedSpecies only selects
  // review_status='accepted'), so its taxonomy never needs resolving and it
  // shouldn't gate publish readiness or show up as an outstanding issue —
  // only rows that could plausibly end up in the published package matter
  // for duplicate/synonym/unresolved/conflict detection below. Totals and
  // review_status_counts below still cover every active row, since those
  // describe overall checklist health, not just publish-blocking issues.
  const publishRelevantRows = rows.filter((r) => r.review_status !== "rejected");

  // ── unique_accepted_taxon_ids ──────────────────────────────────────────────
  const keySet = new Set<number>();
  for (const r of rows) {
    if (r.gbif_taxon_key) keySet.add(r.gbif_taxon_key);
  }
  const uniqueAcceptedTaxonIds = keySet.size;

  // ── duplicate_groups ───────────────────────────────────────────────────────
  // Group active, publish-relevant rows by gbif_taxon_key; keep groups with > 1 row.
  const byKey = new Map<number, typeof rows>();
  for (const r of publishRelevantRows) {
    if (!r.gbif_taxon_key) continue;
    const group = byKey.get(r.gbif_taxon_key) ?? [];
    group.push(r);
    byKey.set(r.gbif_taxon_key, group);
  }

  const duplicateGroups: DuplicateGroupRow[] = [];
  for (const [gbif_taxon_key, group] of byKey.entries()) {
    if (group.length <= 1) continue;
    const acceptedRow = group.find((r) => r.taxonomy_status === "accepted");
    duplicateGroups.push({
      gbif_taxon_key,
      accepted_name:
        (acceptedRow?.taxonomy as Record<string, unknown> | null)?.current_name as string | null ?? null,
      rows: group.map((r) => ({
        species_id: r.id,
        scientific_name: r.scientific_name,
        taxonomy_status: r.taxonomy_status,
      })),
    });
  }

  // ── synonym_pairs ─────────────────────────────────────────────────────────
  const synonymPairs: SynonymPairRow[] = publishRelevantRows
    .filter((r) => r.taxonomy_status === "synonym")
    .map((r) => {
      const tax = (r.taxonomy ?? {}) as Record<string, unknown>;
      const ev = (r.evidence ?? {}) as Record<string, unknown>;
      const sources = Array.isArray(ev.sources)
        ? (ev.sources as Array<Record<string, string>>).map((s) => s.source).filter(Boolean)
        : [];
      return {
        species_id: r.id,
        imported_name: (tax.imported_name as string) ?? r.scientific_name,
        accepted_name: (tax.accepted_name ?? tax.current_name) as string | null,
        accepted_taxon_id: (tax.accepted_taxon_id as number) ?? r.gbif_taxon_key,
        sources,
      };
    });

  // ── unresolved_taxa ───────────────────────────────────────────────────────
  const unresolvedTaxa: UnresolvedRow[] = publishRelevantRows
    .filter((r) => r.taxonomy_status === "unresolved")
    .map((r) => ({ species_id: r.id, scientific_name: r.scientific_name }));

  // ── authority_conflicts ───────────────────────────────────────────────────
  // Fetch conflict counts from the normalized taxonomy_conflicts table.
  const conflictSpeciesIds = publishRelevantRows
    .filter((r) => r.taxonomy_status === "authority_conflict")
    .map((r) => r.id);

  const conflictsBySpecies = new Map<string, TaxonomyAuthorityConflict[]>();
  if (conflictSpeciesIds.length > 0) {
    const { data: conflictRows } = await supabase
      .from("taxonomy_conflicts")
      .select("species_id, authority, suggested_name, status, notes")
      .in("species_id", conflictSpeciesIds)
      .neq("status", "resolved");

    for (const c of conflictRows ?? []) {
      const existing = conflictsBySpecies.get(c.species_id) ?? [];
      existing.push({
        authority: c.authority,
        suggested_name: c.suggested_name,
        status: c.status as TaxonomyAuthorityConflict["status"],
        notes: c.notes,
      });
      conflictsBySpecies.set(c.species_id, existing);
    }
  }

  const authorityConflicts: AuthorityConflictRow[] = publishRelevantRows
    .filter((r) => r.taxonomy_status === "authority_conflict")
    .map((r) => {
      const conflicts = conflictsBySpecies.get(r.id) ?? [];
      return {
        species_id: r.id,
        scientific_name: r.scientific_name,
        conflict_count: conflicts.length,
        conflicts,
      };
    });

  // ── classification_issues ─────────────────────────────────────────────────
  // Denormalized classification (kingdom/phylum/.../genus as plain columns)
  // requires no blanks and consistent higher taxa within a genus — see the
  // GBIF checklist best-practices guide's requirements for this style.
  const HIGHER_RANKS = ["kingdom", "phylum", "class", "order", "family"] as const;
  const classificationIssues: ClassificationIssueRow[] = [];

  for (const r of publishRelevantRows) {
    const missing = HIGHER_RANKS.filter((rank) => !(r as Record<string, unknown>)[rank]);
    if (missing.length > 0) {
      classificationIssues.push({
        species_id: r.id,
        scientific_name: r.scientific_name,
        issue: "missing_rank",
        detail: `Missing ${missing.join(", ")}`,
      });
    }
  }

  const byGenus = new Map<string, typeof publishRelevantRows>();
  for (const r of publishRelevantRows) {
    const genus = (r as Record<string, unknown>).genus as string | null;
    if (!genus) continue;
    const group = byGenus.get(genus) ?? [];
    group.push(r);
    byGenus.set(genus, group);
  }
  for (const [genus, group] of byGenus.entries()) {
    if (group.length <= 1) continue;
    for (const rank of ["family", "order", "class", "phylum", "kingdom"] as const) {
      const values = new Set(
        group.map((r) => (r as Record<string, unknown>)[rank] as string | null).filter(Boolean),
      );
      if (values.size > 1) {
        for (const r of group) {
          classificationIssues.push({
            species_id: r.id,
            scientific_name: r.scientific_name,
            issue: "inconsistent_genus",
            detail: `Genus ${genus} has inconsistent ${rank} (${Array.from(values).join(" vs. ")})`,
          });
        }
      }
    }
  }

  // ── review_status_counts ─────────────────────────────────────────────────
  const reviewStatusCounts: ReviewStatusCounts = {
    not_reviewed: 0,
    under_review: 0,
    accepted: 0,
    rejected: 0,
  };
  for (const r of rows) {
    const status = r.review_status as keyof ReviewStatusCounts | undefined;
    if (status && status in reviewStatusCounts) {
      reviewStatusCounts[status] += 1;
    }
  }

  const inconsistentGenusCount = classificationIssues.filter((i) => i.issue === "inconsistent_genus").length;

  const isReady =
    rows.length > 0 &&
    reviewStatusCounts.not_reviewed === 0 &&
    reviewStatusCounts.under_review === 0 &&
    duplicateGroups.length === 0 &&
    unresolvedTaxa.length === 0 &&
    authorityConflicts.length === 0 &&
    inconsistentGenusCount === 0;

  const report: ValidationReport = {
    checklist_id: checklistId,
    total_species: rows.length,
    unique_accepted_taxon_ids: uniqueAcceptedTaxonIds,
    duplicate_groups: duplicateGroups,
    synonym_pairs: synonymPairs,
    unresolved_taxa: unresolvedTaxa,
    authority_conflicts: authorityConflicts,
    classification_issues: classificationIssues,
    review_status_counts: reviewStatusCounts,
    is_ready: isReady,
    generated_at: new Date().toISOString(),
  };

  return NextResponse.json(report);
}
