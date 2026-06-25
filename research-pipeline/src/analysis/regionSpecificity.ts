/**
 * Extracts the most specific (leftmost) part of a hierarchical region name,
 * e.g. "Darjeeling" from "Darjeeling district, West Bengal" or "Darjeeling
 * District of West Bengal, India". Region strings in this pipeline are
 * always given most-specific-first, so the first comma segment (with a
 * trailing "district" word stripped) is the part that actually matters for
 * "is this document about THIS place, not just the broader state/country
 * it sits in."
 */
export function extractMostSpecificToken(regionName: string): string {
  const firstPart = regionName.split(",")[0]?.trim() ?? regionName.trim();
  const districtMatch = firstPart.match(/^(.+?)\s+district\b/i);
  return (districtMatch ? districtMatch[1] : firstPart).trim();
}

export interface RegionMatchResult {
  /** 0-100, used directly as RelevanceVerdict.regionRelevance when no LLM is available. */
  score: number;
  reason: string;
  /** True when the text explicitly names a different country than the target region's own, with no match for the target region at all — a much stronger negative signal than "no place mentioned," used by preliminaryRelevance.ts for a hard score cap (same pattern as speciesRecordSignal.ts's strongTourismSignal). */
  wrongCountrySignal?: boolean;
  /** True when the only matched "broader" token is the country-level segment itself (the deepest/last comma segment, e.g. "India") with no match for the target's specific place OR any intermediate state/province — see the real "Nainital/Uttarakhand cleared a Darjeeling search" bug below. Almost any paper from the same country would clear this, so it's far weaker evidence than a real state/province-level match and gets its own (lower) score tier + hard cap in preliminaryRelevance.ts. */
  countryOnlySignal?: boolean;
}

/**
 * Real bug found via a "Darjeeling" + "Aves" run: papers titled "Birds of
 * Nepal" or about an Argentina/Patagonia bird survey were clearing the
 * review threshold, because a text mentioning neither "darjeeling" nor any
 * broader-token segment of the target region fell through to the same
 * score as a paper that mentions no place at all — there was no way to
 * tell "we don't know where this is" apart from "this explicitly says it's
 * somewhere else." Both now default low (see checkRegionSpecificity's
 * final fallback below) rather than treating "uncertain" as a near-neutral
 * positive; this list still exists as a separate, more specific reason —
 * a confirmed different country is more diagnostic than silence — but the
 * numeric outcome no longer depends on it being exhaustive. Deliberately
 * not an exhaustive gazetteer — just common country names, enough to
 * additionally catch the actual false
 * positives seen (Nepal, Argentina) without needing a geocoding call per
 * candidate (Stage A discovery handles hundreds of candidates before the
 * user even reviews; per-candidate geocoding is what regionContainment.ts
 * already does, deliberately only in Stage B, against real full text).
 * Includes the target region's own country (India, in the bug that
 * motivated this) — an EARLIER version of this list hardcoded an exclusion
 * for India specifically, which only worked because this pipeline's actual
 * usage so far has been Indian regions; it would have silently failed to
 * catch e.g. an India-based false positive for a Sri Lanka or Nepal search.
 * `ownCountryHint` (resolved once per run from the target region's own
 * geocoded boundary — see runPipeline.ts) is the general fix: whichever
 * country the target region itself is in gets excluded dynamically, for
 * any region, not just one hardcoded country.
 */
const COUNTRY_NAMES = [
  "afghanistan", "albania", "algeria", "argentina", "armenia", "australia", "austria", "azerbaijan",
  "bangladesh", "belarus", "belgium", "belize", "benin", "bhutan", "bolivia", "bosnia", "botswana", "brazil",
  "brunei", "bulgaria", "burkina faso", "burundi", "cambodia", "cameroon", "canada", "chad", "chile", "china",
  "colombia", "congo", "costa rica", "croatia", "cuba", "cyprus", "czech republic", "denmark", "ecuador",
  "egypt", "el salvador", "estonia", "ethiopia", "fiji", "finland", "france", "gabon", "georgia", "germany",
  "ghana", "greece", "guatemala", "guinea", "guyana", "haiti", "honduras", "hungary", "iceland", "india",
  "indonesia", "iran", "iraq", "ireland", "israel", "italy", "jamaica", "japan", "jordan", "kazakhstan",
  "kenya", "kosovo", "kuwait", "kyrgyzstan", "laos", "latvia", "lebanon", "liberia", "libya", "lithuania",
  "madagascar", "malawi", "malaysia", "maldives", "mali", "mauritania", "mauritius", "mexico", "moldova",
  "mongolia", "montenegro", "morocco", "mozambique", "myanmar", "namibia", "nepal", "netherlands",
  "new zealand", "nicaragua", "niger", "nigeria", "north korea", "north macedonia", "norway", "oman",
  "pakistan", "panama", "papua new guinea", "paraguay", "patagonia", "peru", "philippines", "poland",
  "portugal", "qatar", "romania", "russia", "rwanda", "saudi arabia", "senegal", "serbia", "sierra leone",
  "singapore", "slovakia", "slovenia", "somalia", "south africa", "south korea", "south sudan", "spain",
  "sri lanka", "sudan", "suriname", "sweden", "switzerland", "syria", "taiwan", "tajikistan", "tanzania",
  "thailand", "togo", "trinidad and tobago", "tunisia", "turkey", "turkmenistan", "uganda", "ukraine",
  "united arab emirates", "united kingdom", "uruguay", "uzbekistan", "venezuela", "vietnam", "yemen",
  "zambia", "zimbabwe",
] as const;

function detectOtherCountryMention(lowerText: string, knownOwnTokens: string[]): string | undefined {
  return COUNTRY_NAMES.find((country) => lowerText.includes(country) && !knownOwnTokens.some((own) => own.includes(country)));
}

/**
 * Deterministic, LLM-independent region-specificity check: does the text
 * mention the most specific part of the region name, or only its broader
 * parent (state/country)? Without this, a user asking for "Darjeeling"
 * literature got broader "West Bengal"-only papers mixed in indistinguishably
 * when no LLM was configured (regionRelevance was a flat 50 for everyone) —
 * this is what the heuristic fallback in relevanceScoring.ts uses instead.
 */
export function checkRegionSpecificity(text: string, regionName: string, ownCountryHint?: string): RegionMatchResult {
  const specific = extractMostSpecificToken(regionName).toLowerCase();
  const lowerText = text.toLowerCase();

  if (specific.length >= 3 && lowerText.includes(specific)) {
    return { score: 85, reason: `Mentions "${specific}" specifically.` };
  }

  // Broader/parent tokens: every comma segment of the region name, with
  // "district [of]" stripped, EXCLUDING any segment that still contains the
  // specific token as a substring (e.g. "Darjeeling District of West
  // Bengal" -> "Darjeeling  West Bengal" still contains "darjeeling", so
  // it's not a "broader-only" signal — only segments truly distinct from
  // the specific token count, e.g. a trailing "India").
  const broaderTokens = regionName
    .split(",")
    .map((segment) =>
      segment
        .replace(/\bdistrict\s+of\b/gi, "")
        .replace(/\bdistrict\b/gi, "")
        .trim()
        .toLowerCase(),
    )
    // length > 2 also drops purely-numeric postal-code segments (e.g.
    // "734101") that show up when regionName is the real resolved Nominatim
    // hierarchy (see runPipeline.ts) rather than just what the user typed —
    // a postal code is never going to appear verbatim in a paper's text
    // anyway, so it'd only ever be dead weight, not a real signal either way.
    .filter((t) => t.length > 2 && !/^\d+$/.test(t) && !t.includes(specific));

  const matchedBroader = broaderTokens.find((t) => lowerText.includes(t));
  if (matchedBroader) {
    // Real bug found via a "Darjeeling" + "Aves" run: a paper titled
    // "...Nainital district (western Himalaya) of Uttarakhand state,
    // India" — a different district AND a different state — still cleared
    // REVIEW_SCORE_THRESHOLD (70), because it mentions "India" (the
    // region's own outermost/country segment), which matchedBroader
    // accepted at the same score (25) as a real intermediate match like
    // "West Bengal" would get. Mentioning only the country is dramatically
    // weaker evidence than mentioning the actual state/province — nearly
    // any paper about anywhere in that country would clear it — so when
    // the ONLY broader match is the deepest/last segment (the country) and
    // there's at least one intermediate segment it did NOT match, score it
    // closer to "no match at all" instead, and flag it for an even harder
    // cap in preliminaryRelevance.ts.
    const countryToken = broaderTokens[broaderTokens.length - 1];
    if (matchedBroader === countryToken && broaderTokens.length > 1) {
      return {
        score: 15,
        reason: `Only mentions "${matchedBroader}" (the outermost/country context), not "${specific}" or any intermediate area — barely stronger than no match at all.`,
        countryOnlySignal: true,
      };
    }
    return { score: 25, reason: `Mentions only the broader area ("${matchedBroader}"), not "${specific}" specifically.` };
  }

  const knownOwnTokens = ownCountryHint ? [specific, ...broaderTokens, ownCountryHint.toLowerCase()] : [specific, ...broaderTokens];
  const wrongCountry = detectOtherCountryMention(lowerText, knownOwnTokens);
  if (wrongCountry) {
    return {
      score: 10,
      reason: `Explicitly mentions "${wrongCountry}", not "${regionName}" — likely a different region entirely.`,
      wrongCountrySignal: true,
    };
  }

  // The real generalization bug, found by tracing the actual math: at the
  // old default of 40, a paper that mentions NO place at all — anywhere on
  // Earth — could still clear REVIEW_SCORE_THRESHOLD (70) purely on strong
  // taxon/citability/species-record signal (40*0.3 + 85*0.3 + 100*0.15 +
  // 90*0.15 + 80*0.1 ≈ 74), regardless of which region was actually being
  // searched for. "We have no positive evidence this is about the target
  // region" was being scored as if it were itself weak positive evidence.
  // The principle going forward: only an actual textual match against the
  // target's real hierarchy (specific or broader, above) counts as
  // evidence of relevance — everything else, named-differently or simply
  // silent on location, defaults low. This is intentionally close to (not
  // identical to, so the reason string stays informative) the wrong-country
  // score just above, rather than a separate "neutral" tier.
  return { score: 15, reason: `No match for "${regionName}" found in the available text — no evidence this concerns the target region.` };
}
