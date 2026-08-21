import { NextResponse } from "next/server";
import { lookupByVernacularName, matchVernacularTaxonId } from "@/lib/taxonomy/backbone.server";
import { matchHigherRankVernacular } from "@/lib/taxonomy/higherRankVernacular.server";
import { extractScopeCandidates } from "@/lib/taxonomy/titleScopeCandidates";
import { getInatLineage, getInatTaxaByIds, searchInatTaxa, type InatTaxon } from "@/lib/taxonomy/inat.server";
import { matchParaphyleticScope, type ParaphyleticScope } from "@/lib/taxonomy/paraphyleticScopes";
import { attachGbifKeys } from "@/lib/taxonomy/scopeGbifBridge.server";
import { CORE_RANKS, type CoreRankName, type RankName, isCoreRank, isRankName } from "@/lib/taxonomy/ranks";
import { deriveFlatScope, sortNodes } from "@/lib/taxonomy/scopeNodes";
import type { ScopeNode } from "@/types/checklist.types";

/**
 * Best-effort taxonomic scope suggestion for a checklist title, e.g.
 * "Butterflies of Darjeeling" -> order Lepidoptera + superfamily
 * Papilionoidea.
 *
 * Each candidate phrase extracted from the title is tried three ways, in
 * descending order of how much the answer can be trusted:
 *
 *  1. **Curated paraphyletic groups.** A handful of common vernaculars name
 *     groups that are not a clade, and every name-matching strategy gets them
 *     wrong identically — iNaturalist lists "Moths" as a common name of order
 *     Lepidoptera, which also contains every butterfly. These are pinned to an
 *     explicit include/exclude scope. See paraphyleticScopes.ts.
 *
 *  2. **iNaturalist name search.** The only source that reaches the sub-ranks
 *     GBIF's backbone has no taxa at, which is where the precision lives:
 *     "butterflies" is superfamily Papilionoidea, "snakes" is suborder
 *     Serpentes, "tiger beetles" is family Cicindelidae. Selection is by exact
 *     matched-term, never by popularity — ordering iNat's results by
 *     observation count puts Lepidoptera ("Butterflies and Moths") above
 *     Papilionoidea ("Butterflies") for the query "butterflies", i.e. exactly
 *     backwards.
 *
 *  3. **The local GBIF backbone mirror**, as before. Covers species/genus
 *     vernaculars ("Tiger") and higher-rank group names the mirror knows.
 *
 * Only step 1 hardcodes any taxon names, and only for groups that are
 * definitionally not clades.
 */

interface GbifSpeciesRecord {
  kingdom?: string;
  phylum?: string;
  class?: string;
  order?: string;
  family?: string;
  genus?: string;
  species?: string;
  taxonomicStatus?: string;
  acceptedKey?: number;
}

// Per-warm-instance cache — group-level classifications (e.g. "Aves") are
// looked up repeatedly across users/checklists and don't change at runtime.
const classificationCache = new Map<number, GbifSpeciesRecord | null>();

async function fetchGbifClassification(taxonId: number): Promise<GbifSpeciesRecord | null> {
  if (classificationCache.has(taxonId)) return classificationCache.get(taxonId) ?? null;
  try {
    const res = await fetch(`https://api.gbif.org/v1/species/${taxonId}`);
    if (!res.ok) {
      classificationCache.set(taxonId, null);
      return null;
    }
    const data = (await res.json()) as GbifSpeciesRecord;
    const resolved =
      data.taxonomicStatus === "SYNONYM" && data.acceptedKey
        ? (await fetchGbifClassification(data.acceptedKey)) ?? data
        : data;
    classificationCache.set(taxonId, resolved);
    return resolved;
  } catch {
    classificationCache.set(taxonId, null);
    return null;
  }
}

function hasAnyRank(c: GbifSpeciesRecord): boolean {
  return Boolean(c.kingdom || c.phylum || c.class || c.order || c.family || c.genus || c.species);
}

/** Loose comparison for vernacular strings: case, punctuation and spacing all vary. */
function normalizeTerm(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Pick the taxon a search term actually names.
 *
 * Requires the hit's own scientific name, or the common name iNat reports it
 * matched, to equal the query outright. A term that merely appears inside a
 * longer common name ("Butterflies" within "Butterflies and Moths") names a
 * broader group than the user asked for, and accepting it is precisely what
 * makes butterfly and moth checklists come out identical.
 */
function pickInatScopeTaxon(results: InatTaxon[], query: string): InatTaxon | null {
  const wanted = normalizeTerm(query);
  if (!wanted) return null;
  return (
    results.find(
      (t) =>
        normalizeTerm(t.name) === wanted ||
        (t.matchedTerm ? normalizeTerm(t.matchedTerm) === wanted : false) ||
        (t.commonName ? normalizeTerm(t.commonName) === wanted : false),
    ) ?? null
  );
}

/** Turn an iNat taxon plus its ancestry into an ordered include-node chain. */
function lineageToNodes(chain: InatTaxon[]): ScopeNode[] {
  return chain
    .filter((t) => isRankName(String(t.rank)))
    .map((t) => ({
      rank: t.rank as RankName,
      name: t.name,
      inatId: t.id,
      gbifKey: null,
      mode: "include" as const,
    }));
}

async function nodesFromInatTaxon(taxon: InatTaxon): Promise<ScopeNode[]> {
  const lineage = await getInatLineage(taxon);
  return attachGbifKeys(sortNodes(lineageToNodes([...lineage, taxon])));
}

async function nodesFromParaphyletic(scope: ParaphyleticScope): Promise<ScopeNode[]> {
  const deepest = scope.include[scope.include.length - 1];
  const [taxon] = await getInatTaxaByIds([deepest.inatId]);

  const includeNodes = taxon
    ? lineageToNodes([...(await getInatLineage(taxon)), taxon])
    : scope.include.map((t) => ({ ...t, gbifKey: null, mode: "include" as const }));

  const excludeNodes: ScopeNode[] = scope.exclude.map((t) => ({
    rank: t.rank,
    name: t.name,
    inatId: t.inatId,
    gbifKey: null,
    mode: "exclude" as const,
  }));

  return attachGbifKeys(sortNodes([...includeNodes, ...excludeNodes]));
}

/** Nodes built by the legacy GBIF path, which only ever knows principal ranks. */
function nodesFromClassification(classification: Partial<Record<CoreRankName, string | null>>): ScopeNode[] {
  const nodes: ScopeNode[] = [];
  for (const rank of CORE_RANKS) {
    const name = classification[rank];
    if (name) nodes.push({ rank, name, gbifKey: null, inatId: null, mode: "include" });
  }
  return nodes;
}

function respond(matchedTerm: string, nodes: ScopeNode[], note?: string) {
  const flat = deriveFlatScope(nodes);
  return NextResponse.json({
    matchedTerm,
    // The seven flat ranks, null-filled — the shape the suggestion banner has
    // always rendered. Kept so the banner needs no knowledge of nodes.
    classification: Object.fromEntries(CORE_RANKS.map((r) => [r, flat[r] ?? null])),
    nodes,
    enabledRanks: nodes.filter((n) => !isCoreRank(n.rank)).map((n) => n.rank),
    note: note ?? null,
  });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const title = searchParams.get("title") ?? "";

  for (const candidate of extractScopeCandidates(title)) {
    // 1 — Curated groups that are not clades.
    const paraphyletic = matchParaphyleticScope(candidate);
    if (paraphyletic) {
      const nodes = await nodesFromParaphyletic(paraphyletic);
      if (nodes.length) return respond(candidate, nodes, paraphyletic.note);
    }

    // 2 — iNaturalist, the only source carrying the sub-ranks.
    const inatHit = pickInatScopeTaxon(await searchInatTaxa(candidate, 15), candidate);
    if (inatHit) {
      const nodes = await nodesFromInatTaxon(inatHit);
      if (nodes.length) return respond(candidate, nodes);
    }

    // 3 — Local GBIF mirror. Exact-only vernacular hit first: checking it
    // before the fuzzy lookup below matters because that lookup's LIKE-based
    // fallback would otherwise match some unrelated species whose vernacular
    // name merely *contains* the group word (e.g. "Insects" fuzzy-matching a
    // scale insect's common name) before ever reaching the real group match.
    const taxonIds = await matchVernacularTaxonId(candidate);
    for (const taxonId of taxonIds) {
      const gbif = await fetchGbifClassification(taxonId);
      if (gbif && hasAnyRank(gbif)) {
        return respond(candidate, await attachGbifKeys(nodesFromClassification(gbif)));
      }
    }

    // The mirror's vernacular extract is itself incomplete for some higher
    // ranks (e.g. class Reptilia has zero vernacular rows there, despite
    // GBIF's live per-taxon endpoint listing "Reptiles") — a supplementary
    // index built from every kingdom/phylum/class/order in the real backbone
    // (scripts/build-higher-rank-vernacular.mjs) covers those gaps.
    const higherRank = matchHigherRankVernacular(candidate);
    if (higherRank) {
      return respond(candidate, await attachGbifKeys(nodesFromClassification(higherRank)));
    }

    // Species/genus-level common names (e.g. "Tiger"), which do have a row in
    // the mirror's (species-only) taxa table.
    const local = await lookupByVernacularName(candidate);
    if (local) {
      return respond(candidate, await attachGbifKeys(nodesFromClassification(local.classification)));
    }
  }

  return NextResponse.json({
    matchedTerm: null,
    classification: null,
    nodes: [],
    enabledRanks: [],
    note: null,
  });
}
