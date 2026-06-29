import fs from "node:fs/promises";
import path from "node:path";
import { PDFParse } from "pdf-parse";
import { paperSlug } from "../corpus/paperSlug.js";
import { buildPaperMetadata } from "../corpus/buildPaperMetadata.js";
import { writeRawFile, writeRawJson, readExtractedText, paperDir } from "../corpus/rawStore.js";
import { updateCatalogEntry, readCatalogEntry } from "../corpus/catalogBuilder.js";
import { queryCatalog } from "../corpus/queryCatalog.js";
import { buildWiki } from "../corpus/wikiBuilder.js";
import { buildOutputs } from "../corpus/outputsBuilder.js";
import { resolveFullText, downloadPdf } from "../fulltext/resolveFullText.js";
import { extractPdfText } from "../fulltext/pdfExtract.js";
import { getWorkByDoi } from "../sources/openAlex.js";
import { resolveRegionBoundary } from "../regions/resolveRegionBoundary.js";
import { analyzePaper } from "../analysis/analyzePaper.js";
import { paths } from "../config.js";
import type { CatalogEntry, FullTextStatus, FullTextStatusRecord, PaperCandidate } from "../types.js";

export interface ManualContributionInput {
  region: string;
  taxonGroup: string;
  /** A pasted URL — DOI link, journal landing page, or a direct PDF link. */
  url?: string;
  /** Path to an already-uploaded PDF file on disk (the API route saves the upload here first). */
  localPdfPath?: string;
}

const DOI_PATTERN = /10\.\d{4,9}\/\S+/;

function extractDoi(url: string): string | undefined {
  const match = url.match(DOI_PATTERN);
  return match ? match[0].replace(/[.,;)\]]+$/, "") : undefined;
}

/**
 * Ingests a user-supplied PDF or link as a paper candidate tagged
 * `discoveredVia: "manual"`, running it through the same enrichment/
 * full-text/LLM-analysis/catalog pipeline as discovered papers — so it
 * shows up in the same Documents/Species tables, with the same grading,
 * rather than being a second-class, differently-shaped record. Stays
 * inside research-pipeline's own corpus (no Supabase writes) per the user's
 * explicit choice: this is not yet checklist evidence.
 */
export async function ingestManualContribution(input: ManualContributionInput): Promise<CatalogEntry> {
  let pdfBuffer: Buffer | null = null;
  let doi: string | undefined;
  let sourceUrl = input.url;

  if (input.localPdfPath) {
    pdfBuffer = await fs.readFile(input.localPdfPath);
  } else if (input.url) {
    doi = extractDoi(input.url);
    const downloaded = await downloadPdf(input.url);
    if (downloaded) pdfBuffer = downloaded.buffer;
  }

  let title = sourceUrl ?? "Untitled manual contribution";
  if (pdfBuffer) {
    try {
      const parser = new PDFParse({ data: pdfBuffer });
      const info = await parser.getInfo();
      await parser.destroy();
      const pdfTitle = (info as { info?: { Title?: string } }).info?.Title;
      if (pdfTitle?.trim()) title = pdfTitle.trim();
    } catch {
      // Keep the URL/placeholder title — a missing PDF metadata title isn't fatal.
    }
  } else if (doi) {
    // No PDF to read a title from (e.g. a DOI link to a paywalled landing
    // page) — try OpenAlex for the real title rather than leaving the raw
    // URL as the "title" forever.
    const enrichment = await getWorkByDoi(doi);
    if (enrichment?.title?.trim()) title = enrichment.title.trim();
  }

  const slug = paperSlug({ doi, title });
  const candidate: PaperCandidate = { slug, title, doi, discoveredVia: "manual", url: sourceUrl };
  const metadata = await buildPaperMetadata(candidate);

  let fullTextStatus: FullTextStatus;
  if (pdfBuffer) {
    await writeRawFile(slug, "paper.pdf", pdfBuffer);
    const extracted = await extractPdfText(pdfBuffer);
    await writeRawFile(slug, "extracted_text.md", extracted.text);
    fullTextStatus = extracted.looksEmpty ? "extracted_empty" : extracted.looksGarbled ? "extracted_garbled" : "extracted";
    const record: FullTextStatusRecord = {
      status: fullTextStatus,
      resolvedVia: input.localPdfPath ? "manual_upload" : "manual_url",
      textLength: extracted.text.length,
      resolvedAt: new Date().toISOString(),
    };
    await writeRawJson(slug, "fulltext_status.json", record);
  } else {
    fullTextStatus = await resolveFullText({ slug, title, doi, url: sourceUrl });
  }

  const boundary = await resolveRegionBoundary(input.region);
  const fullText = await readExtractedText(slug);

  const analysis = await analyzePaper({
    metadata,
    fullText: fullText ?? metadata.abstract,
    region: input.region,
    taxonGroup: input.taxonGroup,
    regionBbox: boundary.bbox,
    // A manual contribution is one deliberately-pasted paper, not bulk
    // discovery — worth spending a real LLM extraction call on if the local
    // cascade can't confidently resolve it, unlike the default Stage B path.
    allowLlmFallback: true,
  });

  const entry = await updateCatalogEntry({
    metadata,
    analysis,
    fullTextStatus,
    region: input.region,
    taxonGroup: input.taxonGroup,
  });

  const entries = await queryCatalog({ region: input.region, taxa: [input.taxonGroup] });
  await buildWiki({ region: input.region, taxonGroup: input.taxonGroup, entries });
  await buildOutputs();

  return entry;
}

/**
 * Withdraws a manually-contributed paper — deletes its catalog entry and raw
 * evidence outright (unlike discovered papers, where raw/ is immutable for
 * provenance, a user retracting their own contribution is the one case
 * deletion is appropriate). Refuses to touch anything not tagged
 * `discoveredVia: "manual"`, so this can never be used to remove discovered
 * literature.
 */
export async function removeManualContribution(slug: string): Promise<{ removed: boolean; reason?: string }> {
  const entry = await readCatalogEntry(slug);
  if (!entry) return { removed: false, reason: "Not found." };
  if (entry.discoveredVia !== "manual") {
    return { removed: false, reason: "Refusing to remove a discovered (non-manual) document." };
  }

  await fs.rm(path.join(paths.catalog, `${slug}.json`), { force: true });
  await fs.rm(paperDir(slug), { recursive: true, force: true });
  return { removed: true };
}
