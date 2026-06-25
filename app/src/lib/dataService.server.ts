/**
 * Thin client for the standalone reference-data service (GBIF backbone +
 * GADM SQLite mirrors), which runs on a DigitalOcean droplet since Vercel's
 * serverless filesystem can't hold the ~2.8GB of data. See
 * reference-data-service/ at the repo root for the server side.
 */
const BASE_URL = process.env.DATA_SERVICE_URL;
const SECRET = process.env.DATA_SERVICE_SECRET;

export async function callDataService<T>(path: string, init?: RequestInit): Promise<T> {
  if (!BASE_URL || !SECRET) {
    throw new Error("DATA_SERVICE_URL / DATA_SERVICE_SECRET are not configured");
  }
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      "x-internal-secret": SECRET,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`data service ${path} returned ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}
