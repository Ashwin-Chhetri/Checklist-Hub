import { matchCanonicalSpecies } from "./backboneMatch";
import type { LiteratureDocument, LiteratureSpeciesCandidate } from "./types";

// Matches "Genus species" — capitalized genus followed by a lowercase
// epithet. Over-matches plenty of non-taxonomic capitalized phrases (e.g.
// "Western Ghats"), but those are filtered out by the backbone validation in
// matchCanonicalSpecies, which only keeps real accepted/synonym species names.
const BINOMIAL_PATTERN = /\b([A-Z][a-z]{2,})\s+([a-z][a-z-]{2,})\b/g;

// Matches abbreviated-genus mentions like "T. boulboul" — common when a
// document repeats a genus already spelled out elsewhere in the same title/abstract.
const ABBREVIATED_BINOMIAL_PATTERN = /\b([A-Z])\.\s+([a-z][a-z-]{2,})\b/g;

/**
 * Extracts full "Genus species" binomials plus abbreviated-genus mentions
 * ("G. species") expanded using full genus names seen elsewhere in the same
 * text. Abbreviations are only expanded when exactly one full genus starting
 * with that letter was seen in this document — avoids cross-genus mix-ups.
 */
function extractCandidateNames(text: string): string[] {
  const names = new Set<string>();
  const genusByInitial = new Map<string, Set<string>>();

  for (const match of text.matchAll(BINOMIAL_PATTERN)) {
    names.add(`${match[1]} ${match[2]}`);
    const initial = match[1][0];
    const set = genusByInitial.get(initial) ?? new Set<string>();
    set.add(match[1]);
    genusByInitial.set(initial, set);
  }

  for (const match of text.matchAll(ABBREVIATED_BINOMIAL_PATTERN)) {
    const genera = genusByInitial.get(match[1]);
    if (genera && genera.size === 1) {
      names.add(`${[...genera][0]} ${match[2]}`);
    }
  }

  return [...names];
}

/**
 * Fallback species extraction for the literature pipeline when LLM-based
 * extraction is disabled or yields nothing: scans candidate documents'
 * titles/abstracts for "Genus species" patterns and keeps only those that
 * resolve to real accepted/synonym species in the local GBIF backbone (scoped
 * to the taxon group's class where possible). No external API keys required.
 */
export function extractSpeciesFromCandidates(
  candidates: LiteratureDocument[],
  taxonHint?: string,
  maxDocuments = candidates.length,
): LiteratureSpeciesCandidate[] {
  const docsToScan = candidates.slice(0, maxDocuments);

  const allNames = new Set<string>();
  const namesByDoc = new Map<LiteratureDocument, string[]>();
  for (const doc of docsToScan) {
    const text = `${doc.title} ${doc.abstract ?? ""}`;
    const names = extractCandidateNames(text);
    namesByDoc.set(doc, names);
    names.forEach((n) => allNames.add(n));
  }

  const matched = matchCanonicalSpecies([...allNames], taxonHint);
  if (matched.size === 0) return [];

  const seen = new Set<string>();
  const species: LiteratureSpeciesCandidate[] = [];
  for (const doc of docsToScan) {
    for (const name of namesByDoc.get(doc) ?? []) {
      const match = matched.get(name);
      if (!match || seen.has(match.canonicalName)) continue;
      seen.add(match.canonicalName);
      species.push({
        scientificName: match.canonicalName,
        sourceDocument: { title: doc.title, doi: doc.doi, url: doc.url, year: doc.year },
      });
    }
  }
  return species;
}
