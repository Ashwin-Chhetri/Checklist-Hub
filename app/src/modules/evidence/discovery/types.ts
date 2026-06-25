import type { TaxonomicScope } from "@/types/checklist.types";
import type { RegionValue } from "@/components/checklist-wizard/step1/RegionInput";
import type { LiteratureDocument } from "./literature/types";

/**
 * Evidence Discovery System — core contracts.
 *
 * The system discovers species reported within a Region X + Taxon Y from any
 * number of evidence sources, normalizes every name against the local GBIF
 * backbone, and aggregates the result into a single species inventory.
 *
 * Adding a new evidence source means writing one `EvidenceProvider` and
 * registering it in `registry.ts` — no changes to the aggregator or UI.
 */

export type SourceKey = "gbif" | "ebird" | "inaturalist" | "literature";

/** Everything a provider needs to discover species for the selected scope. */
export interface DiscoveryContext {
  taxonomicScope: TaxonomicScope;
  /** GBIF backbone key for the deepest selected rank (drives the GBIF query). */
  deepestTaxonKey: number | null;
  /** Scientific name of the deepest selected rank (e.g. "Aves", "Felidae"). */
  deepestTaxonName: string | null;
  /** Rank of the deepest selected level, lowercase (e.g. "class", "family"). */
  deepestTaxonRank: string | null;
  /** GADM id of the region, when known (narrows GBIF occurrence queries). */
  gadmGid: string | null;
  region: RegionValue;
}

/** A single raw species record as reported by one source, pre-normalization. */
export interface RawSpeciesRecord {
  source: SourceKey;
  /** The name exactly as the source reported it. */
  scientificName: string;
  /** A GBIF backbone key, when the source provides one (GBIF does). */
  gbifKey?: number;
  commonName?: string;
  family?: string;
  /** Source-reported occurrence/observation count, when available. */
  occurrenceCount?: number;
  latestObservationDate?: string;
  earliestObservationDate?: string;
  /** Source-specific extras (doi, reference text, eBird species code, …). */
  metadata?: Record<string, unknown>;
  /** This record's own taxon key as matched in the backbone (may differ from the accepted group's key). */
  ownTaxonKey?: number;
  /** This record's standing in the backbone relative to the accepted taxon it was normalized to. */
  taxonomicStatus?: TaxonomicStatus;
}

export type TaxonomicStatus = "accepted" | "synonym" | "doubtful" | "none";

/**
 * One historical/accepted name within a species' taxonomic revision group,
 * with its own occurrence counts. Never summed across entries — preserves
 * taxonomic history for the workbench to resolve later.
 */
export interface SpeciesRevision {
  taxonKey: number | null;
  scientificName: string;
  status: TaxonomicStatus;
  occurrenceCounts: Partial<Record<SourceKey, number>>;
}

export type ProviderStatus = "ok" | "empty" | "disabled" | "error";

/** Outcome of running one provider, before cross-source aggregation. */
export interface ProviderRunResult {
  source: SourceKey;
  status: ProviderStatus;
  records: RawSpeciesRecord[];
  message?: string;
  /** Prior checklist/survey publications detected by the literature provider (see literature/priorChecklist.ts). */
  priorChecklists?: LiteratureDocument[];
}

/** A provider discovers raw species records for one evidence source. */
export interface EvidenceProvider {
  key: SourceKey;
  label: string;
  /**
   * Short description of what `occurrenceCount`/`totalOccurrences` represents
   * for this source (e.g. "occurrence records", "recent observations (30d)").
   * Shown next to the count in the inventory summary so the two numbers
   * (species count vs. occurrence count) aren't assumed to be on the same
   * scale or timeframe.
   */
  occurrenceLabel: string;
  /** Whether this provider can run for the given context (e.g. eBird ⇒ Aves only). */
  isEnabled(ctx: DiscoveryContext): { enabled: boolean; reason?: string };
  /** Fetch raw species records. May throw; the aggregator records the error. */
  discover(ctx: DiscoveryContext): Promise<RawSpeciesRecord[]>;
}

/** One species in the unified inventory, after normalization + dedup. */
export interface InventorySpecies {
  /** Accepted local GBIF backbone taxon key, or null when unresolved. */
  taxonKey: number | null;
  /** Accepted scientific name (falls back to the raw name when unresolved). */
  acceptedName: string;
  canonicalName: string;
  /** Authorship string for the accepted name, e.g. "(Vigors, 1831)". */
  authority?: string;
  /** Common/vernacular name from any contributing source (first one wins). */
  commonName?: string;
  /** Every distinct common name reported across sources, including `commonName`
   * itself — e.g. eBird may say "Medium Egret" while iNaturalist says
   * "Intermediate Egret" for the same taxon. Kept so taxonomy enrichment can
   * try each one against the backbone instead of only the first source's pick. */
  alternateCommonNames?: string[];
  rank: string | null;
  family: string | null;
  classification: {
    kingdom: string | null;
    phylum: string | null;
    class: string | null;
    order: string | null;
    family: string | null;
    genus: string | null;
  };
  /** Sources that reported this species (deduped). */
  sources: SourceKey[];
  /** Per-source occurrence/observation counts. */
  occurrenceCounts: Partial<Record<SourceKey, number>>;
  /** Total occurrence count across all sources. */
  totalOccurrences: number;
  /** True when the name could not be matched against the backbone. */
  unresolved: boolean;
  /** All raw records that collapsed into this species (supporting evidence). */
  records: RawSpeciesRecord[];
  /**
   * One entry per distinct (taxonKey, taxonomicStatus) seen among `records`,
   * each retaining its own name and occurrence counts — never summed across
   * entries. A species with no synonym/doubtful records has a single entry
   * mirroring `occurrenceCounts`/`totalOccurrences`.
   */
  revisions: SpeciesRevision[];
  /**
   * Populated when one or more evidence sources (iNat, eBird, etc.) reported
   * this species using a GBIF synonym name rather than the accepted name.
   * Each entry records which source used which synonym so the workbench can
   * flag the discrepancy for user review — without auto-renaming anything.
   */
  sourceSynonyms?: Array<{
    source: SourceKey;
    /** The outdated name the source reported. */
    synonymName: string;
    /** The backbone-accepted name this resolves to. */
    acceptedName: string;
  }>;
}

/** Per-source roll-up shown in the "evidence summary by source" view. */
export interface SourceSummary {
  source: SourceKey;
  label: string;
  status: ProviderStatus;
  /** Distinct accepted species contributed by this source. */
  speciesCount: number;
  /**
   * Sum of `occurrenceCount` across contributing species — see
   * `occurrenceLabel` for what this represents for this source. Not
   * necessarily >= `speciesCount`: e.g. eBird's species count covers the
   * full all-time checklist, while its occurrence count only covers species
   * with recent (30-day) observations.
   */
  totalOccurrences: number;
  /** Describes what `totalOccurrences` counts for this source (see `EvidenceProvider.occurrenceLabel`). */
  occurrenceLabel: string;
  message?: string;
}

/** The unified species inventory for a Region X + Taxon Y. */
export interface SpeciesInventory {
  species: InventorySpecies[];
  totalSpecies: number;
  /** Species that matched an accepted backbone taxon. */
  resolvedSpecies: number;
  sourceSummary: SourceSummary[];
  /** Existing checklist/survey publications found for this taxon+region (deduped, informational only). */
  priorChecklists: LiteratureDocument[];
  generatedAt: string;
}
