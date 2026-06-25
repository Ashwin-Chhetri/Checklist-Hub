"use client";

import { useMemo } from "react";
import { useActivity, useRecentComments } from "@/modules/collaboration/hooks/useComments";
import type { ActivityLogEntry, RecentComment } from "@/types/collaboration.types";
import type { Species } from "@/types/species.types";
import { EVIDENCE_SOURCE_LABELS } from "@/modules/editor/utils/badges";

export type ActivityPanelMode = "recent_comments" | "recent_changes" | "history";

interface ActivityPanelProps {
  checklistId: string;
  mode: ActivityPanelMode;
  onClose: () => void;
  onSelectSpecies: (speciesId: string) => void;
  speciesById?: Map<string, Species>;
}

const TITLES: Record<ActivityPanelMode, string> = {
  recent_comments: "Recent Comments",
  recent_changes: "Recent Changes",
  history: "History Timeline",
};

const ACTION_ICONS: Record<string, string> = {
  review_status_changed: "fact_check",
  comment_added: "chat_bubble",
  taxonomy_vote: "gavel",
  species_added: "playlist_add",
  authority_conflict_resolved: "verified",
  species_merged: "call_merge",
  taxonomy_resolved: "task_alt",
  evidence_source_added: "add_circle",
  evidence_source_discarded: "block",
  evidence_source_restored: "restart_alt",
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

function describeEntry(entry: ActivityLogEntry): string {
  const scientificName = (entry.payload.scientific_name as string | undefined) ?? "Species";
  switch (entry.action) {
    case "review_status_changed":
      return `marked ${scientificName} as ${String(entry.payload.to ?? "").replace(/_/g, " ")}`;
    case "comment_added":
      return `commented on ${scientificName}`;
    case "taxonomy_vote":
      return `voted "${entry.payload.decision}" on a taxonomy conflict for ${scientificName}`;
    case "species_added":
      return `imported ${scientificName}`;
    case "authority_conflict_resolved":
      return entry.payload.resolved_by === "consensus"
        ? `reached consensus on the authority conflict for ${scientificName}`
        : `resolved the authority conflict for ${scientificName}`;
    case "species_merged":
      return `merged ${scientificName} into another species`;
    case "taxonomy_resolved":
      return `marked ${scientificName} as ${String(entry.payload.decision ?? "resolved")}`;
    case "evidence_source_added": {
      const source = EVIDENCE_SOURCE_LABELS[String(entry.payload.source)] ?? String(entry.payload.source);
      return `added ${source} as an evidence source for ${scientificName}`;
    }
    case "evidence_source_discarded": {
      const source = EVIDENCE_SOURCE_LABELS[String(entry.payload.source)] ?? String(entry.payload.source);
      return `discarded ${source} as a falsified source for ${scientificName}`;
    }
    case "evidence_source_restored": {
      const source = EVIDENCE_SOURCE_LABELS[String(entry.payload.source)] ?? String(entry.payload.source);
      return `restored ${source} as an evidence source for ${scientificName}`;
    }
    default:
      return `updated ${scientificName}`;
  }
}

function ActivityRow({ entry, onSelectSpecies }: { entry: ActivityLogEntry; onSelectSpecies: (id: string) => void }) {
  const icon = ACTION_ICONS[entry.action] ?? "update";
  const speciesId = typeof entry.payload.species_id === "string" ? entry.payload.species_id : entry.target_id;
  const description = describeEntry(entry);

  return (
    <button
      className="flex items-start gap-3 w-full text-left p-3 border border-surface-dim rounded-sm bg-white hover:border-brand transition-colors"
      onClick={() => speciesId && onSelectSpecies(speciesId)}
    >
      <span className="material-symbols-outlined text-[18px] text-brand mt-0.5">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-slate-700">
          <span className="font-bold text-slate-900">{entry.actor?.full_name ?? "Someone"}</span> {description}
        </p>
        <span className="text-[9px] mono-text uppercase text-slate-400">{formatRelativeTime(entry.created_at)}</span>
      </div>
    </button>
  );
}

function CommentRow({ comment, onSelectSpecies }: { comment: RecentComment; onSelectSpecies: (id: string) => void }) {
  return (
    <button
      className="flex items-start gap-3 w-full text-left p-3 border border-surface-dim rounded-sm bg-white hover:border-brand transition-colors"
      onClick={() => comment.species?.id && onSelectSpecies(comment.species.id)}
    >
      <span className="material-symbols-outlined text-[18px] text-brand mt-0.5">chat_bubble</span>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-slate-700">
          <span className="font-bold text-slate-900">{comment.author?.full_name ?? "Someone"}</span> on{" "}
          <span className="italic">{comment.species?.scientific_name}</span>
        </p>
        <p className="text-xs text-slate-500 truncate">{comment.body}</p>
        <span className="text-[9px] mono-text uppercase text-slate-400">{formatRelativeTime(comment.created_at)}</span>
      </div>
    </button>
  );
}

interface TaxonGroup {
  key: string;
  genus: string;
  breadcrumb: string;
  entries: ActivityLogEntry[];
}

function groupByTaxon(entries: ActivityLogEntry[], speciesById: Map<string, Species>): TaxonGroup[] {
  const groups = new Map<string, TaxonGroup>();
  for (const entry of entries) {
    const speciesId = typeof entry.payload.species_id === "string" ? entry.payload.species_id : entry.target_id;
    const sp = speciesId ? speciesById.get(speciesId) : undefined;
    const genus = sp?.genus ?? sp?.family ?? "Unclassified";
    const breadcrumb = [sp?.order, sp?.family].filter(Boolean).join(" / ");
    let group = groups.get(genus);
    if (!group) {
      group = { key: genus, genus, breadcrumb, entries: [] };
      groups.set(genus, group);
    }
    group.entries.push(entry);
  }
  return Array.from(groups.values()).sort((a, b) => a.genus.localeCompare(b.genus));
}

function HistoryGroupRow({ entry, onSelectSpecies }: { entry: ActivityLogEntry; onSelectSpecies: (id: string) => void }) {
  const speciesId = typeof entry.payload.species_id === "string" ? entry.payload.species_id : entry.target_id;
  return (
    <button
      className="relative w-full text-left flex items-start gap-2 pl-4 py-1.5 hover:bg-surface-container-low transition-colors"
      onClick={() => speciesId && onSelectSpecies(speciesId)}
    >
      <span className="absolute left-[3px] top-2.5 w-1.5 h-1.5 rounded-full bg-brand" />
      <span className="flex-1 min-w-0 flex items-baseline justify-between gap-2">
        <span className="text-[11px] text-slate-700 truncate">
          <span className="font-bold text-slate-900">{entry.actor?.full_name ?? "Someone"}</span> {describeEntry(entry)}
        </span>
        <span className="text-[9px] mono-text uppercase text-slate-400 shrink-0">{formatRelativeTime(entry.created_at)}</span>
      </span>
    </button>
  );
}

function HistoryTimeline({
  entries,
  speciesById,
  onSelectSpecies,
}: {
  entries: ActivityLogEntry[];
  speciesById: Map<string, Species>;
  onSelectSpecies: (id: string) => void;
}) {
  const groups = useMemo(() => groupByTaxon(entries, speciesById), [entries, speciesById]);

  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <div key={group.key}>
          <div className="flex items-baseline gap-1.5 px-1 mb-0.5">
            <span className="text-[11px] italic font-bold text-slate-900">{group.genus}</span>
            {group.breadcrumb && <span className="text-[9px] uppercase text-slate-400">{group.breadcrumb}</span>}
          </div>
          <div className="relative border-l border-surface-dim">
            {group.entries.map((entry) => (
              <HistoryGroupRow key={entry.id} entry={entry} onSelectSpecies={onSelectSpecies} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function ActivityPanel({
  checklistId,
  mode,
  onClose,
  onSelectSpecies,
  speciesById,
}: ActivityPanelProps) {
  const recentComments = useRecentComments(checklistId, 30, mode === "recent_comments");
  const activity = useActivity(checklistId, {
    actions:
      mode === "recent_changes"
        ? [
            "review_status_changed",
            "taxonomy_vote",
            "species_added",
            "authority_conflict_resolved",
            "species_merged",
            "taxonomy_resolved",
          ]
        : undefined,
    limit: 30,
    enabled: mode !== "recent_comments",
  });

  const isLoading = mode === "recent_comments" ? recentComments.isLoading : activity.isLoading;

  return (
    <aside className="bg-white border-l border-surface-dim flex flex-col fixed top-14 right-0 bottom-0 z-50 shadow-hard border-l-2 border-brand w-96">
      <div className="flex items-center justify-between border-b border-surface-dim bg-white px-4 h-10">
        <span className="mono-text text-[10px] font-bold uppercase tracking-wider text-slate-500">{TITLES[mode]}</span>
        <button
          aria-label="Close panel"
          className="flex h-8 w-8 items-center justify-center text-slate-400 hover:text-brand transition-colors"
          onClick={onClose}
        >
          <span className="material-symbols-outlined text-[20px]">close</span>
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {isLoading && <p className="text-xs text-slate-400">Loading...</p>}
        {mode === "recent_comments" &&
          !isLoading &&
          (recentComments.data?.length ?? 0) === 0 && (
            <p className="text-xs text-slate-400">No comments yet.</p>
          )}
        {mode === "recent_comments" &&
          recentComments.data?.map((comment) => (
            <CommentRow key={comment.id} comment={comment} onSelectSpecies={onSelectSpecies} />
          ))}
        {mode !== "recent_comments" && !isLoading && (activity.data?.length ?? 0) === 0 && (
          <p className="text-xs text-slate-400">No activity recorded yet.</p>
        )}
        {mode === "recent_changes" &&
          activity.data?.map((entry) => <ActivityRow key={entry.id} entry={entry} onSelectSpecies={onSelectSpecies} />)}
        {mode === "history" && (activity.data?.length ?? 0) > 0 && (
          <HistoryTimeline
            entries={activity.data ?? []}
            speciesById={speciesById ?? new Map()}
            onSelectSpecies={onSelectSpecies}
          />
        )}
      </div>
    </aside>
  );
}
