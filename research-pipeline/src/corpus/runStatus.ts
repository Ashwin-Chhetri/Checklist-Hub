import fs from "node:fs/promises";
import path from "node:path";
import { paths } from "../config.js";
import { isLlmEnabled } from "../analysis/llmClient.js";
import type { RunPhase, RunStatus, SourceOutcome } from "../types.js";

function runStatusPath(runId: string): string {
  return path.join(paths.raw, "runs", `${runId}.json`);
}

/**
 * Writes are now triggered once per paper from runAnalysisPhase's merged,
 * adaptively-concurrent per-paper loop (see pipeline/runPipeline.ts) — many
 * can be in flight at once. In-memory `status` itself stays consistent
 * (each update()'s read-merge-reassign is synchronous, so JS's single
 * threaded execution already serializes that part correctly) but the actual
 * `fs.writeFile` calls do not: two concurrent writes to the same path can
 * complete out of order, so a write carrying an OLDER snapshot can land on
 * disk AFTER a NEWER one, making the file (and therefore the UI polling it)
 * revert to stale counts. queuePersist below forces every write for one
 * tracker through a single chain, so writes always land in the same order
 * they were enqueued — same shape as analysis/llmClient.ts's LaneState
 * acquireSlot/releaseSlot mutual-exclusion pattern, simplified to a plain
 * FIFO queue (no concurrency cap needed, just ordering). Each write also
 * goes to a temp file + atomic rename, so a concurrent reader (the API
 * route's GET) can never observe a partially-written/truncated JSON file.
 */
function makeQueuedWriter(filePath: string): (write: () => Promise<void>) => Promise<void> {
  let queueTail: Promise<void> = Promise.resolve();
  return (write: () => Promise<void>): Promise<void> => {
    const result = queueTail.then(write);
    queueTail = result.catch(() => {});
    return result;
  };
}

async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(data, null, 2));
  await fs.rename(tmpPath, filePath);
}

/**
 * raw/runs/<runId>.json — run-level orchestration metadata, not "evidence,"
 * so unlike the rest of raw/ it's fine to mutate in place as the run
 * progresses. This is what the live UI trigger's GET /api/research/run/[id]
 * route polls (see plan "Live UI trigger").
 */
export function createRunStatusTracker(runId: string, region: string, taxonGroup: string) {
  const filePath = runStatusPath(runId);
  const queuePersist = makeQueuedWriter(filePath);
  let status: RunStatus = {
    runId,
    region,
    taxonGroup,
    phase: "starting",
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    counts: {},
    llmEnabled: isLlmEnabled(),
  };

  async function persist(): Promise<void> {
    await queuePersist(() => writeJsonAtomic(filePath, status));
  }

  return {
    async update(phase: RunPhase, counts: Record<string, number> = {}): Promise<void> {
      status = { ...status, phase, counts: { ...status.counts, ...counts }, updatedAt: new Date().toISOString() };
      await persist();
    },
    async fail(error: string): Promise<void> {
      status = { ...status, phase: "error", error, updatedAt: new Date().toISOString() };
      await persist();
    },
    /** Records per-source discovery outcomes (Scholar/curated web/Crossref/OpenAlex) so the live UI can show which sources actually contributed, rather than only an aggregate count — see discovery/multiSourceDiscovery.ts. */
    async setSourceOutcomes(sourceOutcomes: SourceOutcome[]): Promise<void> {
      status = { ...status, sourceOutcomes, updatedAt: new Date().toISOString() };
      await persist();
    },
    get current(): RunStatus {
      return status;
    },
  };
}

/**
 * Resumes an existing run's status tracker (region/taxonGroup/llmEnabled
 * already known from when the discovery phase created it) — for
 * runAnalysisPhase, which is invoked with just a runId after the user
 * finishes reviewing the candidate pool. Throws if the run doesn't exist;
 * unlike createRunStatusTracker there's no sensible "start fresh" fallback
 * here, since resuming a run that was never discovered makes no sense.
 */
export async function loadRunStatusTracker(runId: string) {
  const filePath = runStatusPath(runId);
  const existing = await readRunStatus(runId);
  if (!existing) throw new Error(`No run found for ${runId} — cannot resume.`);

  const queuePersist = makeQueuedWriter(filePath);
  let status: RunStatus = existing;

  async function persist(): Promise<void> {
    await queuePersist(() => writeJsonAtomic(filePath, status));
  }

  return {
    async update(phase: RunPhase, counts: Record<string, number> = {}): Promise<void> {
      status = { ...status, phase, counts: { ...status.counts, ...counts }, updatedAt: new Date().toISOString() };
      await persist();
    },
    async fail(error: string): Promise<void> {
      status = { ...status, phase: "error", error, updatedAt: new Date().toISOString() };
      await persist();
    },
    get current(): RunStatus {
      return status;
    },
  };
}

export async function readRunStatus(runId: string): Promise<RunStatus | null> {
  try {
    const raw = await fs.readFile(runStatusPath(runId), "utf8");
    return JSON.parse(raw) as RunStatus;
  } catch {
    return null;
  }
}
