import { Cite } from "@citation-js/core";
import "@citation-js/plugin-csl";
import type { PaperMetadata } from "../types.js";

interface CslName {
  family: string;
  given?: string;
}

function toCslName(chunk: string): CslName {
  if (chunk.includes(",")) {
    const [family, given] = chunk.split(",").map((s) => s.trim());
    return { family, given: given || undefined };
  }
  const parts = chunk.trim().split(/\s+/);
  const family = parts.pop()!;
  return { family, given: parts.join(" ") || undefined };
}

/**
 * Free-text author strings vary by discovery source (Scholar's "J Smith, A
 * Doe", OpenAlex's "Smith, J.; Doe, A.", a single "Smith, J., Doe, A."
 * comma-joined list with no "and"/";" between authors, manual entry, etc.)
 * — this is a best-effort split, not a bibliographic-grade name parser.
 * Good enough for CSL rendering (citeproc only needs family/given to produce
 * "Smith, J.").
 */
function parseAuthors(authorsLine: string): CslName[] {
  const groups = authorsLine
    .split(/\s*(?:;|\s+and\s+|&)\s*/i)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  return groups.flatMap((group) => {
    const segments = group.split(",").map((s) => s.trim()).filter(Boolean);
    // "Smith, J., Doe, A." style: no "and"/";" between authors, so the whole
    // multi-author list arrives as one comma-joined group — an even segment
    // count pairs up cleanly as alternating Family, Given.
    if (segments.length > 2 && segments.length % 2 === 0) {
      const names: CslName[] = [];
      for (let i = 0; i < segments.length; i += 2) {
        names.push({ family: segments[i], given: segments[i + 1] || undefined });
      }
      return names;
    }
    return [toCslName(group)];
  });
}

function toCslJson(metadata: Pick<PaperMetadata, "title" | "authors" | "year" | "venue" | "doi" | "url">) {
  return {
    type: "article-journal",
    title: metadata.title,
    author: metadata.authors ? parseAuthors(metadata.authors) : undefined,
    issued: metadata.year ? { "date-parts": [[metadata.year]] } : undefined,
    "container-title": metadata.venue,
    DOI: metadata.doi,
    URL: !metadata.doi ? metadata.url : undefined,
  };
}

/** Ad-hoc fallback for the rare case citeproc throws (e.g. on malformed input) — keeps wiki/catalog generation from failing outright over a formatting concern. */
function fallbackCitation(metadata: Pick<PaperMetadata, "title" | "authors" | "year" | "venue" | "doi" | "url">): string {
  const year = metadata.year ? ` (${metadata.year})` : "";
  const authors = metadata.authors ? `${metadata.authors} ` : "";
  const link = metadata.doi ? ` https://doi.org/${metadata.doi}` : metadata.url ? ` ${metadata.url}` : "";
  return `${authors}${metadata.title}${year}.${link}`.trim();
}

/** Renders a literature reference as an APA-style citation via citeproc (`@citation-js`/`@citation-js/plugin-csl`). */
export function formatApaCitation(
  metadata: Pick<PaperMetadata, "title" | "authors" | "year" | "venue" | "doi" | "url">,
): string {
  try {
    const cite = new Cite(toCslJson(metadata));
    const bibliography = cite.format("bibliography", { format: "text", template: "apa", lang: "en-US" });
    return bibliography.trim() || fallbackCitation(metadata);
  } catch {
    return fallbackCitation(metadata);
  }
}
