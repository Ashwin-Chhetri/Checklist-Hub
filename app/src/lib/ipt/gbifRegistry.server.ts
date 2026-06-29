// Server-only: looks up live IPT installations registered with GBIF for
// organizations in a given country, via GBIF's public Registry API
// (api.gbif.org — read-only, no auth/credentials, no rate-limit key needed).
// IPT itself has no public write API (confirmed against the gbif/ipt source:
// its /manager-api namespace is read-only listing/suggestion endpoints), so
// this is the extent of what ChecklistHub can automate — pointing the user
// at the right already-registered IPT instead of asking them to search.
const GBIF_API = "https://api.gbif.org/v1";
const MAX_ORGANIZATIONS = 60;
const FETCH_CONCURRENCY = 8;
const FETCH_TIMEOUT_MS = 8000;

export interface IptInstallationResult {
  organizationKey: string;
  organizationName: string;
  organizationCountry: string;
  organizationCity: string | null;
  installationKey: string;
  installationTitle: string;
  iptUrl: string | null;
  /** GBIF's own publisher profile page — always exists for a registered org, unlike `iptUrl` which is derived from an installation endpoint and can be missing/stale. The reliable "ask for access" destination. */
  requestAccessUrl: string;
  /** The org's own homepage, as registered with GBIF — a second, independent reliable link (distinct from requestAccessUrl/GBIF and from the derived, sometimes-stale iptUrl). */
  organizationWebsite: string | null;
  numPublishedDatasets: number;
}

interface GbifOrganization {
  key: string;
  title: string;
  country: string;
  city?: string;
  homepage?: string[];
  numPublishedDatasets?: number;
}

// GBIF has no API to ask "which organizations serve country X" beyond the
// literal `country` field — so a transboundary/regional publisher like
// ICIMOD (registered with country "ZZ", GBIF's code for organizations not
// tied to one country) never surfaces from a country-filtered query, even
// though it's the right publisher for someone in any of the 8 countries it
// actually serves. This is a small hand-verified overlay (org key checked
// against api.gbif.org) to fill that gap for known regional bodies — not a
// general solution, just the cases we know about.
const REGIONAL_PARTNER_ORG_KEYS: Record<string, string[]> = {
  // ICIMOD — International Centre for Integrated Mountain Development,
  // serves the Hindu Kush-Himalaya region (its own self-described coverage).
  AF: ["d33a9c4e-e33c-4311-a2fe-88dbdff7b4b9"],
  BD: ["d33a9c4e-e33c-4311-a2fe-88dbdff7b4b9"],
  BT: ["d33a9c4e-e33c-4311-a2fe-88dbdff7b4b9"],
  CN: ["d33a9c4e-e33c-4311-a2fe-88dbdff7b4b9"],
  IN: ["d33a9c4e-e33c-4311-a2fe-88dbdff7b4b9"],
  MM: ["d33a9c4e-e33c-4311-a2fe-88dbdff7b4b9"],
  NP: ["d33a9c4e-e33c-4311-a2fe-88dbdff7b4b9"],
  PK: ["d33a9c4e-e33c-4311-a2fe-88dbdff7b4b9"],
};

interface GbifInstallation {
  key: string;
  type: string;
  title: string;
  disabled?: boolean;
  endpoints?: { type: string; url: string }[];
}

async function fetchJson<T>(url: string): Promise<T | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function deriveIptUrl(installation: GbifInstallation): string | null {
  const feed = installation.endpoints?.find((e) => e.type === "FEED" && typeof e.url === "string");
  if (!feed) return null;
  return feed.url.replace(/rss\.do.*$/, "");
}

async function fetchOrganizationIpts(org: GbifOrganization): Promise<IptInstallationResult[]> {
  const json = await fetchJson<{ results: GbifInstallation[] }>(`${GBIF_API}/organization/${org.key}/installation`);
  return (json?.results ?? [])
    .filter((inst) => inst.type === "IPT_INSTALLATION" && !inst.disabled)
    .map((inst) => ({
      organizationKey: org.key,
      organizationName: org.title,
      organizationCountry: org.country,
      organizationCity: org.city ?? null,
      installationKey: inst.key,
      installationTitle: inst.title,
      iptUrl: deriveIptUrl(inst),
      requestAccessUrl: `https://www.gbif.org/publisher/${org.key}`,
      organizationWebsite: org.homepage?.[0] ?? null,
      numPublishedDatasets: org.numPublishedDatasets ?? 0,
    }));
}

/**
 * IPT installations already registered with GBIF, filtered by country
 * and/or a free-text organization name search (GBIF's `/organization`
 * list endpoint supports both `country` and `q` and can combine them).
 * At least one of the two should be set or this returns nothing.
 */
export async function fetchIptInstallations(params: { country?: string; query?: string }): Promise<IptInstallationResult[]> {
  if (!params.country && !params.query) return [];

  const search = new URLSearchParams();
  if (params.country) search.set("country", params.country);
  if (params.query) search.set("q", params.query);
  search.set("limit", String(MAX_ORGANIZATIONS));

  const orgJson = await fetchJson<{ results: GbifOrganization[] }>(`${GBIF_API}/organization?${search.toString()}`);
  const organizations = orgJson?.results ?? [];

  const regionalKeys = params.country ? (REGIONAL_PARTNER_ORG_KEYS[params.country] ?? []) : [];
  const knownKeys = new Set(organizations.map((o) => o.key));
  for (const key of regionalKeys) {
    if (knownKeys.has(key)) continue;
    const org = await fetchJson<GbifOrganization>(`${GBIF_API}/organization/${key}`);
    if (org) {
      organizations.push(org);
      knownKeys.add(key);
    }
  }

  const results: IptInstallationResult[] = [];
  for (let i = 0; i < organizations.length; i += FETCH_CONCURRENCY) {
    const batch = organizations.slice(i, i + FETCH_CONCURRENCY);
    const batchResults = await Promise.all(batch.map(fetchOrganizationIpts));
    for (const orgResults of batchResults) results.push(...orgResults);
  }

  return results.sort((a, b) => b.numPublishedDatasets - a.numPublishedDatasets);
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export interface ResolvedGbifDataset {
  datasetUuid: string;
  title: string;
  doi: string | null;
  citation: string | null;
  publicationYear: number | null;
  publisherName: string | null;
}

interface GbifDataset {
  key: string;
  title: string;
  doi?: string;
  citation?: { text: string };
  pubDate?: string;
  publishingOrganizationKey?: string;
  endpoints?: { type: string; url: string }[];
}

async function fetchDatasetDetails(key: string): Promise<ResolvedGbifDataset | null> {
  const dataset = await fetchJson<GbifDataset>(`${GBIF_API}/dataset/${key}`);
  if (!dataset) return null;

  let publisherName: string | null = null;
  if (dataset.publishingOrganizationKey) {
    const org = await fetchJson<{ title: string }>(`${GBIF_API}/organization/${dataset.publishingOrganizationKey}`);
    publisherName = org?.title ?? null;
  }

  return {
    datasetUuid: dataset.key,
    title: dataset.title,
    doi: dataset.doi ?? null,
    citation: dataset.citation?.text ?? null,
    publicationYear: dataset.pubDate ? new Date(dataset.pubDate).getFullYear() : null,
    publisherName,
  };
}

/**
 * Resolves a pasted GBIF dataset link or IPT resource/eml/archive URL to its
 * Registry record. A gbif.org/dataset/<uuid> link resolves directly. An IPT
 * URL (resource?r=, eml.do?r=, archive.do?r=) has no direct reverse lookup —
 * IPT exposes no such API — so this searches the dataset registry by the
 * resource shortname and only accepts a candidate whose own registered
 * endpoint URL matches the same host *and* shortname as what was pasted.
 * Returns null rather than guessing when no endpoint matches exactly.
 */
export async function resolveGbifDataset(pastedUrl: string): Promise<ResolvedGbifDataset | null> {
  const directMatch = pastedUrl.match(UUID_RE);
  if (directMatch) {
    return fetchDatasetDetails(directMatch[0]);
  }

  let parsed: URL;
  try {
    parsed = new URL(pastedUrl);
  } catch {
    return null;
  }

  const shortname = parsed.searchParams.get("r");
  if (!shortname) return null;
  const host = parsed.hostname;

  const searchJson = await fetchJson<{ results: { key: string }[] }>(
    `${GBIF_API}/dataset/search?q=${encodeURIComponent(shortname)}&limit=10`,
  );
  const candidates = searchJson?.results ?? [];

  for (let i = 0; i < candidates.length; i += FETCH_CONCURRENCY) {
    const batch = candidates.slice(i, i + FETCH_CONCURRENCY);
    const datasets = await Promise.all(batch.map((c) => fetchJson<GbifDataset>(`${GBIF_API}/dataset/${c.key}`)));
    for (const dataset of datasets) {
      if (!dataset) continue;
      const matches = (dataset.endpoints ?? []).some((e) => {
        try {
          const epUrl = new URL(e.url);
          return epUrl.hostname === host && epUrl.searchParams.get("r") === shortname;
        } catch {
          return false;
        }
      });
      if (matches) return fetchDatasetDetails(dataset.key);
    }
  }

  return null;
}
