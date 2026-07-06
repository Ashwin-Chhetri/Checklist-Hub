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

// Generic size/frequency descriptors that qualify a group rather than name
// one — e.g. "Small Mammals"/"Large Mammals" both mean the group "Mammals".
// Stripping these (in addition to trying the phrase unstripped) lets the
// bare group name still resolve without guessing what "small"/"large" means
// taxonomically.
const LEADING_DESCRIPTOR_RE =
  /^(small|large|big|tiny|giant|common|rare|wild|domestic|native|introduced|endemic|migratory|nocturnal|diurnal|freshwater|marine|terrestrial|aquatic)\s+/i;

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
  const groups = subject.split(GROUP_SPLIT_RE);
  for (const group of groups) add(group);

  // "Small Mammals"/"Large Mammals" -> also try the bare group name.
  for (const group of [subject, ...groups]) {
    let stripped = group;
    let prev = "";
    while (prev !== stripped) {
      prev = stripped;
      stripped = stripped.replace(LEADING_DESCRIPTOR_RE, "");
    }
    if (stripped !== group) add(stripped);
  }

  // Last resort: individual content words, dropping generic function words.
  const words = subject.split(/\s+/).filter((w) => !STOPWORDS.has(w.toLowerCase()));
  for (const word of words) add(word);

  // Plural forms rarely match a species/genus vernacular name verbatim (e.g.
  // "Tigers" vs. "Tiger") — append naive singularizations as lower-priority
  // fallbacks, tried only once every exact/plural candidate above has missed.
  for (const word of words) {
    const singular = singularize(word);
    if (singular) add(singular);
  }

  return candidates;
}

function singularize(word: string): string | null {
  if (/[a-z]ies$/i.test(word)) return word.slice(0, -3) + "y";
  if (/[^s]s$/i.test(word) && word.length > 3) return word.slice(0, -1);
  return null;
}
