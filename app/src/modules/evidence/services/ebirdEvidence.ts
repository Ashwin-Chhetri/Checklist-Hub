const EBIRD_API = "https://api.ebird.org/v2";

/** Thrown when eBird rejects the configured API key (401/403). */
export class EbirdAuthError extends Error {
  constructor(status: number) {
    super(
      `eBird API key is invalid or expired (HTTP ${status}). Generate a new key at ` +
        `https://ebird.org/api/keygen and set NEXT_PUBLIC_EBIRD_API_KEY in .env.local.`,
    );
    this.name = "EbirdAuthError";
  }
}

/** fetch() wrapper that throws EbirdAuthError on 401/403 responses. */
async function ebirdFetch(url: string, apiKey: string): Promise<Response> {
  const response = await fetch(url, { headers: { "X-eBirdApiToken": apiKey } });
  if (response.status === 401 || response.status === 403) {
    throw new EbirdAuthError(response.status);
  }
  return response;
}

export interface EbirdObservation {
  speciesCode: string;
  comName: string;
  sciName: string;
  obsDt: string;
  howMany?: number;
  locName?: string;
  /** Present on the recent-observations feed (not the taxonomy endpoint) — used for the region map. */
  lat?: number;
  lng?: number;
  /** The eBird checklist this observation came from — links to https://ebird.org/checklist/{subId}. */
  subId?: string;
}

export interface EbirdSummary {
  recordCount: number;
  latestObservationDate: string | null;
}

/**
 * Recent observations for a species within an eBird region (e.g. a GADM-derived
 * subnational code like "IN-WB-DA"). Requires EBIRD_API_KEY — if unset, returns
 * an empty summary so callers can degrade gracefully rather than failing the
 * whole evidence fetch.
 */
export async function getEbirdObservations(
  speciesCode: string,
  regionCode: string,
): Promise<EbirdSummary> {
  const apiKey = process.env.NEXT_PUBLIC_EBIRD_API_KEY;
  if (!apiKey) {
    return { recordCount: 0, latestObservationDate: null };
  }

  const url = new URL(`${EBIRD_API}/data/obs/${regionCode}/recent/${speciesCode}`);
  url.searchParams.set("back", "30");

  const response = await ebirdFetch(url.toString(), apiKey);
  if (!response.ok) {
    if (response.status === 404) return { recordCount: 0, latestObservationDate: null };
    throw new Error(`eBird recent observations failed: ${response.status}`);
  }

  const observations = (await response.json()) as EbirdObservation[];
  const dates = observations.map((o) => o.obsDt).sort();
  return {
    recordCount: observations.length,
    latestObservationDate: dates[dates.length - 1] ?? null,
  };
}

export interface EbirdSpeciesListItem {
  speciesCode: string;
  comName?: string;
  sciName?: string;
}

interface EbirdTaxonomyEntry {
  speciesCode: string;
  comName: string;
  sciName: string;
}

/** Returns true if NEXT_PUBLIC_EBIRD_API_KEY is configured. */
export function isEbirdConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_EBIRD_API_KEY);
}

let taxonomyCache: Promise<EbirdTaxonomyEntry[]> | null = null;

function getEbirdTaxonomy(apiKey: string): Promise<EbirdTaxonomyEntry[]> {
  if (!taxonomyCache) {
    taxonomyCache = (async () => {
      const url = new URL(`${EBIRD_API}/ref/taxonomy/ebird`);
      url.searchParams.set("fmt", "json");
      const response = await ebirdFetch(url.toString(), apiKey);
      if (!response.ok) throw new Error(`eBird taxonomy fetch failed: ${response.status}`);
      return (await response.json()) as EbirdTaxonomyEntry[];
    })();
  }
  return taxonomyCache;
}

/**
 * Resolves a scientific name to its eBird speciesCode via the full eBird
 * taxonomy (cached per session, see getEbirdTaxonomy) — needed to query the
 * per-species recent-observations endpoint for occurrence coordinates.
 * Returns null if NEXT_PUBLIC_EBIRD_API_KEY is unset or there's no match
 * (e.g. the species isn't a bird).
 */
export async function resolveEbirdSpeciesCode(scientificName: string): Promise<string | null> {
  const apiKey = process.env.NEXT_PUBLIC_EBIRD_API_KEY;
  if (!apiKey) return null;
  const taxonomy = await getEbirdTaxonomy(apiKey);
  const lower = scientificName.toLowerCase();
  const match = taxonomy.find((t) => t.sciName.toLowerCase() === lower);
  return match?.speciesCode ?? null;
}

export interface EbirdOccurrencePoint {
  subId: string;
  lat: number;
  lng: number;
  obsDt: string;
}

/**
 * Individual recent-observation coordinates for a species within an eBird
 * region — used by the workbench Evidence panel's region map. eBird's public
 * API only exposes a 30-day recent-observations window (no historical
 * coordinate search), same limitation as getEbirdRegionSpeciesList — this is
 * a recent-activity snapshot, not exhaustive occurrence history.
 */
export async function getEbirdObservationPoints(
  speciesCode: string,
  regionCode: string,
): Promise<EbirdOccurrencePoint[]> {
  const apiKey = process.env.NEXT_PUBLIC_EBIRD_API_KEY;
  if (!apiKey) return [];

  const url = new URL(`${EBIRD_API}/data/obs/${regionCode}/recent/${speciesCode}`);
  url.searchParams.set("back", "30");

  const response = await ebirdFetch(url.toString(), apiKey);
  if (!response.ok) {
    if (response.status === 404) return [];
    throw new Error(`eBird recent observations failed: ${response.status}`);
  }

  const observations = (await response.json()) as EbirdObservation[];
  return observations
    .filter((o) => Number.isFinite(o.lat) && Number.isFinite(o.lng) && o.subId)
    .map((o) => ({ subId: o.subId as string, lat: o.lat as number, lng: o.lng as number, obsDt: o.obsDt }));
}

/**
 * Species list for an eBird region code (e.g. "IN-WB-DA"), with names
 * cross-referenced against the full eBird taxonomy. Returns [] if
 * NEXT_PUBLIC_EBIRD_API_KEY is unset.
 */
export async function getEbirdSpeciesList(regionCode: string): Promise<EbirdSpeciesListItem[]> {
  const apiKey = process.env.NEXT_PUBLIC_EBIRD_API_KEY;
  if (!apiKey) return [];

  const url = new URL(`${EBIRD_API}/product/spplist/${regionCode}`);
  const response = await ebirdFetch(url.toString(), apiKey);
  if (!response.ok) {
    if (response.status === 404) return [];
    throw new Error(`eBird species list failed: ${response.status}`);
  }
  const speciesCodes = (await response.json()) as string[];

  const taxonomy = await getEbirdTaxonomy(apiKey);
  const taxonomyByCode = new Map(taxonomy.map((entry) => [entry.speciesCode, entry]));

  return speciesCodes.map((code) => {
    const entry = taxonomyByCode.get(code);
    return { speciesCode: code, comName: entry?.comName, sciName: entry?.sciName };
  });
}

export interface EbirdRegionSpeciesItem {
  scientificName: string;
  commonName?: string;
  /** Number of distinct observation records for this species within the queried window. */
  occurrenceCount: number;
  eventDate?: string;
}

/**
 * Per-species observation-record counts for an entire eBird region (e.g.
 * "IN-WB-DA"), counting every checklist entry — not just the most recent —
 * within the queried window. eBird's public API only exposes a recent-window
 * feed (max `back=30` days); a true all-time total would require the eBird
 * Basic Dataset (EBD), which isn't accessible via this API. `occurrenceCount`
 * is therefore the count of observation records in the last `back` days,
 * which is the closest "how many times was this species recorded" figure
 * obtainable here. Returns [] if NEXT_PUBLIC_EBIRD_API_KEY is unset or the
 * region code is unknown to eBird.
 */
export async function getEbirdRegionSpeciesList(regionCode: string, back = 30): Promise<EbirdRegionSpeciesItem[]> {
  const apiKey = process.env.NEXT_PUBLIC_EBIRD_API_KEY;
  if (!apiKey) return [];

  const url = new URL(`${EBIRD_API}/data/obs/${regionCode}/recent`);
  url.searchParams.set("back", String(Math.min(back, 30)));
  url.searchParams.set("includeProvisional", "true");
  url.searchParams.set("maxResults", "10000");

  const response = await ebirdFetch(url.toString(), apiKey);
  if (!response.ok) {
    if (response.status === 404) return [];
    throw new Error(`eBird recent region observations failed: ${response.status}`);
  }

  const observations = (await response.json()) as EbirdObservation[];

  const bySpecies = new Map<string, EbirdRegionSpeciesItem>();
  for (const o of observations) {
    const existing = bySpecies.get(o.sciName);
    if (existing) {
      existing.occurrenceCount += 1;
      if (!existing.eventDate || o.obsDt > existing.eventDate) existing.eventDate = o.obsDt;
    } else {
      bySpecies.set(o.sciName, {
        scientificName: o.sciName,
        commonName: o.comName,
        occurrenceCount: 1,
        eventDate: o.obsDt,
      });
    }
  }
  return [...bySpecies.values()];
}

const COUNTRY_ISO_CODES: Record<string, string> = {
  india: "IN",
  "united states": "US",
  "united states of america": "US",
  "united kingdom": "GB",
  canada: "CA",
  australia: "AU",
};

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Best-effort resolution of a region (country/state/district names) to an
 * eBird subnational2 region code. Falls back to the subnational1 (state)
 * code if the district can't be matched, or null if even the country/state
 * can't be resolved.
 */
export async function resolveEbirdRegionCode(region: {
  region_country: string;
  region_state: string;
  region_district: string;
}): Promise<string | null> {
  const apiKey = process.env.NEXT_PUBLIC_EBIRD_API_KEY;
  if (!apiKey) return null;

  const countryCode = COUNTRY_ISO_CODES[normalizeName(region.region_country)];
  if (!countryCode) return null;

  const subnational1Response = await ebirdFetch(`${EBIRD_API}/ref/region/list/subnational1/${countryCode}`, apiKey);
  if (!subnational1Response.ok) return null;
  const subnational1List = (await subnational1Response.json()) as Array<{ code: string; name: string }>;
  const state = subnational1List.find((s) => normalizeName(s.name) === normalizeName(region.region_state));
  if (!state) return null;

  const subnational2Response = await ebirdFetch(`${EBIRD_API}/ref/region/list/subnational2/${state.code}`, apiKey);
  if (!subnational2Response.ok) return state.code;
  const subnational2List = (await subnational2Response.json()) as Array<{ code: string; name: string }>;
  const district = subnational2List.find((d) => normalizeName(d.name) === normalizeName(region.region_district));

  return district?.code ?? state.code;
}
