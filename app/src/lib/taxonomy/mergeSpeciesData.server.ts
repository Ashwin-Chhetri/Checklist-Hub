export interface MergeableEvidenceSource {
  source: string;
  record_count?: number;
  unique_count?: number;
  [key: string]: unknown;
}

export interface MergeableEvidence {
  occurrence_count?: number;
  publication_count?: number;
  checklist_matches_count?: number;
  sources?: MergeableEvidenceSource[];
  external_ids?: Record<string, string | number>;
  basis_of_record_breakdown?: Record<string, number>;
  revisions?: unknown[];
  [key: string]: unknown;
}

export const HIERARCHY_FIELDS = ["kingdom", "phylum", "class", "order", "family", "genus"] as const;

/** Merges evidence from one or more other rows into a canonical row's evidence. */
export function mergeEvidence(canonical: MergeableEvidence, others: MergeableEvidence[]): MergeableEvidence {
  const sourcesMap = new Map<string, MergeableEvidenceSource>();
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
      sourcesMap.set(
        s.source,
        existing
          ? {
              ...existing,
              record_count: (existing.record_count ?? 0) + (s.record_count ?? 0),
              unique_count: (existing.unique_count ?? 0) + (s.unique_count ?? 0),
            }
          : { ...s },
      );
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
export function fillHierarchy(
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
