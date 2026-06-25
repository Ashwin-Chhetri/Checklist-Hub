import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { paths } from "../config.js";

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function cacheKeyFor(query: string): string {
  return createHash("sha256").update(query).digest("hex").slice(0, 24);
}

function cachePath(query: string): string {
  return path.join(paths.raw, "query-cache", `${cacheKeyFor(query)}.json`);
}

interface CacheEntry<T> {
  query: string;
  cachedAt: string;
  data: T;
}

/**
 * File-backed cache for raw discovery-source query results, keyed by the
 * exact query string. Added specifically because Google Custom Search's
 * free tier is a hard 100-queries/day cap with no recovery until the daily
 * reset — unlike Scholar's softer/temporary block, repeated manual test
 * runs for the same region+taxon during development would otherwise burn
 * through the quota fast. Reusable by any source (Scholar/Crossref/
 * OpenAlex too), not just Google CSE.
 */
export async function getCachedQuery<T>(query: string, ttlMs = DEFAULT_TTL_MS): Promise<T | null> {
  try {
    const raw = await fs.readFile(cachePath(query), "utf8");
    const entry = JSON.parse(raw) as CacheEntry<T>;
    if (Date.now() - new Date(entry.cachedAt).getTime() > ttlMs) return null;
    return entry.data;
  } catch {
    return null;
  }
}

export async function setCachedQuery<T>(query: string, data: T): Promise<void> {
  const filePath = cachePath(query);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const entry: CacheEntry<T> = { query, cachedAt: new Date().toISOString(), data };
  await fs.writeFile(filePath, JSON.stringify(entry, null, 2));
}

/** Check-then-store wrapper — the shape every caller actually wants. */
export async function withQueryCache<T>(query: string, fn: () => Promise<T>, ttlMs = DEFAULT_TTL_MS): Promise<T> {
  const cached = await getCachedQuery<T>(query, ttlMs);
  if (cached !== null) return cached;
  const result = await fn();
  await setCachedQuery(query, result);
  return result;
}
