import type { ExtractedSpeciesRecord } from "../types.js";

/**
 * Renders an already-parsed species list as a literal Markdown table —
 * built FROM the structured rows the extraction cascade already produced
 * (tabularSpeciesExtraction.ts / chunkedTableExtraction.ts's regex path /
 * proseSpeciesExtraction.ts), never by reverse-engineering markdown
 * structure out of the raw flat PDF text. This is the concrete "PDF
 * converted to markup" artifact for a paper: the species data itself, in
 * real Markdown, persisted alongside `extracted_text.md` as
 * `species_table.md` (see rawStore.ts's writeRawFile). Mirrors
 * wikiBuilder.ts's existing species table style, minus the cross-paper
 * "Sources" column (this is per-paper).
 */
export function renderSpeciesTableMarkdown(title: string, species: ExtractedSpeciesRecord[]): string {
  const header = [
    `# Extracted species — ${title}`,
    ``,
    `| Scientific name | Common name | Occurrence | Location | Date range |`,
    `|---|---|---|---|---|`,
  ];

  if (species.length === 0) {
    return [...header, `| _No species could be deterministically extracted from this paper's text._ | | | | |`].join("\n");
  }

  const rows = species.map((sp) => {
    const dateRange = sp.dateRange?.from || sp.dateRange?.to ? `${sp.dateRange.from ?? "?"}–${sp.dateRange.to ?? "?"}` : "";
    const commonName = sp.commonName ?? sp.backboneCommonName ?? "";
    return `| **${sp.scientificName}** | ${commonName} | ${sp.occurrence ?? ""} | ${sp.location ?? ""} | ${dateRange} |`;
  });

  return [...header, ...rows].join("\n");
}
