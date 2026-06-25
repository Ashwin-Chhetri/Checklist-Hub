export interface IptInstallation {
  organizationKey: string;
  organizationName: string;
  organizationCountry: string;
  organizationCity: string | null;
  installationKey: string;
  installationTitle: string;
  iptUrl: string | null;
  requestAccessUrl: string;
  organizationWebsite: string | null;
  numPublishedDatasets: number;
}

/** IPT installations registered with GBIF for organizations in the given country — public data, fetched live via the app server. */
export async function fetchNearbyIpts(countryCode: string): Promise<IptInstallation[]> {
  const res = await fetch(`/api/ipt/installations?country=${encodeURIComponent(countryCode)}`);
  if (!res.ok) throw new Error("Failed to load nearby IPT directory.");
  const json = await res.json();
  return (json.installations ?? []) as IptInstallation[];
}

/** Free-text search across all GBIF-registered IPT installations by organization name, regardless of country. */
export async function searchIpts(query: string): Promise<IptInstallation[]> {
  const res = await fetch(`/api/ipt/installations?q=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error("Failed to search the IPT directory.");
  const json = await res.json();
  return (json.installations ?? []) as IptInstallation[];
}

export interface ResolvedGbifDataset {
  datasetUuid: string;
  title: string;
  doi: string | null;
  citation: string | null;
  publicationYear: number | null;
  publisherName: string | null;
}

/** Resolves a pasted GBIF/IPT dataset URL to its official Registry record (UUID, DOI, citation, year, publisher). Throws with a user-facing message if no confident match is found. */
export async function resolveGbifDatasetUrl(url: string): Promise<ResolvedGbifDataset> {
  const res = await fetch("/api/ipt/resolve-dataset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Failed to resolve dataset URL.");
  return json as ResolvedGbifDataset;
}
