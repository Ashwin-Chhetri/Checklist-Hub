/**
 * The single source of truth for taxonomic ranks across the app.
 *
 * Before this module the 7-rank array was copy-pasted in eight places, with
 * three divergent shorter variants — so "which ranks exist" depended on which
 * file you happened to be reading.
 *
 * ## Why two backbones
 *
 * The GBIF backbone contains ONLY these ranks (verified against its own rank
 * facet): kingdom, phylum, class, order, family, genus, species, subspecies,
 * variety, form, unranked. It has no superfamily, subfamily, tribe, subtribe,
 * subgenus, subphylum, subclass, infraclass, suborder or infraorder — asking
 * `species/match?name=Papilionoidea` returns `matchType: "NONE"`, and the
 * children of Lepidoptera jump straight from ORDER to FAMILY.
 *
 * iNaturalist's taxonomy does carry all of them, so ranks GBIF cannot express
 * are marked `source: "inat"` and resolved through the iNat taxonomy routes
 * (`/api/taxonomy/inat/*`). Everything else stays on GBIF, which keeps the
 * existing chain selector, key resolution and import path untouched.
 *
 * `level` mirrors iNaturalist's own `rank_level` values so the two systems
 * sort identically and a rank can be compared across both without a mapping
 * table. Higher number = shallower rank.
 */

export interface RankDef {
  rank: RankName;
  /** iNaturalist `rank_level`. Higher = shallower (kingdom 70 … subspecies 5). */
  level: number;
  /** Core ranks always get a row in the selector; optional ranks are toggled on. */
  core: boolean;
  /** Which backbone can enumerate taxa at this rank. */
  source: "gbif" | "inat";
  /** For optional ranks: the core rank whose row carries this rank's toggle chip. */
  under?: RankName;
}

export type RankName =
  | "kingdom"
  | "phylum"
  | "subphylum"
  | "class"
  | "subclass"
  | "infraclass"
  | "order"
  | "suborder"
  | "infraorder"
  | "superfamily"
  | "family"
  | "subfamily"
  | "tribe"
  | "subtribe"
  | "genus"
  | "subgenus"
  | "species"
  | "subspecies";

/** Every rank, ordered shallow → deep. */
export const RANK_ORDER: readonly RankDef[] = [
  { rank: "kingdom", level: 70, core: true, source: "gbif" },
  { rank: "phylum", level: 60, core: true, source: "gbif" },
  { rank: "subphylum", level: 57, core: false, source: "inat", under: "phylum" },
  { rank: "class", level: 50, core: true, source: "gbif" },
  { rank: "subclass", level: 47, core: false, source: "inat", under: "class" },
  { rank: "infraclass", level: 45, core: false, source: "inat", under: "class" },
  { rank: "order", level: 40, core: true, source: "gbif" },
  { rank: "suborder", level: 37, core: false, source: "inat", under: "order" },
  { rank: "infraorder", level: 35, core: false, source: "inat", under: "order" },
  { rank: "superfamily", level: 33, core: false, source: "inat", under: "order" },
  { rank: "family", level: 30, core: true, source: "gbif" },
  { rank: "subfamily", level: 27, core: false, source: "inat", under: "family" },
  { rank: "tribe", level: 25, core: false, source: "inat", under: "family" },
  { rank: "subtribe", level: 24, core: false, source: "inat", under: "family" },
  { rank: "genus", level: 20, core: true, source: "gbif" },
  { rank: "subgenus", level: 15, core: false, source: "inat", under: "genus" },
  { rank: "species", level: 10, core: true, source: "gbif" },
  // GBIF has ~380k subspecies and `getChildTaxa(speciesKey)` already returns
  // them, so this optional rank needs no iNat call.
  { rank: "subspecies", level: 5, core: false, source: "gbif", under: "species" },
] as const;

/**
 * The seven principal ranks. Narrower than `RankName` because these are
 * exactly the keys the flat `TaxonomicScope` shape has, so anything indexing
 * that shape must be one of them.
 */
export type CoreRankName = "kingdom" | "phylum" | "class" | "order" | "family" | "genus" | "species";

/**
 * The seven principal ranks, in order. This is the shape the legacy flat
 * `TaxonomicScope` keys use and what every pre-existing consumer reads.
 */
export const CORE_RANKS = RANK_ORDER.filter((r) => r.core).map((r) => r.rank) as readonly CoreRankName[];

/** Ranks the user can toggle on beside a core rank's row. */
export const OPTIONAL_RANKS = RANK_ORDER.filter((r) => !r.core).map((r) => r.rank) as readonly RankName[];

/** Ranks GBIF's backbone can enumerate — the rest must go through iNaturalist. */
export const GBIF_RANKS = RANK_ORDER.filter((r) => r.source === "gbif").map((r) => r.rank) as readonly RankName[];

const BY_RANK = new Map<RankName, RankDef>(RANK_ORDER.map((r) => [r.rank, r]));
const INDEX_OF = new Map<RankName, number>(RANK_ORDER.map((r, i) => [r.rank, i]));

export function rankDef(rank: RankName): RankDef {
  const def = BY_RANK.get(rank);
  if (!def) throw new Error(`Unknown taxonomic rank: ${rank}`);
  return def;
}

export function isRankName(value: string): value is RankName {
  return BY_RANK.has(value as RankName);
}

/** Position in `RANK_ORDER` (0 = kingdom). Deeper ranks have a higher index. */
export function rankIndex(rank: RankName): number {
  const i = INDEX_OF.get(rank);
  if (i === undefined) throw new Error(`Unknown taxonomic rank: ${rank}`);
  return i;
}

export function isCoreRank(rank: RankName): boolean {
  return rankDef(rank).core;
}

/** True when GBIF's backbone can enumerate taxa at this rank. */
export function isGbifRank(rank: RankName): boolean {
  return rankDef(rank).source === "gbif";
}

/** The optional ranks whose toggle chips belong on `rank`'s row. */
export function optionalRanksUnder(rank: RankName): RankName[] {
  return RANK_ORDER.filter((r) => r.under === rank).map((r) => r.rank);
}

/**
 * The deepest GBIF-queryable rank at or above `rank` — the rank an
 * iNat-only selection has to be widened to before GBIF can be queried
 * (e.g. superfamily → order).
 */
export function nearestGbifRankAbove(rank: RankName): RankName {
  for (let i = rankIndex(rank); i >= 0; i -= 1) {
    if (RANK_ORDER[i].source === "gbif") return RANK_ORDER[i].rank;
  }
  return "kingdom";
}

/**
 * The shallowest GBIF-queryable rank below `rank` — the rank an iNat-only
 * selection gets expanded *down* to so GBIF can be queried by key
 * (e.g. superfamily → family, subgenus → species).
 */
export function nearestGbifRankBelow(rank: RankName): RankName | null {
  for (let i = rankIndex(rank) + 1; i < RANK_ORDER.length; i += 1) {
    if (RANK_ORDER[i].source === "gbif") return RANK_ORDER[i].rank;
  }
  return null;
}

/** Sort ranks shallow → deep. */
export function compareRanks(a: RankName, b: RankName): number {
  return rankIndex(a) - rankIndex(b);
}

/** GBIF's `rank` query param wants upper case (`FAMILY`, `ORDER`). */
export function toGbifRank(rank: RankName): string {
  return rank.toUpperCase();
}
