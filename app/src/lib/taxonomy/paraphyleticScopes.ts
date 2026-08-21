/**
 * Vernacular groups that are NOT a single clade, and so cannot be expressed
 * as one taxon at one rank.
 *
 * These have to be curated because every name-matching strategy gets them
 * wrong in the same way — iNaturalist reports "Moths" as a matched common
 * name for order Lepidoptera, but Lepidoptera is butterflies *and* moths, so
 * a moth checklist built from that suggestion silently includes every
 * butterfly. The only faithful encoding is an include plus one or more
 * excludes, which is exactly what `ScopeNode.mode` exists for.
 *
 * Kept deliberately small: only groups where the naive answer is actively
 * wrong, not merely imprecise. Anything iNat's own common-name index resolves
 * correctly (reptiles → Reptilia, snakes → Serpentes, sharks → Selachii)
 * belongs in the general path, not here.
 *
 * ids and ranks below were each verified against api.inaturalist.org.
 */

import type { RankName } from "./ranks";

export interface ParaphyleticTaxon {
  rank: RankName;
  name: string;
  inatId: number;
}

export interface ParaphyleticScope {
  /** What the group is, for the suggestion banner's explanation line. */
  note: string;
  include: ParaphyleticTaxon[];
  exclude: ParaphyleticTaxon[];
}

const LEPIDOPTERA: ParaphyleticTaxon = { rank: "order", name: "Lepidoptera", inatId: 47157 };
const PAPILIONOIDEA: ParaphyleticTaxon = { rank: "superfamily", name: "Papilionoidea", inatId: 47224 };
const VERTEBRATA: ParaphyleticTaxon = { rank: "subphylum", name: "Vertebrata", inatId: 355675 };

const TETRAPOD_CLASSES: ParaphyleticTaxon[] = [
  { rank: "class", name: "Amphibia", inatId: 20978 },
  { rank: "class", name: "Reptilia", inatId: 26036 },
  { rank: "class", name: "Aves", inatId: 3 },
  { rank: "class", name: "Mammalia", inatId: 40151 },
];

const SCOPES: Record<string, ParaphyleticScope> = {
  moths: {
    note: "Moths are all Lepidoptera except the butterflies (superfamily Papilionoidea).",
    include: [LEPIDOPTERA],
    exclude: [PAPILIONOIDEA],
  },
  wasps: {
    note: "Wasps are the narrow-waisted Hymenoptera excluding bees and ants.",
    include: [{ rank: "suborder", name: "Apocrita", inatId: 124417 }],
    exclude: [
      { rank: "superfamily", name: "Apoidea", inatId: 47222 },
      { rank: "family", name: "Formicidae", inatId: 47336 },
    ],
  },
  fishes: {
    note: "Fishes are the vertebrates excluding the four tetrapod classes.",
    include: [VERTEBRATA],
    exclude: TETRAPOD_CLASSES,
  },
  invertebrates: {
    note: "Invertebrates are all animals except the vertebrates.",
    include: [{ rank: "kingdom", name: "Animalia", inatId: 1 }],
    exclude: [VERTEBRATA],
  },
};

/** Vernacular spellings that map onto the same entry. */
const ALIASES: Record<string, string> = {
  moth: "moths",
  wasp: "wasps",
  fish: "fishes",
  fishe: "fishes", // the naive singularizer turns "fishes" into "fishe"
  invertebrate: "invertebrates",
};

export function matchParaphyleticScope(term: string): ParaphyleticScope | null {
  const key = term.trim().toLowerCase();
  return SCOPES[key] ?? SCOPES[ALIASES[key] ?? ""] ?? null;
}
