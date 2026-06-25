import { callDataService } from "@/lib/dataService.server";

export interface BackboneSpeciesMatch {
  canonicalName: string;
  scientificName: string;
}

/**
 * Validates a set of candidate "Genus species" binomial strings against the
 * GBIF backbone, keeping only accepted/synonym species-rank matches — or, if
 * no species-rank row matches, an accepted/synonym subspecies-rank row whose
 * canonical name starts with "Genus species " (a trinomial mention),
 * resolved to the parent species binomial. The backbone mirror lives on the
 * standalone reference-data-service (DigitalOcean) — see
 * reference-data-service/src/literatureMatch.js's matchCanonicalSpecies(),
 * which this proxies to.
 * When `taxonHint` is given (e.g. "Aves"), only matches whose
 * kingdom/phylum/class/order/family/genus includes that value are kept —
 * this scopes literature-extracted species to the taxonomic group the
 * checklist is being built for (a regional survey paper often mentions
 * species from several unrelated groups).
 */
export async function matchCanonicalSpecies(names: string[], taxonHint?: string): Promise<Map<string, BackboneSpeciesMatch>> {
  try {
    const result = await callDataService<Record<string, BackboneSpeciesMatch>>("/literature/match-species", {
      method: "POST",
      body: JSON.stringify({ names, taxonHint }),
    });
    return new Map(Object.entries(result));
  } catch (err) {
    console.error("[evidence/backboneMatch] reference-data-service call failed:", err);
    return new Map();
  }
}
