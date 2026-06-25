import type { LiteratureDocument, LiteratureResponse } from "@/app/api/evidence/literature/route";
import type { DiscoveryContext, EvidenceProvider, RawSpeciesRecord } from "../types";

/**
 * Literature evidence: species extracted from real regional checklist/survey
 * publications found via OpenAlex/Crossref/Semantic Scholar/BHL
 * (/api/evidence/literature). Search always runs (all four sources are
 * keyless or degrade gracefully); LLM ranking/extraction only contributes
 * species when ENABLE_LITERATURE_AGENT + NVIDIA_API_KEY are configured. When
 * extraction is disabled or yields nothing, this provider contributes no
 * species but still surfaces how many candidate documents were found via the
 * source summary message.
 */
export const literatureProvider: EvidenceProvider = {
  key: "literature",
  label: "Literature",
  occurrenceLabel: "observations",

  isEnabled(ctx: DiscoveryContext) {
    if (!ctx.deepestTaxonName || !ctx.region.region_name) {
      return { enabled: false, reason: "Select a taxonomic scope and region." };
    }
    return { enabled: true };
  },

  async discover(ctx: DiscoveryContext): Promise<RawSpeciesRecord[]> {
    const taxonGroup =
      ctx.deepestTaxonName ?? Object.values(ctx.taxonomicScope).filter(Boolean).pop() ?? "";

    const response = await fetch("/api/evidence/literature", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taxonGroup, regionName: ctx.region.region_name }),
    });
    if (!response.ok) {
      throw new Error(`Literature search failed: ${response.status}`);
    }

    const data = (await response.json()) as LiteratureResponse;

    if (data.species.length === 0) {
      // Surface the documents-found message even though no species were
      // contributed, so the aggregator can show it in the source summary
      // (reuses the same "disabled" status/message mechanism as a
      // not-configured provider, rendered as "unavailable" in SourceStat).
      const err = new Error(data.message ?? "No species extracted from literature.");
      (err as Error & { disabled?: boolean; priorChecklists?: LiteratureDocument[] }).disabled = true;
      (err as Error & { disabled?: boolean; priorChecklists?: LiteratureDocument[] }).priorChecklists =
        data.priorChecklists;
      throw err;
    }

    const records = data.species.map((s) => ({
      source: "literature",
      scientificName: s.scientificName,
      commonName: s.commonName,
      // The publication year is the best available proxy for when the
      // species was recorded — literature has no occurrence-level event date.
      latestObservationDate: s.sourceDocument.year ? `${s.sourceDocument.year}-01-01` : undefined,
      metadata: {
        reference: s.sourceDocument.title,
        doi: s.sourceDocument.doi,
        url: s.sourceDocument.url,
      },
    } satisfies RawSpeciesRecord));

    return Object.assign(records, { priorChecklists: data.priorChecklists });
  },
};
