import { PDFParse } from "pdf-parse";

export interface PdfExtractResult {
  text: string;
  /** True when the extracted text is too sparse to be meaningful (e.g. a scanned PDF with no embedded text layer). */
  looksEmpty: boolean;
  /** True when extracted but the alpha-character ratio is too low to be readable prose (common OCR/encoding garbling). */
  looksGarbled: boolean;
}

const MIN_MEANINGFUL_LENGTH = 200;
const MIN_ALPHA_RATIO = 0.5;

function alphaRatio(text: string): number {
  if (text.length === 0) return 0;
  const alpha = text.replace(/[^a-zA-Z]/g, "").length;
  return alpha / text.length;
}

/**
 * Extracts plain text from a downloaded PDF buffer using pdf-parse (pure JS,
 * no system/native dependency — chosen specifically so this CLI tool has no
 * install friction). Downstream consumers (coordinate regex, locality regex,
 * LLM species extraction) only need a text blob, not layout-preserving
 * structure, so pdf-parse's simple text-concatenation output is sufficient.
 * Flags empty/garbled output explicitly rather than letting it look
 * indistinguishable from "we looked and found nothing." Never throws — a
 * malformed/non-PDF buffer (e.g. an HTML landing page returned in place of
 * the actual PDF a URL claimed to be) reports as "empty" rather than
 * crashing the whole pipeline, which previously happened when pdf-parse hit
 * an `InvalidPDFException` from an uncaught downstream call.
 */
export async function extractPdfText(buffer: Buffer): Promise<PdfExtractResult> {
  let parser: PDFParse | null = null;
  try {
    parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    const text = result.text ?? "";
    return {
      text,
      looksEmpty: text.trim().length < MIN_MEANINGFUL_LENGTH,
      looksGarbled: text.trim().length >= MIN_MEANINGFUL_LENGTH && alphaRatio(text) < MIN_ALPHA_RATIO,
    };
  } catch {
    return { text: "", looksEmpty: true, looksGarbled: false };
  } finally {
    await parser?.destroy().catch(() => {});
  }
}
