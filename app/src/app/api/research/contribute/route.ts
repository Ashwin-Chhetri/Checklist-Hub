import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { isResearchPipelineAvailable, runContribute, runRemoveContribution } from "@/lib/research/runResearchPipeline.server";

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

// Ingests a user-supplied PDF (multipart/form-data) or link (JSON {url})
// into research-pipeline's corpus, tagged discoveredVia: "manual" — see
// discovery/manualContribution.ts. Runs synchronously (a single paper is
// fast); not part of the detached/polled deep-search run. No Supabase
// writes — this is not yet checklist evidence (see research-pipeline
// README "Design notes").
export async function POST(request: Request) {
  const availability = isResearchPipelineAvailable();
  if (!availability.available) {
    return NextResponse.json({ error: availability.reason }, { status: 503 });
  }

  const contentType = request.headers.get("content-type") ?? "";
  let region: string | undefined;
  let taxonGroup: string | undefined;
  let url: string | undefined;
  let pdfPath: string | undefined;
  let tempFileToClean: string | undefined;

  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      region = form.get("region")?.toString();
      taxonGroup = form.get("taxonGroup")?.toString();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "No file provided." }, { status: 400 });
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        return NextResponse.json({ error: "File too large (50MB limit)." }, { status: 400 });
      }
      const buffer = Buffer.from(await file.arrayBuffer());
      pdfPath = path.join(os.tmpdir(), `checklisthub-contribution-${randomUUID()}.pdf`);
      tempFileToClean = pdfPath;
      await fs.writeFile(pdfPath, buffer);
    } else {
      const body = (await request.json()) as { region?: string; taxonGroup?: string; url?: string };
      region = body.region;
      taxonGroup = body.taxonGroup;
      url = body.url;
    }

    if (!region || !taxonGroup) {
      return NextResponse.json({ error: "region and taxonGroup are required." }, { status: 400 });
    }
    if (!url && !pdfPath) {
      return NextResponse.json({ error: "Provide a url or a file." }, { status: 400 });
    }

    const result = await runContribute({ region, taxonGroup, url, pdfPath });
    if (!result.ok || !result.entry) {
      return NextResponse.json({ error: `Failed to ingest contribution.\n${result.output}` }, { status: 500 });
    }
    return NextResponse.json({ ok: true, entry: result.entry });
  } finally {
    if (tempFileToClean) await fs.unlink(tempFileToClean).catch(() => {});
  }
}

// Withdraws a manually-contributed paper. Refuses (server-side, in
// research-pipeline) to touch anything not tagged discoveredVia: "manual" —
// this can never be used to remove discovered literature.
export async function DELETE(request: Request) {
  const { slug } = (await request.json()) as { slug?: string };
  if (!slug) return NextResponse.json({ error: "slug is required." }, { status: 400 });

  const availability = isResearchPipelineAvailable();
  if (!availability.available) {
    return NextResponse.json({ error: availability.reason }, { status: 503 });
  }

  const result = await runRemoveContribution(slug);
  if (!result.removed) {
    return NextResponse.json({ error: result.reason ?? "Failed to remove contribution." }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
