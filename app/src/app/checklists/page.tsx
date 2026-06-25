"use client";

import Link from "next/link";
import { Fragment, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import AppHeader from "@/components/shared/AppHeader";
import Avatar from "@/components/shared/Avatar";
import CollaboratorAvatarStack from "@/components/shared/CollaboratorAvatarStack";
import NotificationBell from "@/components/shared/NotificationBell";
import TeamModal from "@/components/workbench/TeamModal";
import { useChecklists } from "@/modules/checklist/hooks/useChecklists";
import { useChecklistCollaborators } from "@/modules/checklist/hooks/useChecklist";
import { useChecklistsRealtime } from "@/modules/checklist/hooks/useChecklistsRealtime";
import { useProfile } from "@/modules/auth/hooks/useProfile";
import { useCurrentUser } from "@/modules/auth/hooks/useCurrentUser";
import { useSignOut } from "@/modules/auth/hooks/useAuth";
import { useDeleteChecklist } from "@/modules/checklist/hooks/useDeleteChecklist";
import { useClearPublicationPackage, useDeleteChecklistMetadata } from "@/modules/publication/hooks/usePublicationDraft";
import { downloadPublicationPackageBlob } from "@/modules/publication/services/publicationDraftService";
import { downloadBlob } from "@/modules/publication/utils/darwinCore";
import type { ChecklistStatus, TaxonomicScope } from "@/types/checklist.types";
import type { AppNotification } from "@/types/collaboration.types";

type Tab = "all" | "shared" | "watching" | "published" | "archived";

const STATUS_STYLES: Record<ChecklistStatus, string> = {
  draft: "bg-[#f3f4f6] text-[#374151] border-[#9ca3af]",
  importing: "bg-[#f3f4f6] text-[#374151] border-[#9ca3af]",
  validating: "bg-[#fef3c7] text-[#92400e] border-[#f59e0b]",
  reviewing: "bg-[#e0f2fe] text-[#075985] border-[#0ea5e9]",
  published: "bg-[#dcfce7] text-[#166534] border-[#22c55e]",
  archived: "bg-[#f3f4f6] text-[#374151] border-[#9ca3af]",
};

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours} hours ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function formatScope(taxonomicScope: TaxonomicScope): string {
  const parts = [taxonomicScope.kingdom, taxonomicScope.phylum, taxonomicScope.class].filter(
    Boolean,
  );
  return parts.join(" > ") || "—";
}

// 'reviewing' is repurposed (see supabase/migrations/0045) to mean
// "submitted to an IPT, awaiting GBIF registration" — display it as
// "Review" rather than the literal enum value.
const STATUS_LABELS: Partial<Record<ChecklistStatus, string>> = {
  reviewing: "Review",
};

function formatStatusLabel(status: ChecklistStatus): string {
  return STATUS_LABELS[status] ?? status;
}

export default function ChecklistsPage() {
  const router = useRouter();
  const { data: user } = useCurrentUser();
  const { data: profile } = useProfile(user?.id);
  const signOut = useSignOut();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const avatarUrl =
    profile?.avatar_url ?? user?.user_metadata?.avatar_url ?? user?.user_metadata?.picture;

  const { data: checklists, isLoading } = useChecklists();
  useChecklistsRealtime(Boolean(user?.id));
  const deleteChecklist = useDeleteChecklist();

  const [activeTab, setActiveTab] = useState<Tab>("all");
  const visibleChecklists = (() => {
    switch (activeTab) {
      case "shared":
        return checklists?.filter((c) => c.owner_id !== user?.id);
      case "published":
        return checklists?.filter((c) => c.status === "published");
      case "archived":
        return checklists?.filter((c) => c.status === "archived");
      case "watching":
        return checklists?.filter((c) => c.watcher?.is_active);
      default:
        return checklists;
    }
  })();

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const deletingChecklist = checklists?.find((c) => c.id === deletingId);

  const [teamChecklistId, setTeamChecklistId] = useState<string | null>(null);
  const teamChecklist = checklists?.find((c) => c.id === teamChecklistId);
  const { data: teamCollaborators } = useChecklistCollaborators(teamChecklistId ?? "");

  function openDeleteDialog(e: React.MouseEvent, checklistId: string) {
    e.preventDefault();
    e.stopPropagation();
    setDeletingId(checklistId);
    setDeleteConfirmText("");
  }

  function closeDeleteDialog() {
    setDeletingId(null);
    setDeleteConfirmText("");
  }

  function handleConfirmDelete() {
    if (!deletingId || deleteConfirmText !== "delete") return;
    deleteChecklist.mutate(deletingId, { onSuccess: closeDeleteDialog });
  }

  function handleSignOut() {
    signOut.mutate(undefined, {
      onSuccess: () => {
        setIsMenuOpen(false);
        router.push("/");
      },
    });
  }

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="relative flex h-auto min-h-screen w-full flex-col bg-surface-container-low">
      <div className="layout-container flex h-full grow flex-col">
        <header className="app-header">
          <AppHeader />
          <div className="flex items-center gap-md">
            <Link
              href="/checklists/new"
              className="btn-primary"
            >
              CREATE CHECKLIST
              <span className="material-symbols-outlined text-[18px]">add</span>
            </Link>
            <NotificationBell
              userId={user?.id}
              onNavigate={(n: AppNotification) => {
                if (!n.checklist_id) return;
                const suffix =
                  n.type === "watcher_new_species" && n.payload.watcher_run_id
                    ? `?watcher_run=${n.payload.watcher_run_id}`
                    : "";
                router.push(`/checklists/${n.checklist_id}${suffix}`);
              }}
            />
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setIsMenuOpen((open) => !open)}
                className="app-header-avatar"
              >
                <Avatar src={avatarUrl} iconClassName="text-slate-500 text-xl" />
              </button>
                {isMenuOpen && (
                  <div className="absolute right-0 mt-sm w-48 bg-white border border-outline-variant shadow-lg z-50">
                    <button
                      onClick={() => {
                        setIsMenuOpen(false);
                        router.push("/checklists");
                      }}
                      className="w-full text-left px-md py-sm font-code-md text-code-md text-on-surface hover:bg-surface-container-low transition-colors"
                    >
                      My Checklists
                    </button>
                    <button
                      onClick={handleSignOut}
                      disabled={signOut.isPending}
                      className="w-full text-left px-md py-sm font-code-md text-code-md text-primary hover:bg-surface-container-low transition-colors disabled:opacity-50"
                    >
                      Sign out
                    </button>
                  </div>
                )}
              </div>
            </div>
        </header>

        <main className="flex-1 flex flex-col py-10 px-lg md:px-xl w-full">
          <div className="w-full mb-lg">
            <h1 className="font-headline-md text-[34px] font-bold leading-tight tracking-tight uppercase text-on-surface mb-2">
              My Checklists
            </h1>
            <div className="mb-lg flex items-center gap-md overflow-x-auto pb-sm">
              <div className="flex bg-surface-container-low p-xs rounded-lg border border-outline-variant">
                <button
                  onClick={() => setActiveTab("all")}
                  className={`px-5 py-2 font-label-caps text-label-caps rounded-sm ${
                    activeTab === "all"
                      ? "bg-primary-container text-on-primary-container shadow-sm"
                      : "text-on-surface-variant hover:text-primary"
                  }`}
                >
                  ALL CHECKLISTS
                </button>
                <button
                  onClick={() => setActiveTab("shared")}
                  className={`px-5 py-2 font-label-caps text-label-caps rounded-sm ${
                    activeTab === "shared"
                      ? "bg-primary-container text-on-primary-container shadow-sm"
                      : "text-on-surface-variant hover:text-primary"
                  }`}
                >
                  SHARED WITH ME
                </button>
                <button
                  onClick={() => setActiveTab("watching")}
                  className={`px-5 py-2 font-label-caps text-label-caps rounded-sm ${
                    activeTab === "watching"
                      ? "bg-primary-container text-on-primary-container shadow-sm"
                      : "text-on-surface-variant hover:text-primary"
                  }`}
                >
                  WATCHING
                </button>
                <button
                  onClick={() => setActiveTab("published")}
                  className={`px-5 py-2 font-label-caps text-label-caps rounded-sm ${
                    activeTab === "published"
                      ? "bg-primary-container text-on-primary-container shadow-sm"
                      : "text-on-surface-variant hover:text-primary"
                  }`}
                >
                  PUBLISHED
                </button>
                <button
                  onClick={() => setActiveTab("archived")}
                  className={`px-5 py-2 font-label-caps text-label-caps rounded-sm ${
                    activeTab === "archived"
                      ? "bg-primary-container text-on-primary-container shadow-sm"
                      : "text-on-surface-variant hover:text-primary"
                  }`}
                >
                  ARCHIVED
                </button>
              </div>
              <div className="h-6 w-px bg-outline-variant" />
              <div className="relative flex-grow max-w-[28rem]">
                <span className="material-symbols-outlined absolute left-sm top-1/2 -translate-y-1/2 text-on-surface-variant text-[18px]">
                  search
                </span>
                <input
                  className="w-full bg-surface border border-outline rounded-sm pl-xl pr-md py-2.5 font-code-md text-code-md focus:ring-1 focus:ring-primary focus:border-primary outline-none"
                  placeholder="Search checklists..."
                  type="text"
                />
              </div>
            </div>
          </div>

          <div className="w-full">
            <div className="bg-surface border border-outline-variant overflow-hidden">
              <table className="w-full table-fixed text-left border-collapse">
                <thead className="bg-surface-container-low border-b border-outline-variant">
                  <tr className="font-label-caps text-label-caps text-on-surface-variant">
                    <th className="px-5 py-4 font-extrabold tracking-wider w-[25%]">CHECKLIST</th>
                    <th className="px-5 py-4 font-extrabold tracking-wider w-[12%]">STATUS</th>
                    <th className="px-5 py-4 font-extrabold tracking-wider w-[10%]">SPECIES COUNT</th>
                    <th className="px-5 py-4 font-extrabold tracking-wider w-[15%]">REGION</th>
                    <th className="px-5 py-4 font-extrabold tracking-wider w-[15%]">COLLABORATORS</th>
                    <th className="px-5 py-4 font-extrabold tracking-wider w-[15%]">LAST MODIFIED</th>
                    <th className="px-5 py-4 w-[8%]" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant font-code-md text-code-md">
                  {isLoading && (
                    <tr>
                      <td colSpan={7} className="px-6 py-10 text-center text-on-surface-variant">
                        Loading checklists...
                      </td>
                    </tr>
                  )}
                  {!isLoading && (visibleChecklists?.length ?? 0) === 0 && (
                    <tr>
                      <td colSpan={7} className="px-6 py-10 text-center text-on-surface-variant">
                        {activeTab === "shared"
                          ? "No checklists have been shared with you yet."
                          : activeTab === "watching"
                            ? "No checklists are being watched yet."
                            : activeTab === "published"
                              ? "No published checklists yet."
                              : activeTab === "archived"
                                ? "No archived checklists yet."
                                : "No checklists yet. Create your first one to get started."}
                      </td>
                    </tr>
                  )}
                  {visibleChecklists?.map((checklist) => (
                    <Fragment key={checklist.id}>
                      <tr
                        onClick={() => router.push(`/checklists/${checklist.id}`)}
                        className="group hover:bg-surface-container-low cursor-pointer hover:translate-x-[2px] transition-all transition-colors"
                      >
                        <td className="px-5 py-4">
                          <div className="flex flex-col gap-1">
                            <span className="font-headline-md text-[17px] md:text-[20px] traking-tight leading-tight text-on-surface font-bold">
                              {checklist.title}
                            </span>
                            <span className="font-code-md text-[12px] tracking-tight text-secondary">
                              {formatScope(checklist.taxonomic_scope)}
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-6">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span
                              className={`px-3 py-1 font-label-caps text-label-caps font-bold uppercase tracking-wider border border-2 ${STATUS_STYLES[checklist.status]}`}
                            >
                              {formatStatusLabel(checklist.status)}
                            </span>
                            {checklist.watcher?.is_active && (
                              <span className="px-2 py-1 font-label-caps text-[10px] font-bold uppercase tracking-wider border border-blue-200 bg-blue-50 text-blue-600">
                                Watcher
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-6">
                          <span className="font-code-md text-code-md text-on-surface font-bold">
                            {checklist.species_count.toLocaleString()}
                          </span>
                        </td>
                        <td className="px-6 py-6">
                          <span className="text-on-surface-variant font-code-md text-code-md">
                            {checklist.region_name ?? "—"}
                          </span>
                        </td>
                        <td className="px-6 py-6">
                          <CollaboratorAvatarStack
                            collaborators={[
                              ...(checklist.owner ? [checklist.owner] : []),
                              ...checklist.collaborators,
                            ]}
                            pendingInvites={checklist.pendingInvites}
                            onManage={() => setTeamChecklistId(checklist.id)}
                            showHoverPreview={false}
                          />
                        </td>
                        <td className="px-6 py-6">
                          <span className="font-code-md text-code-md text-on-surface-variant">
                            {formatRelativeTime(checklist.updated_at)}
                          </span>
                        </td>
                        <td className="px-4 py-4 text-right">
                          <button
                            title="Delete checklist"
                            className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 text-on-surface-variant hover:text-red-600 hover:bg-red-50 rounded-sm"
                            onClick={(e) => openDeleteDialog(e, checklist.id)}
                          >
                            <span className="material-symbols-outlined text-[18px]">delete</span>
                          </button>
                        </td>
                      </tr>
                      {checklist.status !== "published" && checklist.has_metadata && (
                        <MetadataSubRow checklistId={checklist.id} speciesCount={checklist.species_count} />
                      )}
                      {checklist.status !== "published" && checklist.publication_draft?.package_storage_path && (
                        <PackageSubRow
                          checklistId={checklist.id}
                          checklistTitle={checklist.title}
                          speciesCount={checklist.species_count}
                          storagePath={checklist.publication_draft.package_storage_path}
                          generatedAt={checklist.publication_draft.package_generated_at}
                        />
                      )}
                      {checklist.status === "reviewing" && checklist.ipt_submitted_at && (
                        <PublicationStatusSubRow
                          checklistId={checklist.id}
                          submittedAt={checklist.ipt_submitted_at}
                        />
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </main>

        {deletingId && (
          <div
            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/30"
            onClick={closeDeleteDialog}
          >
            <div
              className="w-[32rem]  max-w-[90vw] bg-white border border-surface-dim rounded-sm shadow-hard overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-surface-dim">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-red-600 text-[20px]">delete_forever</span>
                  <h3 className="mono-text text-sm font-bold uppercase tracking-wider text-slate-700">
                    Delete Checklist
                  </h3>
                </div>
                <button onClick={closeDeleteDialog} className="text-slate-400 hover:text-primary transition-colors">
                  <span className="material-symbols-outlined text-[20px]">close</span>
                </button>
              </div>

              {/* Body */}
              <div className="p-5 space-y-4">
                <div className="p-3 bg-red-50 border border-red-100">
                  <p className="mono-text text-sm font-bold text-slate-800 truncate">
                    {deletingChecklist?.title}
                  </p>
                  {deletingChecklist?.species_count != null && (
                    <p className="mono-text text-[11px] text-red-500 mt-0.5">
                      {deletingChecklist.species_count.toLocaleString()} species will be permanently removed
                    </p>
                  )}
                </div>

                <p className="text-sm text-slate-500">
                  This action is permanent and cannot be undone. All species, evidence, and taxonomy data will be deleted.
                </p>

                <div className="space-y-1.5">
                  <label
                    className="block text-[10px] font-bold uppercase tracking-wider text-slate-400"
                    htmlFor="delete-confirm-input"
                  >
                    Type{" "}
                    <span className="font-bold text-red-600 font-mono normal-case tracking-normal">
                      delete
                    </span>{" "}
                    to confirm
                  </label>
                  <input
                    id="delete-confirm-input"
                    autoFocus
                    className="w-full bg-white border border-surface-dim px-3 py-2 mono-text text-sm focus:outline-none focus:border-red-400 transition-colors"
                    placeholder="delete"
                    type="text"
                    value={deleteConfirmText}
                    onChange={(e) => setDeleteConfirmText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleConfirmDelete();
                      if (e.key === "Escape") closeDeleteDialog();
                    }}
                  />
                </div>
              </div>

              {/* Footer */}
              <div className="px-5 py-4 border-t border-surface-dim flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={closeDeleteDialog}
                  className="px-4 py-2 mono-text text-[11px] font-bold uppercase text-slate-500 hover:text-primary transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={deleteConfirmText !== "delete" || deleteChecklist.isPending}
                  onClick={handleConfirmDelete}
                  className="px-5 py-2 bg-red-600 text-white mono-text text-[11px] font-bold uppercase tracking-wider hover:bg-red-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {deleteChecklist.isPending ? "Deleting..." : "Delete Checklist"}
                </button>
              </div>
            </div>
          </div>
        )}

        <footer className="bg-surface-container-low border-t border-outline-variant py-xl mt-auto">
          <div className="w-full px-xl flex flex-col md:flex-row justify-between items-start md:items-center gap-xl">
            <div className="flex flex-col gap-sm">
              <span className="font-headline-md text-headline-md text-primary tracking-tight font-bold">
                Checklist Hub
              </span>
              <p className="font-body-sm text-secondary font-code-md text-xs">
                © 2026 Checklist Hub. All rights reserved. Built for architects of the natural
                world.
              </p>
            </div>
            <div className="flex gap-xl">
              <a
                className="text-secondary font-code-md text-code-md hover:text-primary transition-all underline underline-offset-4"
                href="#"
              >
                Privacy Policy
              </a>
              <a
                className="text-secondary font-code-md text-code-md hover:text-primary transition-all underline underline-offset-4"
                href="#"
              >
                Terms of Service
              </a>
              <a
                className="text-secondary font-code-md text-code-md hover:text-primary transition-all underline underline-offset-4"
                href="#"
              >
                Contact Us
              </a>
            </div>
          </div>
        </footer>
      </div>

      {teamChecklistId && (
        <TeamModal
          checklistId={teamChecklistId}
          collaborators={teamCollaborators ?? []}
          currentUserId={user?.id}
          canManageRoles={teamChecklist?.owner_id === user?.id}
          onClose={() => setTeamChecklistId(null)}
        />
      )}
    </div>
  );
}

/** Nested sub-row for a checklist's saved-but-unpublished metadata — opens the metadata step directly on click, with an inline delete (clears metadata/contributors and resets the draft pointer entirely). */
function MetadataSubRow({ checklistId, speciesCount }: { checklistId: string; speciesCount: number }) {
  const router = useRouter();
  const deleteMetadata = useDeleteChecklistMetadata(checklistId);
  const [confirming, setConfirming] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function handleDelete() {
    setDeleteError(null);
    deleteMetadata.mutate(undefined, {
      onError: (err) => setDeleteError(err instanceof Error ? err.message : "Failed to delete metadata."),
    });
  }

  return (
    <tr
      onClick={() => !confirming && router.push(`/checklists/${checklistId}/publish?step=metadata`)}
      className="bg-surface-container-low/40 hover:bg-surface-container-low cursor-pointer transition-colors"
    >
      <td colSpan={7} className="px-5 py-2">
        <div className="pl-10 flex items-center justify-between gap-3 border-t border-dashed border-outline-variant pt-2">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-[16px] text-secondary">description</span>
            <span className="font-code-md text-[11px] text-on-surface-variant">
              Checklist Metadata saved —{" "}
              <span className="font-bold text-on-surface">{speciesCount.toLocaleString()} species</span>
            </span>
          </div>
          {!confirming ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setConfirming(true);
              }}
              title="Delete metadata"
              className="p-1 text-on-surface-variant hover:text-red-600 hover:bg-red-50 rounded-sm transition-colors"
            >
              <span className="material-symbols-outlined text-[16px]">delete</span>
            </button>
          ) : (
            <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
              {deleteError && <span className="text-[10px] text-red-600 font-code-md">{deleteError}</span>}
              <span className="text-[10px] text-on-surface-variant font-code-md">Delete this metadata?</span>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleteMetadata.isPending}
                className="px-2 py-1 bg-red-600 text-white text-[10px] font-label-caps uppercase rounded-sm hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                {deleteMetadata.isPending ? "Deleting..." : "Confirm"}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="text-[10px] text-on-surface-variant hover:text-primary transition-colors"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

/** Nested sub-row for a checklist's generated DwC-A package — opens the package review page directly on click, with inline download and delete (delete only clears the package, reverting the draft to the metadata stage). */
function PackageSubRow({
  checklistId,
  checklistTitle,
  speciesCount,
  storagePath,
  generatedAt,
}: {
  checklistId: string;
  checklistTitle: string;
  speciesCount: number;
  storagePath: string;
  generatedAt: string | null;
}) {
  const router = useRouter();
  const clearPackage = useClearPublicationPackage(checklistId);
  const [confirming, setConfirming] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function handleDeletePackage() {
    setDeleteError(null);
    clearPackage.mutate(storagePath, {
      onError: (err) => setDeleteError(err instanceof Error ? err.message : "Failed to delete package."),
    });
  }

  async function handleDownload(e: React.MouseEvent) {
    e.stopPropagation();
    setDownloading(true);
    try {
      const blob = await downloadPublicationPackageBlob(storagePath);
      downloadBlob(`${checklistTitle}-dwca.zip`, blob);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <tr
      onClick={() => !confirming && router.push(`/checklists/${checklistId}/publish?step=review`)}
      className="bg-surface-container-low/40 hover:bg-surface-container-low cursor-pointer transition-colors"
    >
      <td colSpan={7} className="px-5 py-2">
        <div className="pl-10 flex items-center justify-between gap-3 border-t border-dashed border-outline-variant pt-2">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-[16px] text-secondary">archive</span>
            <span className="font-code-md text-[11px] text-on-surface-variant">
              Darwin Core Archive —{" "}
              <span className="font-bold text-on-surface">{speciesCount.toLocaleString()} species</span>
              {generatedAt && <> · Generated {formatRelativeTime(generatedAt)}</>}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleDownload}
              disabled={downloading}
              title="Download package"
              className="p-1 text-on-surface-variant hover:text-primary hover:bg-primary-container/10 rounded-sm transition-colors disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[16px]">download</span>
            </button>
            {!confirming ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirming(true);
                }}
                title="Delete package"
                className="p-1 text-on-surface-variant hover:text-red-600 hover:bg-red-50 rounded-sm transition-colors"
              >
                <span className="material-symbols-outlined text-[16px]">delete</span>
              </button>
            ) : (
              <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                {deleteError && <span className="text-[10px] text-red-600 font-code-md">{deleteError}</span>}
                <span className="text-[10px] text-on-surface-variant font-code-md">Delete this package?</span>
                <button
                  type="button"
                  onClick={handleDeletePackage}
                  disabled={clearPackage.isPending}
                  className="px-2 py-1 bg-red-600 text-white text-[10px] font-label-caps uppercase rounded-sm hover:bg-red-700 transition-colors disabled:opacity-50"
                >
                  {clearPackage.isPending ? "Deleting..." : "Confirm"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="text-[10px] text-on-surface-variant hover:text-primary transition-colors"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      </td>
    </tr>
  );
}

/** Nested sub-row shown once the user has marked a checklist's IPT-side submission done (see "Submitted for Review" in the Publish wizard) but hasn't yet pasted back the dataset URL — opens straight to the Register step so they can finish without re-walking the whole wizard. */
function PublicationStatusSubRow({ checklistId, submittedAt }: { checklistId: string; submittedAt: string }) {
  const router = useRouter();

  return (
    <tr
      onClick={() => router.push(`/checklists/${checklistId}/publish?step=ipt&iptStep=register`)}
      className="bg-surface-container-low/40 hover:bg-surface-container-low cursor-pointer transition-colors"
    >
      <td colSpan={7} className="px-5 py-2">
        <div className="pl-10 flex items-center justify-between gap-3 border-t border-dashed border-outline-variant pt-2">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-[16px] text-secondary">hourglass_top</span>
            <span className="font-code-md text-[11px] text-on-surface-variant">
              Submitted to IPT {formatRelativeTime(submittedAt)} — awaiting GBIF registration
            </span>
          </div>
          <span className="text-[10px] text-on-surface-variant font-code-md uppercase">Add dataset URL &rsaquo;</span>
        </div>
      </td>
    </tr>
  );
}
