"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Checklist, ChecklistContributor, ChecklistMetadata } from "@/types/checklist.types";
import type { Species } from "@/types/species.types";
import { createClient } from "@/lib/supabase/client";
import AppHeader from "@/components/shared/AppHeader";
import Avatar from "@/components/shared/Avatar";
import SettingsModal from "@/components/workbench/SettingsModal";
import { useChecklistCollaborators } from "@/modules/checklist/hooks/useChecklist";
import { useCurrentUser } from "@/modules/auth/hooks/useCurrentUser";
import { useProfile } from "@/modules/auth/hooks/useProfile";
import { useRegionBoundary } from "@/modules/checklist/hooks/useRegionBoundary";
import TeamModal from "@/components/workbench/TeamModal";
import { usePublicationDraft, useSavePublicationDraftStage } from "../hooks/usePublicationDraft";
import { usePublicationComments, usePostPublicationComment } from "../hooks/usePublicationComments";
import { usePublicationVersions, useCreatePublicationVersion } from "../hooks/usePublicationVersions";
import { useApplySpeciesEdits } from "../hooks/useApplySpeciesEdits";
import type { SpeciesEditUpdate } from "../services/speciesEditService";
import { useSaveChecklistMetadata } from "../hooks/useSaveChecklistMetadata";
import { fetchSpeciesMediaMap } from "../services/packageMediaService";
import { PUBLICATION_EXPORTS_BUCKET } from "../services/publicationDraftService";
import {
  buildDwcaFiles,
  downloadBlob,
  parseEmlMetadataFields,
  prettyPrintXml,
  tsvFile,
  zipDwcaFiles,
  type DwcaFile,
  type DwcaPackage,
} from "../utils/darwinCore";
import { boundingBoxFromGeometry } from "../utils/boundingBox";

const REQUIRED_FILES = new Set(["taxon.txt", "eml.xml", "meta.xml"]);
const FILE_ORDER = [
  "taxon.txt",
  "vernacularname.txt",
  "distribution.txt",
  "resourcerelationship.txt",
  "multimedia.txt",
  "eml.xml",
  "meta.xml",
];

/**
 * Files editable in the package preview. Two kinds:
 *  - **Write-back** (taxon.txt/vernacularname.txt cells, eml.xml's known
 *    tags via `parseEmlMetadataFields`): edits persist to `species`/
 *    `checklist_metadata`, so future regenerations keep reflecting them.
 *  - **Override-only** (meta.xml, distribution.txt): no real field to write
 *    back to — meta.xml is purely code-derived (`TAXON_COLUMNS`/`EXTENSIONS`
 *    in darwinCore.ts), and distribution.txt's columns are either
 *    checklist-region-level (locationID/locality/country) or a computed
 *    citation string (source), not per-species stored data. Edits to these
 *    are captured into this version's snapshot only — the next
 *    "Regenerate" rebuilds them fresh, same as today.
 * resourcerelationship.txt/multimedia.txt stay non-editable: derived from
 * the synonyms array (its own dedicated Taxonomy panel UI) or live-fetched
 * from GBIF and never stored at all.
 */
const EDITABLE_FILES = new Set(["taxon.txt", "vernacularname.txt", "eml.xml", "meta.xml", "distribution.txt"]);

/** Files with no write-back target — see `EDITABLE_FILES` doc above. */
const OVERRIDE_ONLY_FILES = new Set(["meta.xml", "distribution.txt"]);

/** Column → writable per TSV file, keyed by the file's own header text (read at edit time, not hardcoded against `darwinCore.ts`'s column order) so this never silently drifts out of sync with the actual export columns. */
const EDITABLE_COLUMNS: Record<string, Set<string>> = {
  "taxon.txt": new Set([
    "scientificName",
    "scientificNameAuthorship",
    "kingdom",
    "phylum",
    "class",
    "order",
    "family",
    "genus",
    "vernacularName",
  ]),
  "vernacularname.txt": new Set(["vernacularName"]),
  "distribution.txt": new Set(["locationID", "locality", "country", "occurrenceStatus", "source"]),
};

/** Maps an editable taxon.txt/vernacularname.txt column name to the `species` field it writes back to — see `apply_species_edits` (migration 0044). */
const COLUMN_TO_SPECIES_FIELD: Record<string, keyof Omit<SpeciesEditUpdate, "species_id">> = {
  scientificName: "scientific_name",
  scientificNameAuthorship: "authorship",
  kingdom: "kingdom",
  phylum: "phylum",
  class: "class",
  order: "order",
  family: "family",
  genus: "genus",
  vernacularName: "common_name",
};

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins} min ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  return date.toLocaleDateString();
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface PublishPackagePageProps {
  checklist: Checklist | undefined;
  checklistId: string;
  metadata: ChecklistMetadata | null;
  contributors: ChecklistContributor[];
  acceptedSpecies: Species[];
  onBack: () => void;
  onContinueToIpt: () => void;
}

export function PublishPackagePage({
  checklist,
  checklistId,
  metadata,
  contributors,
  acceptedSpecies,
  onBack,
  onContinueToIpt,
}: PublishPackagePageProps) {
  const { data: collaborators } = useChecklistCollaborators(checklistId);
  const { data: currentUser } = useCurrentUser();
  const { data: currentProfile } = useProfile(currentUser?.id);
  const { data: ownerProfile } = useProfile(checklist?.owner_id);
  const { data: draft } = usePublicationDraft(checklistId);
  const saveDraftStage = useSavePublicationDraftStage(checklistId);
  const { data: comments } = usePublicationComments(checklistId);
  const postComment = usePostPublicationComment(checklistId);
  const { data: versions } = usePublicationVersions(checklistId);
  const createVersion = useCreatePublicationVersion(checklistId);
  const applySpeciesEdits = useApplySpeciesEdits(checklistId);
  const saveMetadata = useSaveChecklistMetadata(checklistId);
  const { data: regionBoundary } = useRegionBoundary({
    gadmId: checklist?.region_gadm_id,
    osmType: checklist?.region_osm_type,
    osmId: checklist?.region_osm_id,
  });
  const regionBoundingBox = regionBoundary?.geometry ? boundingBoxFromGeometry(regionBoundary.geometry) : null;

  const [showTeamModal, setShowTeamModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [dwcaPackage, setDwcaPackage] = useState<DwcaPackage | null>(null);
  const [selectedFile, setSelectedFile] = useState("taxon.txt");
  const [viewMode, setViewMode] = useState<"preview" | "raw">("preview");
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [mediaProgress, setMediaProgress] = useState<{ done: number; total: number } | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(draft?.package_generated_at ?? null);
  const [commentBody, setCommentBody] = useState("");
  const generatedRef = useRef(false);

  const [editMode, setEditMode] = useState(false);
  const [editHeader, setEditHeader] = useState<string[] | null>(null);
  const [editStartRows, setEditStartRows] = useState<string[][] | null>(null);
  const [editedRows, setEditedRows] = useState<string[][] | null>(null);
  const [editedXml, setEditedXml] = useState<string | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [saveEditError, setSaveEditError] = useState<string | null>(null);

  async function uploadPackage(blob: Blob) {
    if (!checklist) return;
    setUploadError(null);
    try {
      const supabase = createClient();
      const path = `${checklistId}/${checklist.title}-dwca.zip`;
      const { error } = await supabase.storage
        .from(PUBLICATION_EXPORTS_BUCKET)
        .upload(path, blob, { upsert: true, contentType: "application/zip" });
      if (error) throw error;

      const now = new Date().toISOString();
      await saveDraftStage.mutateAsync({ stage: "review", packageStoragePath: path, packageGeneratedAt: now });
      setGeneratedAt(now);
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Unknown error.";
      setUploadError(
        `Package was built locally but couldn't be saved to server storage (${reason}). You can still preview and download it below — click Retry Upload once this is resolved.`,
      );
    }
  }

  async function generatePackage() {
    if (!checklist) return;
    setGenerateError(null);
    setUploadError(null);

    // Build everything except real multimedia data first — it's all
    // synchronous and instant, so the reviewer can start browsing the
    // package right away instead of waiting on the (often slow) GBIF media
    // lookups behind multimedia.txt.
    const interimFiles = buildDwcaFiles(checklist, metadata, contributors, acceptedSpecies, new Map(), regionBoundingBox);
    const interimBlob = await zipDwcaFiles(interimFiles);
    setDwcaPackage({ files: interimFiles, blob: interimBlob });
    setSelectedFile("taxon.txt");

    setMediaProgress({ done: 0, total: acceptedSpecies.length });
    let finalBlob = interimBlob;
    try {
      const mediaMap = await fetchSpeciesMediaMap(acceptedSpecies, (done, total) => setMediaProgress({ done, total }));
      const finalFiles = buildDwcaFiles(checklist, metadata, contributors, acceptedSpecies, mediaMap, regionBoundingBox);
      finalBlob = await zipDwcaFiles(finalFiles);
      // Always show the locally-built package, including real media rows,
      // regardless of whether the upload below succeeds — a storage/RLS
      // failure should never hide a package that built successfully.
      setDwcaPackage({ files: finalFiles, blob: finalBlob });
    } catch (err) {
      setGenerateError(
        `Couldn't fetch GBIF media for multimedia.txt (${err instanceof Error ? err.message : "unknown error"}) — the rest of the package is unaffected.`,
      );
    } finally {
      setMediaProgress(null);
    }

    await uploadPackage(finalBlob);
  }

  function retryUpload() {
    if (!dwcaPackage) return;
    uploadPackage(dwcaPackage.blob);
  }

  function enterEditMode() {
    const contents = dwcaPackage?.files.find((f) => f.name === selectedFile)?.contents ?? "";
    if (selectedFile === "eml.xml" || selectedFile === "meta.xml") {
      setEditedXml(contents);
    } else {
      const lines = contents.split("\n").filter(Boolean);
      const [header, ...rows] = lines.map((l) => l.split("\t"));
      setEditHeader(header ?? []);
      setEditStartRows(rows.map((r) => [...r]));
      setEditedRows(rows.map((r) => [...r]));
      setViewMode("preview");
    }
    setSaveEditError(null);
    setEditMode(true);
  }

  function cancelEdit() {
    setEditMode(false);
    setEditHeader(null);
    setEditStartRows(null);
    setEditedRows(null);
    setEditedXml(null);
    setSaveEditError(null);
  }

  function setEditedCell(rowIndex: number, colIndex: number, value: string) {
    setEditedRows((prev) =>
      prev ? prev.map((row, ri) => (ri === rowIndex ? row.map((cell, ci) => (ci === colIndex ? value : cell)) : row)) : prev,
    );
  }

  /**
   * Saves the in-progress edit: writes back to `species`/`checklist_metadata`
   * where a real field exists (taxon.txt/vernacularname.txt cells, eml.xml's
   * known tags — see `parseEmlMetadataFields`), regenerates every file from
   * the now-current data, and snapshots the result as a new permanent
   * version. meta.xml has no write-back target at all (purely code-derived)
   * — its edited text is captured verbatim into this version only.
   */
  async function saveEdit() {
    if (!checklist || !dwcaPackage) return;
    setIsSavingEdit(true);
    setSaveEditError(null);

    try {
      let patchedSpecies = acceptedSpecies;
      let metadataOverride: Partial<ChecklistMetadata> | null = null;
      let changeSummary = `Edited ${selectedFile}`;

      if (selectedFile === "taxon.txt" || selectedFile === "vernacularname.txt") {
        if (!editedRows || !editStartRows || !editHeader) return;
        const editableCols = EDITABLE_COLUMNS[selectedFile] ?? new Set<string>();
        const updates: SpeciesEditUpdate[] = [];
        const patched = acceptedSpecies.map((s) => ({ ...s, taxonomy: { ...s.taxonomy } }));

        editedRows.forEach((row, ri) => {
          const original = editStartRows[ri];
          const species = acceptedSpecies[ri];
          if (!species) return;
          let rowChanged = false;
          const update: SpeciesEditUpdate = { species_id: species.id };

          editHeader.forEach((colName, ci) => {
            if (!editableCols.has(colName) || row[ci] === original[ci]) return;
            rowChanged = true;
            const value = row[ci];
            const field = COLUMN_TO_SPECIES_FIELD[colName];
            if (!field) return;
            (update as unknown as Record<string, string>)[field] = value;
            if (field === "authorship") {
              patched[ri].taxonomy.authorship = value;
            } else if (field === "common_name") {
              patched[ri].common_name = value;
            } else {
              (patched[ri] as unknown as Record<string, string>)[field] = value;
            }
          });

          if (rowChanged) updates.push(update);
        });

        if (updates.length === 0) {
          cancelEdit();
          return;
        }

        await applySpeciesEdits.mutateAsync(updates);
        patchedSpecies = patched;
        changeSummary = `Edited ${selectedFile} — ${updates.length} species updated`;
      } else if (selectedFile === "eml.xml") {
        if (editedXml == null) return;
        let parsed: Partial<ChecklistMetadata>;
        try {
          parsed = parseEmlMetadataFields(editedXml);
        } catch (err) {
          setSaveEditError(err instanceof Error ? err.message : "Couldn't parse that XML.");
          return;
        }
        await saveMetadata.mutateAsync({ metadata: parsed, contributors });
        metadataOverride = parsed;
        changeSummary = "Edited eml.xml metadata";
      } else if (selectedFile === "meta.xml") {
        if (editedXml == null) return;
        changeSummary = "Edited meta.xml (this version only — regenerating rebuilds it fresh)";
      } else if (selectedFile === "distribution.txt") {
        if (!editedRows || !editHeader) return;
        changeSummary = "Edited distribution.txt (this version only — regenerating rebuilds it fresh)";
      }

      const effectiveMetadata: ChecklistMetadata = { ...(metadata ?? {}), ...metadataOverride } as ChecklistMetadata;

      const freshFiles = buildDwcaFiles(checklist, effectiveMetadata, contributors, patchedSpecies, new Map(), regionBoundingBox);
      const preservedMultimedia = dwcaPackage.files.find((f) => f.name === "multimedia.txt");
      let files: DwcaFile[] = freshFiles.map((f) => (f.name === "multimedia.txt" && preservedMultimedia ? preservedMultimedia : f));
      // Override-only files have nothing to regenerate from — substitute
      // whatever the user just edited verbatim into this version's snapshot.
      if (OVERRIDE_ONLY_FILES.has(selectedFile)) {
        const overrideContents =
          selectedFile === "meta.xml"
            ? editedXml
            : editHeader && editedRows
              ? tsvFile(editHeader, editedRows)
              : null;
        if (overrideContents != null) {
          files = files.map((f) => (f.name === selectedFile ? { name: selectedFile, contents: overrideContents } : f));
        }
      }

      const blob = await zipDwcaFiles(files);
      setDwcaPackage({ files, blob });

      const supabase = createClient();
      const packagePath = `${checklistId}/versions/${Date.now()}/${checklist.title}-dwca.zip`;
      const { error: uploadErr } = await supabase.storage
        .from(PUBLICATION_EXPORTS_BUCKET)
        .upload(packagePath, blob, { contentType: "application/zip" });
      if (uploadErr) throw uploadErr;

      await createVersion.mutateAsync({
        checklistId,
        metadataSnapshot: effectiveMetadata,
        contributorsSnapshot: contributors,
        files,
        packageStoragePath: packagePath,
        changeSummary,
        editedFile: selectedFile,
      });

      const now = new Date().toISOString();
      await saveDraftStage.mutateAsync({ stage: "review", packageStoragePath: packagePath, packageGeneratedAt: now });
      setGeneratedAt(now);
      cancelEdit();
    } catch (err) {
      setSaveEditError(err instanceof Error ? err.message : "Failed to save edit.");
    } finally {
      setIsSavingEdit(false);
    }
  }

  useEffect(() => {
    if (generatedRef.current) return;
    if (!checklist || acceptedSpecies.length === 0) return;
    generatedRef.current = true;
    // Deferred so the effect body itself never calls setState synchronously.
    queueMicrotask(() => {
      generatePackage();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checklist, acceptedSpecies]);

  function handleDownload() {
    if (!dwcaPackage) return;
    downloadBlob(`${checklist?.title ?? "checklist"}-dwca.zip`, dwcaPackage.blob);
  }

  // Approval must reflect the *current* package, not approval history in
  // general — so it only counts if the most recent decision comment is an
  // approval (a later "Request Changes" revokes it) and that approval was
  // made after the latest version was generated (regenerating/editing the
  // package after approval also revokes it, since the approved content no
  // longer exists).
  const hasApproval = useMemo(() => {
    const decisionComments = (comments ?? []).filter((c) => c.decision != null);
    if (decisionComments.length === 0) return false;
    const latestDecision = decisionComments[decisionComments.length - 1];
    if (latestDecision.decision !== "approve") return false;
    const latestVersionCreatedAt = versions?.[0]?.created_at;
    if (latestVersionCreatedAt && new Date(latestDecision.created_at) < new Date(latestVersionCreatedAt)) return false;
    return true;
  }, [comments, versions]);

  function submitComment(decision?: "approve" | "request_changes") {
    if (!currentUser) return;
    const body =
      commentBody.trim() ||
      (decision === "approve" ? "Approved." : decision === "request_changes" ? "Requested changes." : "");
    if (!body) return;
    postComment.mutate(
      { checklistId, authorId: currentUser.id, body, decision: decision ?? null },
      { onSuccess: () => setCommentBody("") },
    );
  }

  const reviewers: { id: string; full_name: string | null }[] = [];
  if (checklist?.owner_id) reviewers.push({ id: checklist.owner_id, full_name: ownerProfile?.full_name ?? null });
  for (const c of collaborators ?? []) {
    if (c.user_id === checklist?.owner_id) continue;
    reviewers.push({ id: c.user_id, full_name: c.profile?.full_name ?? null });
  }

  const reviewerDecisions = useMemo(() => {
    const map = new Map<string, "approve" | "request_changes">();
    for (const c of comments ?? []) {
      if (c.decision) map.set(c.author_id, c.decision);
    }
    return map;
  }, [comments]);

  const selectedContents = dwcaPackage?.files.find((f) => f.name === selectedFile)?.contents ?? "";
  const isTxt = selectedFile.endsWith(".txt");
  const sizeBytes = dwcaPackage ? new TextEncoder().encode(selectedContents).length : 0;

  const previewRows = (() => {
    if (!isTxt || !selectedContents) return null;
    const lines = selectedContents.split("\n").filter(Boolean);
    const [header, ...rows] = lines.map((l) => l.split("\t"));
    return { header: header ?? [], rows: rows.slice(0, 200) };
  })();

  return (
    <div className="min-h-screen flex flex-col bg-surface text-on-surface">
      <header className="h-14 border-b border-surface-dim bg-white flex items-center justify-between px-4 z-50 sticky top-0">
        <div className="flex items-center gap-6">
          <AppHeader />
          <button
            type="button"
            onClick={onBack}
            className="bg-brand text-white px-3 py-1.5 rounded-sm text-xs mono-text font-medium flex items-center gap-2 shadow-hard hover:translate-y-[-1px] transition-transform"
          >
            <span className="material-symbols-outlined text-[16px]">arrow_back</span>
            Back to Metadata
          </button>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleDownload}
            disabled={!dwcaPackage}
            className="px-3 py-1.5 bg-white border border-surface-dim text-secondary text-[10px] mono-text font-bold uppercase rounded-sm flex items-center gap-2 hover:border-brand hover:text-brand transition-colors disabled:opacity-40"
          >
            <span className="material-symbols-outlined text-[16px]">download</span>
            Download
          </button>
          <button
            type="button"
            onClick={onContinueToIpt}
            disabled={!dwcaPackage || !hasApproval || !!uploadError}
            title={
              !hasApproval
                ? "A reviewer must approve the package before it can be published."
                : uploadError
                  ? "The package hasn't been saved to server storage yet — retry the upload first."
                  : undefined
            }
            className="bg-brand text-white px-4 py-1.5 rounded-sm font-label-caps text-[10px] uppercase shadow-hard hover:translate-y-[-1px] transition-transform disabled:opacity-50"
          >
            Continue to Publish
          </button>
          <button
            type="button"
            onClick={() => setShowSettings(true)}
            className="text-secondary hover:text-brand transition-colors"
          >
            <span className="material-symbols-outlined">settings</span>
          </button>
          <div className="w-8 h-8 rounded-full border border-surface-dim overflow-hidden">
            <Avatar src={currentProfile?.avatar_url} alt={currentProfile?.full_name ?? "You"} />
          </div>
        </div>
      </header>

      {showSettings && checklist && (
        <SettingsModal checklist={checklist} checklistId={checklistId} onClose={() => setShowSettings(false)} />
      )}

      {showTeamModal && collaborators && (
        <TeamModal
          checklistId={checklistId}
          collaborators={collaborators}
          currentUserId={currentUser?.id}
          canManageRoles={checklist?.owner_id === currentUser?.id}
          onClose={() => setShowTeamModal(false)}
        />
      )}

      <div className="flex flex-1 mx-auto w-full min-h-0">
        {/* Sidebar */}
        <aside className="hidden lg:flex flex-col w-64 flex-shrink-0 border-r border-surface-dim bg-surface-container-low overflow-y-auto">
          <section className="p-4 border-b border-surface-dim">
            <h3 className="font-label-caps text-[11px] text-secondary uppercase tracking-widest font-bold mb-4 flex justify-between items-center">
              Reviewers
              <button type="button" onClick={() => setShowTeamModal(true)} className="text-secondary hover:text-brand">
                <span className="material-symbols-outlined text-[14px]">settings</span>
              </button>
            </h3>
            <div className="space-y-3 font-body-sm text-xs">
              {reviewers.length === 0 && <p className="text-secondary text-[11px]">No reviewers yet.</p>}
              {reviewers.map((r) => {
                const decision = reviewerDecisions.get(r.id);
                return (
                  <div key={r.id} className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-5 h-5 rounded-full bg-surface-container-highest flex items-center justify-center text-[9px] font-bold text-secondary flex-shrink-0">
                        {(r.full_name ?? "?").charAt(0).toUpperCase()}
                      </span>
                      <span className="font-medium text-on-surface truncate">{r.full_name ?? "Unknown"}</span>
                    </div>
                    {decision === "approve" ? (
                      <span className="material-symbols-outlined text-[14px] text-emerald-600">check_circle</span>
                    ) : decision === "request_changes" ? (
                      <span className="material-symbols-outlined text-[14px] text-error">error</span>
                    ) : (
                      <span className="material-symbols-outlined text-[14px] text-secondary">history</span>
                    )}
                  </div>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => setShowTeamModal(true)}
              className="w-full mt-4 py-2 bg-brand text-white text-[10px] font-label-caps uppercase rounded-sm hover:opacity-90 transition-opacity"
            >
              + Assign Reviewer
            </button>
          </section>

          <div className="py-4">
            <div className="font-label-caps text-[11px] font-bold text-secondary uppercase tracking-[0.1em] mb-3 px-4">
              Package Contents
            </div>
            <ul className="space-y-0.5 font-code-md text-[12px]">
              {FILE_ORDER.map((name) => (
                <li
                  key={name}
                  onClick={() => {
                    if (editMode) cancelEdit();
                    setSelectedFile(name);
                    setViewMode("preview");
                  }}
                  className={`flex items-center justify-between px-4 py-2 cursor-pointer transition-colors ${
                    selectedFile === name
                      ? "bg-surface-container-high border-l-2 border-brand text-on-surface"
                      : "text-secondary hover:bg-surface-container-highest hover:text-on-surface"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className={`material-symbols-outlined text-[18px] ${selectedFile === name ? "text-brand" : ""}`}>
                      {name.endsWith(".xml") ? "code" : "description"}
                    </span>
                    <span>{name}</span>
                  </div>
                  {REQUIRED_FILES.has(name) && (
                    <span className="text-[9px] bg-brand/10 text-brand px-1 rounded-sm font-bold">REQ</span>
                  )}
                </li>
              ))}
            </ul>
            {mediaProgress && (
              <p className="px-4 mt-2 text-[10px] text-secondary font-code-md">
                Fetching media for multimedia.txt ({mediaProgress.done}/{mediaProgress.total})...
              </p>
            )}
          </div>

          <div className="mt-auto border-t border-surface-dim p-4 bg-surface-container">
            <div className="flex items-center justify-between mb-3">
              <div className="font-label-caps text-[10px] font-bold text-secondary uppercase tracking-widest">Metadata</div>
              <button
                type="button"
                onClick={generatePackage}
                disabled={!!mediaProgress}
                className="text-secondary hover:text-brand disabled:opacity-40"
                title="Regenerate package"
              >
                <span className="material-symbols-outlined text-[16px]">refresh</span>
              </button>
            </div>
            <div className="space-y-2 font-code-md text-[10px]">
              <div className="flex flex-col">
                <span className="text-secondary text-[8px] uppercase">Version</span>
                <span className="text-on-surface">{versions?.[0] ? `v${versions[0].version_number}` : `v${metadata?.dataset_version ?? "1.0"}`}</span>
              </div>
              <div className="flex flex-col">
                <span className="text-secondary text-[8px] uppercase">Generated</span>
                <span className="text-on-surface">{generatedAt ? new Date(generatedAt).toLocaleString() : "—"}</span>
              </div>
              <div className="flex flex-col">
                <span className="text-secondary text-[8px] uppercase">Size</span>
                <span className="text-on-surface">{dwcaPackage ? formatBytes(dwcaPackage.blob.size) : "—"}</span>
              </div>
            </div>
            {(versions?.length ?? 0) > 0 && (
              <details className="mt-3">
                <summary className="text-secondary text-[8px] uppercase cursor-pointer hover:text-brand">
                  Version History ({versions!.length})
                </summary>
                <div className="mt-2 space-y-1.5 max-h-32 overflow-y-auto">
                  {versions!.map((v) => (
                    <div key={v.id} className="font-code-md text-[9px] text-secondary">
                      <span className="font-bold text-on-surface">v{v.version_number}</span> — {v.change_summary}{" "}
                      <span className="text-secondary/70">({formatRelativeTime(v.created_at)})</span>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        </aside>

        {/* Main */}
        <div className="flex-1 flex flex-col min-w-0">
          <main className="flex-grow p-4 flex flex-col gap-4">
            {!dwcaPackage && !generateError ? (
              <div className="bg-white border border-surface-dim h-[59vh] min-h-[360px] flex items-center justify-center flex-col gap-3">
                <span className="material-symbols-outlined text-3xl text-brand animate-spin">progress_activity</span>
                <p className="font-code-md text-xs text-secondary">Generating package...</p>
              </div>
            ) : generateError && !dwcaPackage ? (
              <div className="bg-red-50 border border-red-200 text-error text-xs mono-text p-4 h-[55vh] min-h-[360px]">{generateError}</div>
            ) : (
              <div className="bg-white border border-surface-dim overflow-hidden flex flex-col h-[68vh] min-h-[360px]">
                <div className="bg-surface-container-low px-4 py-2 border-b border-surface-dim flex justify-between items-center">
                  <div className="flex items-center gap-4 font-code-md text-xs">
                    <span className="font-bold text-on-surface">{selectedFile}</span>
                    <span className="text-secondary">| {isTxt ? "text/tab-separated-values" : "application/xml"}</span>
                    <span className="text-secondary">| {formatBytes(sizeBytes)}</span>
                    {selectedFile === "multimedia.txt" && mediaProgress && (
                      <span className="text-secondary italic">still fetching media...</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {editMode ? (
                      <>
                        <button
                          type="button"
                          onClick={cancelEdit}
                          disabled={isSavingEdit}
                          className="px-2 py-1 border border-surface-dim text-secondary text-[10px] font-label-caps rounded-sm uppercase hover:border-brand hover:text-brand transition-all disabled:opacity-40"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={saveEdit}
                          disabled={isSavingEdit}
                          className="px-2 py-1 bg-brand text-white text-[10px] font-label-caps rounded-sm uppercase hover:opacity-90 transition-all disabled:opacity-50"
                        >
                          {isSavingEdit ? "Saving..." : "Save"}
                        </button>
                      </>
                    ) : (
                      <>
                        {EDITABLE_FILES.has(selectedFile) && (
                          <button
                            type="button"
                            onClick={enterEditMode}
                            disabled={!dwcaPackage}
                            className="px-2 py-1 border border-surface-dim text-secondary text-[10px] font-label-caps rounded-sm uppercase flex items-center gap-1 hover:border-brand hover:text-brand transition-all disabled:opacity-40"
                          >
                            Edit
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setViewMode("preview")}
                          className={`px-2 py-1 border text-[10px] font-label-caps rounded-sm uppercase transition-all ${
                            viewMode === "preview"
                              ? "bg-brand text-white border-brand"
                              : "bg-white border-surface-dim text-secondary hover:border-brand hover:text-brand"
                          }`}
                        >
                          Preview
                        </button>
                        <button
                          type="button"
                          onClick={() => setViewMode("raw")}
                          className={`px-2 py-1 border text-[10px] font-label-caps rounded-sm uppercase transition-all ${
                            viewMode === "raw"
                              ? "bg-brand text-white border-brand"
                              : "bg-white border-surface-dim text-secondary hover:border-brand hover:text-brand"
                          }`}
                        >
                          Raw
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {generateError && (
                  <div className="px-4 py-2 bg-red-50 border-b border-red-200 text-error text-xs mono-text">
                    {generateError}
                  </div>
                )}

                {uploadError && (
                  <div className="px-4 py-2 bg-amber-50 border-b border-amber-200 text-amber-800 text-xs mono-text flex items-center justify-between gap-3">
                    <span>{uploadError}</span>
                    <button
                      type="button"
                      onClick={retryUpload}
                      className="px-2 py-1 bg-white border border-amber-300 text-amber-800 text-[10px] font-label-caps uppercase rounded-sm hover:bg-amber-100 transition-colors whitespace-nowrap"
                    >
                      Retry Upload
                    </button>
                  </div>
                )}

                {saveEditError && (
                  <div className="px-4 py-2 bg-red-50 border-b border-red-200 text-error text-xs mono-text">{saveEditError}</div>
                )}

                {editMode && OVERRIDE_ONLY_FILES.has(selectedFile) && (
                  <div className="px-4 py-2 bg-amber-50 border-b border-amber-200 text-amber-800 text-[11px] mono-text">
                    {selectedFile} has no underlying data to save back to — this edit only affects this version; the
                    next &ldquo;Regenerate&rdquo; rebuilds it fresh from {selectedFile === "meta.xml" ? "the archive's actual structure" : "the checklist's region and evidence data"}.
                  </div>
                )}

                {editMode && selectedFile === "eml.xml" && (
                  <div className="px-4 py-2 bg-amber-50 border-b border-amber-200 text-amber-800 text-[11px] mono-text">
                    Saving updates dataset metadata (abstract, keywords, coverage, methodology, etc.) — creator/contributor
                    blocks and the geographic bounding box aren&apos;t parsed back; use the Metadata page for those.
                  </div>
                )}

                <div className="overflow-auto flex-grow bg-white">
                  {editMode && editedXml != null ? (
                    <textarea
                      className="w-full h-full min-h-[40vh] mono-text text-[11px] text-on-surface p-4 outline-none resize-none"
                      value={editedXml}
                      onChange={(e) => setEditedXml(e.target.value)}
                      spellCheck={false}
                    />
                  ) : editMode && editedRows && editHeader ? (
                    <table className="w-full border-collapse font-code-md text-[12px] text-on-surface">
                      <thead className="bg-surface-container-low border-b border-surface-dim sticky top-0">
                        <tr>
                          <th className="px-3 py-2 text-left font-bold text-secondary border-r border-surface-dim/30 whitespace-nowrap w-12">
                            #
                          </th>
                          {editHeader.map((col) => (
                            <th
                              key={col}
                              className="px-4 py-2 text-left font-bold text-brand border-r border-surface-dim/30 whitespace-nowrap"
                            >
                              {col}
                              {!EDITABLE_COLUMNS[selectedFile]?.has(col) && (
                                <span className="text-secondary font-normal ml-1" title="Derived, not editable here">
                                  (read-only)
                                </span>
                              )}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-surface-dim/30">
                        {editedRows.map((row, ri) => (
                          <tr key={ri} className="hover:bg-surface-container-low transition-colors">
                            <td className="px-3 py-2 border-r border-surface-dim/30 whitespace-nowrap text-secondary">{ri + 1}</td>
                            {row.map((cell, ci) => {
                              const writable = EDITABLE_COLUMNS[selectedFile]?.has(editHeader[ci]);
                              return (
                                <td key={ci} className="px-1 py-1 border-r border-surface-dim/30">
                                  {writable ? (
                                    <input
                                      className="w-full bg-surface-container-low/60 border border-surface-dim rounded-sm px-2 py-1 text-[12px] font-code-md outline-none focus:ring-1 focus:ring-brand focus:border-brand"
                                      value={cell}
                                      onChange={(e) => setEditedCell(ri, ci, e.target.value)}
                                    />
                                  ) : (
                                    <span className="px-2 py-1 block text-secondary whitespace-nowrap">{cell || "—"}</span>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : isTxt && viewMode === "preview" && previewRows ? (
                    <table className="w-full border-collapse font-code-md text-[12px] text-on-surface">
                      <thead className="bg-surface-container-low border-b border-surface-dim sticky top-0">
                        <tr>
                          <th className="px-3 py-2 text-left font-bold text-secondary border-r border-surface-dim/30 whitespace-nowrap w-12">
                            #
                          </th>
                          {previewRows.header.map((col) => (
                            <th
                              key={col}
                              className="px-4 py-2 text-left font-bold text-brand border-r border-surface-dim/30 whitespace-nowrap"
                            >
                              {col}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-surface-dim/30">
                        {previewRows.rows.map((row, i) => (
                          <tr key={i} className="hover:bg-surface-container-low transition-colors">
                            <td className="px-3 py-2 border-r border-surface-dim/30 whitespace-nowrap text-secondary">{i + 1}</td>
                            {row.map((cell, j) => (
                              <td key={j} className="px-4 py-2 border-r border-surface-dim/30 whitespace-nowrap">
                                {cell || "—"}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : !isTxt && viewMode === "preview" ? (
                    <pre className="mono-text text-[11px] text-on-surface whitespace-pre-wrap break-all p-4">
                      {prettyPrintXml(selectedContents) || "(empty)"}
                    </pre>
                  ) : (
                    <pre className="mono-text text-[11px] text-on-surface whitespace-pre-wrap break-all p-4">
                      {selectedContents || "(empty)"}
                    </pre>
                  )}
                </div>
              </div>
            )}

            {/* Review Activity & Actions */}
            <div className="bg-white border border-surface-dim flex flex-col">
              <div className="flex items-center justify-between px-4 py-2 border-b border-surface-dim bg-surface-container-low">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-[18px] text-secondary">history</span>
                  <h3 className="font-label-caps text-[11px] text-on-surface uppercase tracking-widest font-bold">
                    Review Activity &amp; Actions
                  </h3>
                </div>
                <span className="text-[10px] font-code-md text-secondary">{(comments ?? []).length} updates</span>
              </div>

              <div className="flex flex-col divide-y divide-surface-dim/30 font-code-md text-[12px] max-h-72 overflow-y-auto">
                {(comments ?? []).length === 0 && <p className="p-4 text-secondary text-xs">No review activity yet.</p>}
                {(comments ?? []).map((comment) => (
                  <div key={comment.id} className="p-3 hover:bg-surface-container-low transition-colors">
                    <div className="flex items-center gap-2 mb-1">
                      {comment.kind === "edit" && (
                        <span className="material-symbols-outlined text-[14px] text-secondary">edit</span>
                      )}
                      <span className="font-bold text-brand">{comment.author?.full_name ?? "Unknown"}</span>
                      <span className="text-secondary text-[10px]">{formatRelativeTime(comment.created_at)}</span>
                      {comment.kind === "edit" && comment.payload?.version_number != null && (
                        <span className="px-1.5 py-0.5 text-[10px] rounded-sm border font-bold bg-surface-container-high text-secondary border-surface-dim">
                          v{String(comment.payload.version_number)}
                        </span>
                      )}
                      {comment.decision && (
                        <span
                          className={`px-1.5 py-0.5 text-[10px] rounded-sm border font-bold uppercase ${
                            comment.decision === "approve"
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                              : "bg-red-50 text-error border-red-200"
                          }`}
                        >
                          {comment.decision === "approve" ? "Approved" : "Changes Requested"}
                        </span>
                      )}
                    </div>
                    <p className="text-on-surface leading-5">{comment.body}</p>
                  </div>
                ))}
              </div>

              <div className="p-3 border-t border-surface-dim bg-surface-container-low/50">
                <div className="flex gap-3">
                  <textarea
                    className="flex-grow bg-white border border-surface-dim rounded-sm p-2 font-body-sm text-xs focus:ring-1 focus:ring-brand focus:border-brand outline-none transition-all placeholder:text-secondary resize-none"
                    placeholder="Add a comment..."
                    rows={1}
                    value={commentBody}
                    onChange={(e) => setCommentBody(e.target.value)}
                  />
                  <div className="flex flex-col gap-1">
                    <button
                      type="button"
                      onClick={() => submitComment("approve")}
                      disabled={postComment.isPending}
                      className="bg-brand text-white px-3 py-1 rounded-sm font-label-caps text-[10px] uppercase hover:opacity-90 transition-all whitespace-nowrap disabled:opacity-50"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => submitComment("request_changes")}
                      disabled={postComment.isPending}
                      className="bg-white border border-surface-dim text-secondary px-3 py-1 rounded-sm font-label-caps text-[10px] uppercase hover:text-on-surface hover:border-secondary transition-all whitespace-nowrap disabled:opacity-50"
                    >
                      Request Changes
                    </button>
                    <button
                      type="button"
                      onClick={() => submitComment()}
                      disabled={postComment.isPending || !commentBody.trim()}
                      className="text-secondary px-3 py-1 rounded-sm font-label-caps text-[10px] uppercase hover:text-brand transition-all whitespace-nowrap disabled:opacity-40"
                    >
                      Comment
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
