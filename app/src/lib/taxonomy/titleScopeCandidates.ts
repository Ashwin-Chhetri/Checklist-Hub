/**
 * Turns a free-text checklist title (e.g. "Birds of Darjeeling") into an
 * ordered list of candidate phrases to try against the vernacular-name
 * lookup. Deliberately has no notion of *which* words are taxonomic groups —
 * it only strips generic English function words/locative prepositions, so it
 * works for any group name the GBIF backbone's vernacular-names table knows
 * about (bird, plant, fungus, insect, ... groups alike) without hardcoding a
 * vocabulary of species/clade names here.
 */

const STOPWORDS = new Set([
  "a", "an", "the", "and", "of", "in", "on", "at", "for", "from", "to", "with", "near", "around", "&",
]);

const LOCATIVE_SPLIT_RE = /\s+(?:of|in|near|around|from|at)\s+/i;
const GROUP_SPLIT_RE = /\s*(?:,|&|\band\b)\s*/i;

export function extractScopeCandidates(title: string): string[] {
  const trimmed = title.trim();
  if (!trimmed) return [];

  const candidates: string[] = [];
  const seen = new Set<string>();
  function add(s: string) {
    const c = s.trim();
    if (c.length < 3) return;
    const key = c.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(c);
  }

  // The portion before the first locative preposition ("... of/in/near ...")
  // is usually the taxonomic subject; the rest is a place name.
  const subject = trimmed.split(LOCATIVE_SPLIT_RE)[0];
  add(subject);

  // "Reptiles and Amphibians of Sikkim" -> try each coordinated group too.
  for (const group of subject.split(GROUP_SPLIT_RE)) add(group);

  // Last resort: individual content words, dropping generic function words.
  for (const word of subject.split(/\s+/)) {
    if (!STOPWORDS.has(word.toLowerCase())) add(word);
  }

  return candidates;
}
