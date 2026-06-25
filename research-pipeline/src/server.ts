#!/usr/bin/env node
// Standalone HTTP wrapper around the research-pipeline CLI's own functions,
// for the DigitalOcean droplet — Vercel's serverless functions can't spawn
// long-lived detached child processes or hold a persistent on-disk corpus,
// so app/src/lib/research/runResearchPipeline.server.ts calls this service
// over HTTP instead of `spawn`-ing this project's CLI as a local sibling
// process (which only ever worked in local dev). Calls the same internal
// functions the CLI calls directly — no subprocess-of-itself, no
// stdout-parsing — since this runs as a persistent process, a fire-and-forget
// async call here keeps running across requests exactly like the CLI's
// detached spawn did, just simpler.
import express, { type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { runDiscoveryPhase, runAnalysisPhase } from "./pipeline/runPipeline.js";
import { readRunStatus } from "./corpus/runStatus.js";
import { readReviewCandidates, setReviewCandidateExcluded } from "./corpus/reviewStore.js";
import { setCatalogEntryExcluded } from "./corpus/catalogBuilder.js";
import { ingestManualContribution, removeManualContribution } from "./discovery/manualContribution.js";
import { paths } from "./config.js";

const PORT = process.env.PORT || 8081;
const SHARED_SECRET = process.env.INTERNAL_API_SECRET;

if (!SHARED_SECRET) {
  console.error("INTERNAL_API_SECRET is not set — refusing to start without an auth secret.");
  process.exit(1);
}

const app = express();
app.use(express.json({ limit: "5mb" }));
const upload = multer({ dest: os.tmpdir(), limits: { fileSize: 50 * 1024 * 1024 } });

app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.path === "/health") return next();
  if (req.headers["x-internal-secret"] !== SHARED_SECRET) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
});

app.get("/health", (_req: Request, res: Response) => res.json({ ok: true }));

function safe(handler: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response) => {
    Promise.resolve(handler(req, res)).catch((err: unknown) => {
      console.error(`[${req.method} ${req.path}] failed:`, err);
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    });
  };
}

// Stage A: starts discovery, returns immediately. The pipeline writes its
// own progress to raw/runs/<runId>.json as it goes (createRunStatusTracker,
// called inside runDiscoveryPhase) — same on-disk contract the old spawn-based
// approach relied on, just written by this long-lived process instead of a
// detached child.
app.post("/research/run", safe(async (req, res) => {
  const { runId, region, taxonGroup, resultsPerQuery } = req.body ?? {};
  if (!runId || !region || !taxonGroup) {
    return res.status(400).json({ error: "runId, region, and taxonGroup are required" });
  }
  runDiscoveryPhase({ runId, region, taxonGroup, resultsPerQuery }).catch((err) => {
    console.error(`[run ${runId}] discovery phase crashed:`, err);
  });
  res.json({ ok: true });
}));

app.post("/research/run/:runId/continue", safe(async (req, res) => {
  const { runId } = req.params;
  runAnalysisPhase(runId).catch((err) => {
    console.error(`[continue ${runId}] analysis phase crashed:`, err);
  });
  res.json({ ok: true });
}));

app.get("/research/run/:runId/status", safe(async (req, res) => {
  const status = await readRunStatus(req.params.runId);
  if (!status) return res.status(404).json({ error: `No run found for ${req.params.runId}` });
  res.json(status);
}));

app.get("/research/run/:runId/candidates", safe(async (req, res) => {
  const candidates = await readReviewCandidates(req.params.runId);
  res.json(candidates ?? null);
}));

app.post("/research/exclude-candidate", safe(async (req, res) => {
  const { runId, slug, excluded } = req.body ?? {};
  if (!runId || !slug || typeof excluded !== "boolean") {
    return res.status(400).json({ error: "runId, slug, and excluded (boolean) are required" });
  }
  const candidate = await setReviewCandidateExcluded(runId, slug, excluded);
  if (!candidate) return res.json({ ok: false, reason: "Not found." });
  res.json({ ok: true, slug: candidate.metadata.slug, excluded: candidate.excluded });
}));

app.post("/research/exclude-document", safe(async (req, res) => {
  const { slug, excluded } = req.body ?? {};
  if (!slug || typeof excluded !== "boolean") {
    return res.status(400).json({ error: "slug and excluded (boolean) are required" });
  }
  const entry = await setCatalogEntryExcluded(slug, excluded);
  if (!entry) return res.json({ ok: false, reason: "Not found." });
  res.json({ ok: true, slug: entry.slug, excluded: entry.excluded });
}));

// Contribute: accepts either multipart/form-data (PDF upload) or JSON ({url}).
app.post("/research/contribute", upload.single("file"), safe(async (req, res) => {
  const region = req.body?.region;
  const taxonGroup = req.body?.taxonGroup;
  const url = req.body?.url;
  const localPdfPath = req.file?.path;

  if (!region || !taxonGroup) return res.status(400).json({ error: "region and taxonGroup are required." });
  if (!url && !localPdfPath) return res.status(400).json({ error: "Provide a url or a file." });

  try {
    const entry = await ingestManualContribution({ region, taxonGroup, url, localPdfPath });
    res.json({ ok: true, entry });
  } finally {
    if (localPdfPath) await fs.unlink(localPdfPath).catch(() => {});
  }
}));

app.delete("/research/contribute", safe(async (req, res) => {
  const { slug } = req.body ?? {};
  if (!slug) return res.status(400).json({ error: "slug is required." });
  const result = await removeManualContribution(slug);
  res.json(result);
}));

// Batch reads for the Next.js GET /api/research/run/[runId] aggregation —
// one round trip each instead of N, mirroring the resolve-batch pattern
// already used for the GBIF backbone service.
app.get("/research/catalog", safe(async (_req, res) => {
  let files;
  try {
    files = await fs.readdir(paths.catalog);
  } catch {
    return res.json([]);
  }
  const entries = await Promise.all(
    files.filter((f) => f.endsWith(".json")).map(async (f) => {
      try {
        return JSON.parse(await fs.readFile(path.join(paths.catalog, f), "utf8"));
      } catch {
        return null;
      }
    }),
  );
  res.json(entries.filter(Boolean));
}));

app.post("/research/papers-analysis", safe(async (req, res) => {
  const { slugs } = req.body ?? {};
  if (!Array.isArray(slugs)) return res.status(400).json({ error: "slugs (array) is required" });
  const out: Record<string, unknown> = {};
  await Promise.all(
    (slugs as string[]).map(async (slug) => {
      try {
        const text = await fs.readFile(path.join(paths.raw, "papers", slug, "llm_analysis", "latest.json"), "utf8");
        out[slug] = JSON.parse(text);
      } catch {
        out[slug] = null;
      }
    }),
  );
  res.json(out);
}));

app.listen(PORT, () => {
  console.log(`research-pipeline-service listening on :${PORT}`);
});
