import * as turf from "@turf/turf";
import type { Geometry } from "geojson";
import { resolveRegionBoundary, type RegionBoundary } from "../regions/resolveRegionBoundary.js";
import { extractLocalityCandidates } from "./localityExtraction.js";
import { extractMostSpecificToken } from "./regionSpecificity.js";

export type RegionContainmentVerdict = "within" | "broader" | "unrelated" | "unverified";

export interface RegionContainmentResult {
  verdict: RegionContainmentVerdict;
  matchedLocality?: string;
  reason: string;
}

/** A candidate locality's own area is treated as "broader than the target" once it exceeds this multiple of the target's area — not exactly 1.0 since simplified/Nominatim polygons rarely match area exactly even for the same real-world place. */
const AREA_TOLERANCE = 1.3;

/**
 * Candidate locality names to test for containment: any place-name-shaped
 * phrase the cheap regex pre-pass (localityExtraction.ts) finds in the
 * paper's text, plus the target region's own most-specific name — but only
 * when the text actually mentions it (the common case of a "Birds of
 * Darjeeling district" paper, where resolving it again trivially yields the
 * same boundary -> "within"). Unconditionally adding the target's own name
 * regardless of whether the text mentions it would make every paper
 * resolve to "within" no matter its actual content — the one check this
 * function exists to avoid.
 */
function collectCandidateLocalityNames(text: string, targetRegionName: string): string[] {
  const names = new Set<string>();
  const specific = extractMostSpecificToken(targetRegionName);
  if (specific.length >= 3 && text.toLowerCase().includes(specific.toLowerCase())) {
    names.add(specific);
  }
  for (const candidate of extractLocalityCandidates(text).slice(0, 8)) {
    names.add(candidate.name);
  }
  return [...names];
}

function safeContains(container: Geometry, contained: Geometry): boolean {
  try {
    return turf.booleanContains(container, contained);
  } catch {
    return false;
  }
}

function safeIntersects(a: Geometry, b: Geometry): boolean {
  try {
    return turf.booleanIntersects(a, b);
  } catch {
    return false;
  }
}

/**
 * GIS-grounded double-check (on top of the textual substring match in
 * regionSpecificity.ts): does this paper's actual study area sit within the
 * target region's real boundary, as opposed to merely mentioning its name —
 * and is the study area itself not bigger than the target (e.g. a
 * state-wide paper for a district-level search)? Only runs when full text
 * is available; the target boundary is resolved once per pipeline run and
 * passed in rather than re-resolved per paper.
 */
export async function checkRegionContainment(input: {
  text: string;
  targetRegionName: string;
  targetBoundary: RegionBoundary;
}): Promise<RegionContainmentResult> {
  if (!input.targetBoundary.geometry) {
    return { verdict: "unverified", reason: "Target region boundary has no resolvable geometry — containment can't be checked." };
  }
  if (!input.text.trim()) {
    return { verdict: "unverified", reason: "No full text available to check containment against." };
  }

  const targetGeom = input.targetBoundary.geometry as Geometry;
  const targetArea = turf.area(targetGeom);

  const candidateNames = collectCandidateLocalityNames(input.text, input.targetRegionName);
  if (candidateNames.length === 0) {
    return { verdict: "unverified", reason: "No locality names detected in the text to check containment for." };
  }

  let sawDisjoint = false;
  let sawBroader: string | undefined;

  for (const name of candidateNames) {
    const boundary: RegionBoundary = await resolveRegionBoundary(name);
    if (!boundary.geometry) continue;
    const candidateGeom = boundary.geometry as Geometry;

    if (safeContains(targetGeom, candidateGeom)) {
      return { verdict: "within", matchedLocality: name, reason: `"${name}" resolves to a locality contained within "${input.targetRegionName}".` };
    }

    // A candidate that actually contains the target (its parent state/
    // country) is unambiguously "broader" regardless of area ratio.
    if (safeContains(candidateGeom, targetGeom)) {
      sawBroader = name;
      continue;
    }

    // Only check overlap/size for candidates that actually relate to the
    // target at all — a same-size-or-larger region that's simply disjoint
    // (e.g. "Kerala" for a Darjeeling search) is "unrelated", not "broader":
    // size alone doesn't make an unconnected place relevant.
    if (safeIntersects(targetGeom, candidateGeom)) {
      const candidateArea = turf.area(candidateGeom);
      if (candidateArea > targetArea * AREA_TOLERANCE) {
        sawBroader = name;
        continue;
      }
      return { verdict: "within", matchedLocality: name, reason: `"${name}" overlaps "${input.targetRegionName}" without being a disproportionately larger area.` };
    }

    sawDisjoint = true;
  }

  if (sawBroader) {
    return { verdict: "broader", matchedLocality: sawBroader, reason: `"${sawBroader}" is the same size as or larger than "${input.targetRegionName}" rather than contained within it.` };
  }
  if (sawDisjoint) {
    return { verdict: "unrelated", reason: "Resolved locality names in the text don't overlap the target region at all." };
  }
  return { verdict: "unverified", reason: "None of the detected locality names could be geocoded." };
}
