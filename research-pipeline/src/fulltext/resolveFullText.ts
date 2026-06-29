import { resolveOpenAccess } from "./unpaywall.js";
import { findOpenAccessPdf } from "../sources/core.js";
import { getBhlFullText } from "../sources/bhl.js";
import { extractPdfText } from "./pdfExtract.js";
import { writeRawFile, writeRawJson } from "../corpus/rawStore.js";
import { recordHttpStatus } from "../util/httpSignals.js";
import type { FullTextStatus, FullTextStatusRecord } from "../types.js";

const MAX_PDF_BYTES = 50 * 1024 * 1024;

interface DownloadResult {
  buffer: Buffer;
}

/**
 * Exported for reuse by discovery/manualContribution.ts, which also needs
 * to download a directly-pasted PDF URL. Validates the response is
 * actually PDF data (magic bytes "%PDF") before returning it — a URL that
 * looks like a PDF link can resolve to an HTML landing page (paywall,
 * cookie-consent redirect, etc.), and treating that as a PDF buffer crashed
 * the parser downstream with an uncaught InvalidPDFException.
 */
export async function downloadPdf(url: string): Promise<DownloadResult | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) {
      recordHttpStatus(response.status);
      return null;
    }

    const contentLength = response.headers.get("content-length");
    if (contentLength && Number(contentLength) > MAX_PDF_BYTES) return null;

    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_PDF_BYTES) return null;

    const buffer = Buffer.from(arrayBuffer);
    if (buffer.subarray(0, 5).toString("latin1") !== "%PDF-") return null;

    return { buffer };
  } catch {
    return null;
  }
}

interface DownloadAndExtractResult {
  status: FullTextStatus;
  textLength: number;
}

/** Shared by every PDF-bearing step below (DOI-driven OA location, discovered URL) — downloads, persists the raw bytes, extracts text, persists that too. Returns null when the URL didn't actually serve a valid PDF (downloadPdf's own magic-byte check). */
async function downloadAndExtractPdf(slug: string, pdfUrl: string): Promise<DownloadAndExtractResult | null> {
  const downloaded = await downloadPdf(pdfUrl);
  if (!downloaded) return null;

  await writeRawFile(slug, "paper.pdf", downloaded.buffer);
  const extracted = await extractPdfText(downloaded.buffer);
  await writeRawFile(slug, "extracted_text.md", extracted.text);

  return {
    textLength: extracted.text.length,
    status: extracted.looksEmpty ? "extracted_empty" : extracted.looksGarbled ? "extracted_garbled" : "extracted",
  };
}

export interface FullTextInput {
  slug: string;
  title: string;
  doi?: string;
  /** Set when this paper was discovered via BHL search — enables the BHL OCR fallback even with no DOI. */
  bhlTitleId?: number;
  /**
   * The URL this candidate was originally discovered at (Scholar, curated
   * web search, Crossref, OpenAlex, or a manual contribution) — tried as a
   * last-resort direct download when no DOI-driven OA location and no BHL
   * item resolves. This is NOT scraping a different/hidden copy: it's the
   * exact same public link already on file for this candidate, fetched
   * unauthenticated (no login, no cookies) — the same legal posture as the
   * Unpaywall/CORE links above, just one more place to look. downloadPdf's
   * magic-byte check still guards against a paywall/landing-page redirect
   * being mistaken for a real PDF.
   */
  url?: string;
}

/**
 * The full-text chain: Title -> DOI (resolved upstream in
 * buildPaperMetadata.ts, not here) -> Unpaywall -> CORE -> BHL -> the
 * candidate's own discovered URL -> PDF -> pdf-parse. Deliberately does NOT
 * call ScholarMCP's ingest_paper_fulltext — see README "Design notes."
 * Never scrapes an authenticated/paywalled copy: every step here only ever
 * fetches a public URL unauthenticated; if none of them serve real PDF
 * bytes, stores metadata-only and returns cleanly rather than throwing.
 */
export async function resolveFullText(input: FullTextInput): Promise<FullTextStatus> {
  let status: FullTextStatus = "metadata_only";
  let resolvedVia: FullTextStatusRecord["resolvedVia"] = "none";
  let textLength: number | undefined;

  let triedAndFoundNoOaCopy = false;

  if (input.doi) {
    const unpaywallLocation = await resolveOpenAccess(input.doi);
    const pdfUrl = unpaywallLocation?.pdfUrl ?? (await findOpenAccessPdf({ doi: input.doi, title: input.title }));
    const via: FullTextStatusRecord["resolvedVia"] = unpaywallLocation?.pdfUrl ? "unpaywall" : "core";

    if (pdfUrl) {
      const result = await downloadAndExtractPdf(input.slug, pdfUrl);
      if (result) {
        status = result.status;
        textLength = result.textLength;
        resolvedVia = via;
      } else {
        triedAndFoundNoOaCopy = true;
      }
    } else {
      triedAndFoundNoOaCopy = true;
    }
  }

  if (status === "metadata_only" && input.bhlTitleId) {
    const ocrText = await getBhlFullText(input.bhlTitleId);
    if (ocrText) {
      await writeRawFile(input.slug, "extracted_text.md", ocrText);
      textLength = ocrText.length;
      resolvedVia = "bhl_ocr";
      status = ocrText.length < 200 ? "extracted_empty" : "extracted";
    }
  }

  // Last resort: the candidate's own already-discovered URL — see
  // FullTextInput.url's doc comment for why this is safe to try
  // unconditionally rather than restricted to known-OA domains. Only
  // reached when the DOI-driven chain and BHL have both come up empty, so
  // a real Unpaywall/CORE/BHL hit is always preferred when one exists.
  if (status === "metadata_only" && input.url) {
    const result = await downloadAndExtractPdf(input.slug, input.url);
    if (result) {
      status = result.status;
      textLength = result.textLength;
      resolvedVia = "discovered_url";
    } else {
      triedAndFoundNoOaCopy = true;
    }
  }

  // Actively looked (Unpaywall + CORE + the discovered URL, whichever
  // applied) but found no legal/public copy anywhere: distinct from
  // "metadata_only" (nothing to even attempt) — this is the explicit
  // "never scrape paywalled content" boundary.
  if (status === "metadata_only" && triedAndFoundNoOaCopy && resolvedVia === "none") {
    status = "paywalled_skipped";
  }

  const record: FullTextStatusRecord = {
    status,
    resolvedVia,
    textLength,
    resolvedAt: new Date().toISOString(),
  };
  await writeRawJson(input.slug, "fulltext_status.json", record);

  return status;
}
