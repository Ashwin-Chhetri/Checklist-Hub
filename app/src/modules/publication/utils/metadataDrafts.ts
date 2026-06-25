import type { Checklist, ChecklistMetadata } from "@/types/checklist.types";
import type { DatasetSummary, SourceSummaryRow } from "./checklistStats";

/** Seed keyword tags from the checklist's taxonomic scope + region — only used to pre-fill an empty Keywords field, never overwrites an edited list. */
export function draftKeywords(checklist: Checklist): string[] {
  const candidates = [
    checklist.taxonomic_scope?.class,
    checklist.taxonomic_scope?.kingdom,
    checklist.region_name,
    checklist.region_state,
    checklist.region_country,
  ];
  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const c of candidates) {
    const value = c?.trim().toUpperCase();
    if (value && !seen.has(value)) {
      seen.add(value);
      keywords.push(value);
    }
  }
  return keywords;
}

function regionLabel(checklist: Checklist): string {
  return [checklist.region_name, checklist.region_state, checklist.region_country].filter(Boolean).join(", ");
}

export function draftShortDescription(checklist: Checklist, stats: DatasetSummary): string {
  const taxon = checklist.taxonomic_scope?.class ?? checklist.taxonomic_scope?.kingdom ?? "species";
  const region = regionLabel(checklist);
  return `A checklist of ${stats.total} ${taxon} taxa documented in ${region || "the surveyed region"}.`;
}

export function draftPurpose(checklist: Checklist): string {
  const region = regionLabel(checklist);
  return `To provide a consolidated, taxonomically validated reference list supporting biodiversity research, conservation planning, and monitoring in ${region || "the surveyed region"}.`;
}

export function draftAbstract(checklist: Checklist, stats: DatasetSummary, earliest: number | null, latest: number | null): string {
  const taxon = checklist.taxonomic_scope?.class ?? checklist.taxonomic_scope?.kingdom ?? "species";
  const region = regionLabel(checklist);
  const yearRange = earliest && latest ? ` Records span ${earliest}–${latest}.` : "";
  return `This dataset, '${checklist.title}', comprises ${stats.total} ${taxon} taxa across ${stats.families} families and ${stats.genera} genera, compiled from occurrence and literature records for ${region || "the surveyed region"}.${yearRange} Taxonomy follows the GBIF Backbone Taxonomy.`;
}

export function draftTaxonomicScopeDescription(checklist: Checklist, stats: DatasetSummary): string {
  const kingdom = checklist.taxonomic_scope?.kingdom ?? "Animalia";
  const klass = checklist.taxonomic_scope?.class;
  const scope = klass ? `${klass} (${kingdom})` : kingdom;
  return `Comprehensive list of all ${scope} taxa documented within the checklist's region, comprising ${stats.families} families and ${stats.total} species, resolved against the GBIF Backbone Taxonomy.`;
}

export function draftMethodology(checkedSourceLabels: string[]): string {
  if (checkedSourceLabels.length === 0) {
    return "Records compiled and taxonomically validated against the GBIF Backbone Taxonomy.";
  }
  return `Records compiled from ${checkedSourceLabels.join(", ")}, with taxonomy validated against the GBIF Backbone Taxonomy.`;
}

export function draftTaxonomicValidation(): string {
  return "Scientific names resolved and validated against the GBIF Backbone Taxonomy; conflicts and synonyms reviewed by collaborators before acceptance.";
}

export function draftCriteria(): string {
  return "A taxon is included once at least one occurrence record, literature reference, or other verifiable evidence source has been reviewed and accepted by a collaborator.";
}

export const EMPTY_METADATA: Partial<ChecklistMetadata> = {
  keywords: [],
  language: "English",
  dataset_type: "Species Checklist",
  methods_data_sources: [],
  dataset_version: "1.0",
  is_funded: false,
};

/**
 * Seeds every metadata field that has a sensible auto-fill source (region,
 * species counts, taxonomic scope, evidence sources) with a draft value,
 * but only where the saved/existing value is empty — never overwrites a
 * collaborator's edits. Publishing Organization and License & Rights are
 * intentionally left untouched here; the page never seeds them.
 */
export function seedMetadataDefaults(
  existing: ChecklistMetadata | null,
  checklist: Checklist | undefined,
  stats: DatasetSummary,
  temporal: { earliest: number | null; latest: number | null },
  sources: SourceSummaryRow[],
): Partial<ChecklistMetadata> {
  const base: Partial<ChecklistMetadata> = existing ?? EMPTY_METADATA;
  if (!checklist) return base;

  const checkedSourceLabels = sources.map((s) => s.label);

  return {
    ...base,
    keywords: base.keywords && base.keywords.length > 0 ? base.keywords : draftKeywords(checklist),
    short_description: base.short_description?.trim() || draftShortDescription(checklist, stats),
    purpose: base.purpose?.trim() || draftPurpose(checklist),
    abstract: base.abstract?.trim() || draftAbstract(checklist, stats, temporal.earliest, temporal.latest),
    temporal_earliest_year: base.temporal_earliest_year ?? temporal.earliest,
    temporal_latest_year: base.temporal_latest_year ?? temporal.latest,
    geo_country: base.geo_country ?? checklist.region_country,
    geo_state: base.geo_state ?? checklist.region_state,
    geo_region_name: base.geo_region_name ?? checklist.region_name,
    taxonomic_scope_description: base.taxonomic_scope_description?.trim() || draftTaxonomicScopeDescription(checklist, stats),
    methods_data_sources:
      base.methods_data_sources && base.methods_data_sources.length > 0
        ? base.methods_data_sources
        : checkedSourceLabels,
    methodology: base.methodology?.trim() || draftMethodology(checkedSourceLabels),
    taxonomic_validation: base.taxonomic_validation?.trim() || draftTaxonomicValidation(),
    criteria: base.criteria?.trim() || draftCriteria(),
  };
}
