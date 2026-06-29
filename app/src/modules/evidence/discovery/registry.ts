import type { EvidenceProvider } from "./types";
import { gbifProvider } from "./providers/gbifProvider";
import { ebirdProvider } from "./providers/ebirdProvider";
import { inaturalistProvider } from "./providers/inaturalistProvider";
import { literatureProvider } from "./providers/literatureProvider";

/**
 * The registered evidence providers, in display order. To add a new evidence
 * source, implement an `EvidenceProvider` and append it here — the aggregator,
 * hook, and inventory UI pick it up automatically.
 */
export const EVIDENCE_PROVIDERS: EvidenceProvider[] = [
  gbifProvider,
  ebirdProvider,
  inaturalistProvider,
  // TEMPORARILY DISABLED: literature search is taking far too long (see
  // literature/search.ts + llm.ts). Re-enable once the slowness is fixed.
  // literatureProvider,
];
