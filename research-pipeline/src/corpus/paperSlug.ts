import { createHash } from "node:crypto";

function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Filesystem-safe, collision-resistant slug: DOI when present, else a hash of the normalized title. */
export function paperSlug(input: { doi?: string; title: string }): string {
  if (input.doi) {
    const cleanDoi = input.doi
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\/(dx\.)?doi\.org\//, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return `doi-${cleanDoi}`;
  }
  const hash = createHash("sha256").update(normalizeTitle(input.title)).digest("hex").slice(0, 16);
  return `title-${hash}`;
}

/** Filesystem-safe folder name for a "Region + Taxon" wiki page, preserving human readability. */
export function regionTaxonSlug(region: string, taxonGroup: string): string {
  return `${taxonGroup} of ${region}`.replace(/[\\/:*?"<>|]/g, "-").trim();
}
