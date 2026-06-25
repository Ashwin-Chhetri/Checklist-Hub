export interface CoordinateMatch {
  lat: number;
  lng: number;
  sourceSentence: string;
  /** True when the coordinate falls well outside the region's bounding box — likely OCR/extraction noise (digit swap, wrong hemisphere) rather than a real locality for this region. Flagged, never silently discarded. */
  outOfRangeSuspect: boolean;
}

// Decimal-degree pairs, e.g. "27.05 N, 88.26 E" or "12.345, 77.456".
const DECIMAL_PAIR_PATTERN =
  /(-?\d{1,2}\.\d{2,6})\s*°?\s*([NS])?[,;]?\s+(-?\d{1,3}\.\d{2,6})\s*°?\s*([EW])?/g;

// DMS pairs, e.g. `27°3'12"N, 88°15'40"E`.
const DMS_PAIR_PATTERN =
  /(\d{1,3})°\s*(\d{1,2})['′]\s*(\d{1,2}(?:\.\d+)?)?["″]?\s*([NS])[,;]?\s+(\d{1,3})°\s*(\d{1,2})['′]\s*(\d{1,2}(?:\.\d+)?)?["″]?\s*([EW])/g;

function dmsToDecimal(deg: number, min: number, sec: number, dir: string): number {
  const value = deg + min / 60 + sec / 3600;
  return dir === "S" || dir === "W" ? -value : value;
}

function sentenceAround(text: string, index: number): string {
  const start = text.lastIndexOf(".", index) + 1;
  const endCandidate = text.indexOf(".", index + 1);
  const end = endCandidate === -1 ? Math.min(text.length, index + 200) : endCandidate + 1;
  return text.slice(Math.max(0, start), end).trim();
}

function inBbox(lat: number, lng: number, bbox: [number, number, number, number], marginDeg = 1): boolean {
  const [west, south, east, north] = bbox;
  return lat >= south - marginDeg && lat <= north + marginDeg && lng >= west - marginDeg && lng <= east + marginDeg;
}

/**
 * Regex pre-pass over full text for explicit coordinate mentions (decimal
 * degree and DMS pairs), sanity-bounded against the region's bbox. This is
 * NOT the final extraction step (responsibility #7 is an LLM job per the
 * plan) — it locates candidate spans cheaply so the LLM correlation step
 * (correlateCoordinatesWithSpecies below) doesn't need to scan the entire
 * document itself for numeric patterns.
 */
export function extractCoordinateCandidates(
  text: string,
  regionBbox: [number, number, number, number] | null,
): CoordinateMatch[] {
  const matches: CoordinateMatch[] = [];
  const seen = new Set<string>();

  const pushMatch = (lat: number, lng: number, index: number) => {
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return;
    const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
    if (seen.has(key)) return;
    seen.add(key);
    matches.push({
      lat,
      lng,
      sourceSentence: sentenceAround(text, index),
      outOfRangeSuspect: regionBbox ? !inBbox(lat, lng, regionBbox) : false,
    });
  };

  for (const m of text.matchAll(DECIMAL_PAIR_PATTERN)) {
    let lat = Number(m[1]);
    let lng = Number(m[3]);
    if (m[2] === "S") lat = -Math.abs(lat);
    if (m[4] === "W") lng = -Math.abs(lng);
    pushMatch(lat, lng, m.index ?? 0);
  }

  for (const m of text.matchAll(DMS_PAIR_PATTERN)) {
    const lat = dmsToDecimal(Number(m[1]), Number(m[2]), Number(m[3] ?? 0), m[4] as string);
    const lng = dmsToDecimal(Number(m[5]), Number(m[6]), Number(m[7] ?? 0), m[8] as string);
    pushMatch(lat, lng, m.index ?? 0);
  }

  return matches;
}

/**
 * Correlates coordinate candidates with already-extracted species mentions
 * by sentence overlap — purely programmatic, no extra LLM call needed since
 * speciesExtraction.ts already captured each species' sourceSentence.
 * Coordinates whose sentence doesn't match any extracted species are kept
 * as region-level (unattributed) localities rather than dropped.
 */
export function correlateCoordinatesWithSpecies(
  coordinates: CoordinateMatch[],
  species: Array<{ scientificName: string; sourceSentence?: string }>,
): Array<CoordinateMatch & { species?: string }> {
  return coordinates.map((coord) => {
    const match = species.find(
      (s) => s.sourceSentence && coord.sourceSentence && s.sourceSentence.includes(coord.sourceSentence.slice(0, 40)),
    );
    return { ...coord, species: match?.scientificName };
  });
}
