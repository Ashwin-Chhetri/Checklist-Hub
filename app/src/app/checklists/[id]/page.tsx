"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useChecklist, useChecklistCollaborators } from "@/modules/checklist/hooks/useChecklist";
import { useWorkbenchView, type WorkbenchViewId } from "@/modules/editor/hooks/useWorkbenchView";
import { useUpdateSpeciesStatus } from "@/modules/species/hooks/useUpdateSpeciesStatus";
import { useSpeciesList } from "@/modules/species/hooks/useSpecies";
import { useChecklistVotes } from "@/modules/species/hooks/useChecklistVotes";
import { useConflictVote } from "@/modules/species/hooks/useConflictVote";
import { useReviewVote } from "@/modules/species/hooks/useReviewVote";
import { useCurrentUser } from "@/modules/auth/hooks/useCurrentUser";
import { useProfile } from "@/modules/auth/hooks/useProfile";
import { useSignOut } from "@/modules/auth/hooks/useAuth";
import SpeciesRow from "@/components/workbench/SpeciesRow";
import SpeciesPanel from "@/components/workbench/SpeciesPanel";
import SettingsModal from "@/components/workbench/SettingsModal";
import AddSpeciesDialog from "@/components/workbench/AddSpeciesDialog";
import TeamModal from "@/components/workbench/TeamModal";
import WatcherSetupDialog, { WatcherResultsDialog } from "@/components/workbench/WatcherDialog";
import ActivityPanel, { type ActivityPanelMode } from "@/components/workbench/panels/ActivityPanel";
import { useWatcher, useWatcherRuns } from "@/modules/watching/hooks/useWatcher";
import AppHeader from "@/components/shared/AppHeader";
import Avatar from "@/components/shared/Avatar";
import CollaboratorAvatarStack from "@/components/shared/CollaboratorAvatarStack";
import NotificationBell from "@/components/shared/NotificationBell";
import { useChecklistRealtimeChannel } from "@/modules/collaboration/hooks/useChecklistRealtimeChannel";
import { usePresence } from "@/modules/collaboration/hooks/usePresence";
import {
  CHECKLIST_STATUS_STYLES,
  EVIDENCE_QUALITY_STYLES,
  REVIEW_STATUS_STYLES,
  TAXONOMY_STATUS_STYLES,
} from "@/modules/editor/utils/badges";
import type { EvidenceQuality, ReviewStatus, TaxonomyStatus } from "@/types/species.types";
import type { Checklist } from "@/types/checklist.types";
import type { AppNotification, CollaboratorRole } from "@/types/collaboration.types";

function fullRegionAddress(checklist: Checklist): string {
  const parts = [checklist.region_name, checklist.region_district, checklist.region_state, checklist.region_country]
    .filter((part): part is string => Boolean(part && part.trim()));
  // The region picker always sets region_name to the same value as region_district,
  // so drop the adjacent duplicate rather than showing "Darjeeling, Darjeeling, ...".
  return parts.filter((part, i) => i === 0 || part !== parts[i - 1]).join(", ");
}

const VIEWS: { id: WorkbenchViewId; label: string; icon: string }[] = [
  { id: "all", label: "All Species", icon: "grid_view" },
  { id: "needs_review", label: "Needs Review", icon: "assignment" },
  { id: "accepted", label: "Accepted", icon: "check_circle" },
  { id: "rejected", label: "Rejected", icon: "cancel" },
];

const TAXONOMY_VIEWS: { id: WorkbenchViewId; label: string; icon: string }[] = [
  { id: "synonyms", label: "Synonyms", icon: "link" },
  { id: "authority_conflicts", label: "Conflicts", icon: "warning" },
  { id: "unresolved", label: "Unresolved", icon: "help" },
  { id: "merged", label: "Merged / Hidden", icon: "merge" },
];

const DISCUSSION_NOTIFICATION_TYPES = new Set(["mention", "comment_reply", "comment_added"]);

const EVIDENCE_QUALITY_OPTIONS: EvidenceQuality[] = ["high", "medium", "low", "insufficient"];
const TAXONOMY_STATUS_OPTIONS: TaxonomyStatus[] = ["accepted", "synonym", "authority_conflict", "unresolved"];
const REVIEW_STATUS_OPTIONS: ReviewStatus[] = ["not_reviewed", "under_review", "reviewed", "accepted", "rejected"];
const EVIDENCE_RANK: Record<EvidenceQuality, number> = { insufficient: 0, low: 1, medium: 2, high: 3 };

// Which filter sections are meaningful for each view mode.
// Views that already fix a dimension (e.g. "synonyms" always shows taxonomy=synonym)
// hide that filter section to avoid redundancy and confusion.
const VIEW_FILTER_SECTIONS: Record<WorkbenchViewId, { evidence: boolean; taxonomy: boolean; review: boolean }> = {
  all:                 { evidence: true,  taxonomy: true,  review: true  },
  needs_review:        { evidence: true,  taxonomy: true,  review: false },
  synonyms:            { evidence: true,  taxonomy: false, review: true  },
  authority_conflicts: { evidence: true,  taxonomy: false, review: true  },
  unresolved:          { evidence: true,  taxonomy: false, review: true  },
  accepted:            { evidence: true,  taxonomy: true,  review: false },
  rejected:            { evidence: true,  taxonomy: true,  review: false },
  merged:              { evidence: true,  taxonomy: true,  review: true  },
};

type SortKey = "name" | "year" | "occurrence" | "evidence";
interface SortOption {
  key: SortKey;
  dir: "asc" | "desc";
  label: string;
}
const SORT_OPTIONS: SortOption[] = [
  { key: "name", dir: "asc", label: "Scientific Name (A-Z)" },
  { key: "name", dir: "desc", label: "Scientific Name (Z-A)" },
  { key: "year", dir: "desc", label: "First Record (Newest)" },
  { key: "year", dir: "asc", label: "First Record (Oldest)" },
  { key: "occurrence", dir: "desc", label: "Occurrence Count (High-Low)" },
  { key: "evidence", dir: "desc", label: "Evidence Quality (High-Low)" },
];

interface Filters {
  families: Set<string>;
  evidenceQuality: Set<EvidenceQuality>;
  taxonomyStatus: Set<TaxonomyStatus>;
  reviewStatus: Set<ReviewStatus>;
}

function emptyFilters(): Filters {
  return { families: new Set(), evidenceQuality: new Set(), taxonomyStatus: new Set(), reviewStatus: new Set() };
}

// Tabs shown in the Filter dialog — "sectionKey" maps to VIEW_FILTER_SECTIONS to
// hide tabs that aren't meaningful for the active view. Family has no sectionKey
// since it's always shown.
const FILTER_CATEGORIES: { id: keyof Filters; label: string; sectionKey?: "evidence" | "taxonomy" | "review" }[] = [
  { id: "families", label: "Family" },
  { id: "evidenceQuality", label: "Evidence", sectionKey: "evidence" },
  { id: "taxonomyStatus", label: "Taxonomy", sectionKey: "taxonomy" },
  { id: "reviewStatus", label: "Review", sectionKey: "review" },
];

export default function WorkbenchPage() {
  const params = useParams<{ id: string }>();
  const checklistId = params.id;

  const { data: checklist, error: checklistError } = useChecklist(checklistId);
  const { data: collaborators } = useChecklistCollaborators(checklistId);
  const { data: ownerProfile } = useProfile(checklist?.owner_id);
  const {
    species,
    counts,
    relatedRowsByCanonical,
    isLoading,
    activeView,
    setActiveView,
  } = useWorkbenchView(checklistId);

  // Full unfiltered list (useWorkbenchView's `species` is already activeView-filtered)
  // — used for Add Species dedup against everything in the checklist, not just the
  // currently visible view.
  const { data: allSpecies } = useSpeciesList(checklistId);
  const speciesById = useMemo(() => new Map((allSpecies ?? []).map((s) => [s.id, s])), [allSpecies]);
  const updateStatus = useUpdateSpeciesStatus(checklistId);
  const { data: votes } = useChecklistVotes(checklistId);
  const castConflictVote = useConflictVote(checklistId);
  const castReviewVote = useReviewVote(checklistId);

  const collaboratorCount = (collaborators?.length ?? 0) + 1; // owner + collaborators

  const router = useRouter();
  const { data: user } = useCurrentUser();
  const { data: profile } = useProfile(user?.id);
  const currentUserRole: CollaboratorRole | null = !user
    ? null
    : checklist?.owner_id === user.id
      ? "owner"
      : collaborators?.find((c) => c.user_id === user.id)?.role ?? null;
  const signOut = useSignOut();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const sortRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLDivElement>(null);
  const avatarUrl = profile?.avatar_url ?? user?.user_metadata?.avatar_url ?? user?.user_metadata?.picture;

  // Stable per checklist visit — excludes activeSpeciesId so opening rows doesn't
  // resubscribe the realtime channel.
  const currentUserPresence = useMemo(
    () =>
      user
        ? { user_id: user.id, name: profile?.full_name ?? user.email ?? "Anonymous", avatar_url: avatarUrl ?? undefined }
        : null,
    [user, profile?.full_name, avatarUrl]
  );
  const speciesIds = useMemo(() => new Set(species.map((s) => s.id)), [species]);
  useChecklistRealtimeChannel(checklistId, currentUserPresence, speciesIds);
  const participants = usePresence();

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (menuRef.current && !menuRef.current.contains(target)) {
        setIsMenuOpen(false);
      }
      if (sortRef.current && !sortRef.current.contains(target)) {
        setSortOpen(false);
      }
      if (filterRef.current && !filterRef.current.contains(target)) {
        setFilterOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function handleSignOut() {
    signOut.mutate(undefined, {
      onSuccess: () => {
        setIsMenuOpen(false);
        router.push("/");
      },
    });
  }

  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());
  const [activeSpeciesId, setActiveSpeciesId] = useState<string | null>(null);

  // Deep link from elsewhere (e.g. the publish validation report's issue
  // lists): /checklists/[id]?species=<id> opens that species' panel directly.
  // Switches to the "all" view first since the linked-to species may not be
  // part of whichever view happens to be active by default.
  const searchParams = useSearchParams();
  useEffect(() => {
    const speciesParam = searchParams.get("species");
    if (speciesParam) {
      setActiveView("all");
      setActiveSpeciesId(speciesParam);
    }
    // Intentionally run only once on mount — this is a one-time deep-link
    // handoff, not a live binding to the URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [panelTabRequest, setPanelTabRequest] = useState<{ speciesId: string; tab: "discussion" } | null>(null);
  const [activityMode, setActivityMode] = useState<ActivityPanelMode | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [addSpeciesOpen, setAddSpeciesOpen] = useState(false);
  const [teamOpen, setTeamOpen] = useState(false);
  const [watcherSetupOpen, setWatcherSetupOpen] = useState(false);
  const [watcherResultsRunId, setWatcherResultsRunId] = useState<string | null>(null);
  const [watcherInfoOpen, setWatcherInfoOpen] = useState(false);

  // Deep link from the watcher alert email/notification:
  // /checklists/[id]?watcher_run=<id> opens that run's results dialog directly.
  useEffect(() => {
    const watcherRunParam = searchParams.get("watcher_run");
    if (watcherRunParam) setWatcherResultsRunId(watcherRunParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { data: watcherData } = useWatcher(checklistId);
  const { data: watcherRuns } = useWatcherRuns(checklistId);

  const [filterCategory, setFilterCategory] = useState<keyof Filters>("families");
  const [searchFocused, setSearchFocused] = useState(false);
  const [filtersByView, setFiltersByView] = useState<Partial<Record<WorkbenchViewId, Filters>>>({});
  const filters = filtersByView[activeView] ?? emptyFilters();
  const [sort, setSort] = useState<SortOption>(SORT_OPTIONS[0]);

  const deferredSearch = useDeferredValue(search);

  const availableFilterCategories = useMemo(
    () => FILTER_CATEGORIES.filter((c) => !c.sectionKey || VIEW_FILTER_SECTIONS[activeView][c.sectionKey]),
    [activeView]
  );
  const effectiveFilterCategory = availableFilterCategories.some((c) => c.id === filterCategory)
    ? filterCategory
    : availableFilterCategories[0].id;

  const familyCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of species) {
      const family = s.family ?? "Unclassified";
      map.set(family, (map.get(family) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [species]);

  // Pre-computed lowercase search haystack per species, built once per species list
  // change rather than on every keystroke — this is what kept typing smooth.
  const searchIndex = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of species) {
      const related = relatedRowsByCanonical.get(s.id) ?? [];
      const gbifName = s.taxonomy?.current_name ?? s.taxonomy?.gbif_name;
      const parts = [
        s.scientific_name,
        s.common_name ?? "",
        s.identity?.imported_common_name ?? "",
        gbifName ?? "",
        s.gbif_taxon_key ? String(s.gbif_taxon_key) : "",
        ...(s.taxonomy?.synonyms?.map((syn) => syn.name) ?? []),
        ...related.map((r) => r.scientific_name),
        ...related.map((r) => r.common_name ?? ""),
      ];
      map.set(s.id, parts.join("   ").toLowerCase());
    }
    return map;
  }, [species, relatedRowsByCanonical]);

  // Species after family/evidence/taxonomy/review filters but before the search
  // text and sort are applied — also doubles as the pool for search suggestions.
  const filteredSpecies = useMemo(() => {
    let list = species; // already deduplicated (non-canonicals removed) by useWorkbenchView

    if (filters.families.size > 0) {
      list = list.filter((s) => filters.families.has(s.family ?? "Unclassified"));
    }
    if (filters.evidenceQuality.size > 0) {
      list = list.filter((s) => filters.evidenceQuality.has(s.evidence_quality));
    }
    if (filters.taxonomyStatus.size > 0) {
      list = list.filter((s) => filters.taxonomyStatus.has(s.taxonomy_status));
    }
    if (filters.reviewStatus.size > 0) {
      list = list.filter((s) => filters.reviewStatus.has(s.review_status));
    }
    return list;
  }, [species, filters]);

  const searchSuggestions = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    if (!q) return [];
    const matches = filteredSpecies.filter((s) => (searchIndex.get(s.id) ?? "").includes(q));
    return matches.slice(0, 8);
  }, [filteredSpecies, searchIndex, deferredSearch]);

  const visibleSpecies = useMemo(() => {
    let list = filteredSpecies;

    const q = deferredSearch.trim().toLowerCase();
    if (q) {
      list = list.filter((s) => (searchIndex.get(s.id) ?? "").includes(q));
    }

    const sorted = [...list].sort((a, b) => {
      let cmp = 0;
      switch (sort.key) {
        case "name":
          cmp = a.scientific_name.localeCompare(b.scientific_name);
          break;
        case "year":
          cmp = (a.first_record_year ?? 0) - (b.first_record_year ?? 0);
          break;
        case "occurrence":
          cmp = (a.evidence?.occurrence_count ?? 0) - (b.evidence?.occurrence_count ?? 0);
          break;
        case "evidence":
          cmp = EVIDENCE_RANK[a.evidence_quality] - EVIDENCE_RANK[b.evidence_quality];
          break;
      }
      return sort.dir === "asc" ? cmp : -cmp;
    });

    // Float pinned rows to the top, preserving their relative sort order.
    const pinned = sorted.filter((s) => pinnedIds.has(s.id));
    const unpinned = sorted.filter((s) => !pinnedIds.has(s.id));
    return [...pinned, ...unpinned];
  }, [filteredSpecies, deferredSearch, searchIndex, sort, pinnedIds]);

  const activeFilterCount =
    filters.families.size + filters.evidenceQuality.size + filters.taxonomyStatus.size + filters.reviewStatus.size;

  const activeTags = useMemo(() => {
    const tags: { key: string; label: string; onRemove: () => void }[] = [];
    if (sort.key !== SORT_OPTIONS[0].key || sort.dir !== SORT_OPTIONS[0].dir) {
      tags.push({ key: "sort", label: sort.label, onRemove: () => setSort(SORT_OPTIONS[0]) });
    }
    filters.families.forEach((f) =>
      tags.push({ key: `family-${f}`, label: f, onRemove: () => toggleFilter("families", f) })
    );
    filters.evidenceQuality.forEach((v) =>
      tags.push({
        key: `evidence-${v}`,
        label: EVIDENCE_QUALITY_STYLES[v].label,
        onRemove: () => toggleFilter("evidenceQuality", v),
      })
    );
    filters.taxonomyStatus.forEach((v) =>
      tags.push({
        key: `taxonomy-${v}`,
        label: TAXONOMY_STATUS_STYLES[v].label,
        onRemove: () => toggleFilter("taxonomyStatus", v),
      })
    );
    filters.reviewStatus.forEach((v) =>
      tags.push({
        key: `review-${v}`,
        label: REVIEW_STATUS_STYLES[v].label,
        onRemove: () => toggleFilter("reviewStatus", v),
      })
    );
    return tags;
  }, [sort, filters]);

  function toggleSelect(speciesId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(speciesId)) next.delete(speciesId);
      else next.add(speciesId);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds((prev) => {
      const allSelected = visibleSpecies.length > 0 && visibleSpecies.every((s) => prev.has(s.id));
      if (allSelected) return new Set();
      return new Set(visibleSpecies.map((s) => s.id));
    });
  }

  function togglePin(speciesId: string) {
    setPinnedIds((prev) => {
      const next = new Set(prev);
      if (next.has(speciesId)) next.delete(speciesId);
      else next.add(speciesId);
      return next;
    });
  }

  function toggleFilter<K extends keyof Filters>(category: K, value: Filters[K] extends Set<infer V> ? V : never) {
    setFiltersByView((prev) => {
      const current = prev[activeView] ?? emptyFilters();
      const next = { ...current, [category]: new Set(current[category]) } as Filters;
      const set = next[category] as Set<typeof value>;
      if (set.has(value)) set.delete(value);
      else set.add(value);
      return { ...prev, [activeView]: next };
    });
  }

  // Bulk accept/reject skip rows with an open conflict or outdated-name
  // decision pending (those have an actionable resolution via the taxonomy
  // column's own UPDATE action) — but NOT "unresolved" rows, since that
  // status just means the backend found no match to resolve against; ever
  // blocking those from review would leave them permanently stuck.
  // selectedIds is already constrained to the current view's visible/filtered
  // rows (see toggleSelect/toggleSelectAll above), so this is the only extra
  // filter bulk actions need.
  function resolvableSelectedIds(): string[] {
    return [...selectedIds].filter((id) => {
      const status = speciesById.get(id)?.taxonomy_status;
      return status === "accepted" || status === "unresolved";
    });
  }

  function handleBulkAccept() {
    resolvableSelectedIds().forEach((id) => updateStatus.mutate({ speciesId: id, reviewStatus: "accepted" }));
    setSelectedIds(new Set());
  }

  function handleBulkReject() {
    resolvableSelectedIds().forEach((id) => updateStatus.mutate({ speciesId: id, reviewStatus: "rejected" }));
    setSelectedIds(new Set());
  }

  function openActivity(mode: ActivityPanelMode) {
    setActiveSpeciesId(null);
    setActivityMode(mode);
  }

  function handleSelectFromActivity(speciesId: string) {
    setActivityMode(null);
    setActiveSpeciesId(speciesId);
  }

  function handleNotificationNavigate(notification: AppNotification) {
    if (notification.checklist_id && notification.checklist_id !== checklistId) {
      router.push(`/checklists/${notification.checklist_id}`);
      return;
    }
    if (notification.species_id) {
      setActivityMode(null);
      setActiveSpeciesId(notification.species_id);
      if (DISCUSSION_NOTIFICATION_TYPES.has(notification.type)) {
        setPanelTabRequest({ speciesId: notification.species_id, tab: "discussion" });
      }
    }
  }

  const activeSpecies = species.find((s) => s.id === activeSpeciesId) ?? null;
  const allVisibleSelected = visibleSpecies.length > 0 && visibleSpecies.every((s) => selectedIds.has(s.id));
  const selectedBlockedCount = [...selectedIds].filter((id) => {
    const status = speciesById.get(id)?.taxonomy_status;
    return status === "authority_conflict" || status === "synonym";
  }).length;
  // accepted + rejected are mutually exclusive subsets of counts.all, so this is
  // exactly "every species has been reviewed" with no extra aggregation needed.
  const allReviewed = counts.all > 0 && counts.accepted + counts.rejected === counts.all;

  // Row virtualization: bounds mounted SpeciesRow instances to roughly the viewport
  // regardless of how many species are in the checklist. Uses the native-<table>
  // "padding row" technique (two spacer <tr>s instead of absolute positioning) so
  // SpeciesRow's existing <td> markup/layout needs no changes.
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: visibleSpecies.length,
    getScrollElement: () => tableScrollRef.current,
    estimateSize: () => 140,
    overscan: 8,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  const paddingTop = virtualRows.length > 0 ? virtualRows[0].start : 0;
  const paddingBottom =
    virtualRows.length > 0 ? rowVirtualizer.getTotalSize() - virtualRows[virtualRows.length - 1].end : 0;

  if (checklistError) {
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-3 text-center px-6">
        <span className="material-symbols-outlined text-[40px] text-red-400">lock</span>
        <p className="font-code-md text-sm font-bold text-on-surface uppercase tracking-tight">
          You don&apos;t have access to this checklist
        </p>
        <p className="text-on-surface-variant text-sm">
          It may have been removed, or you may not have been added as a collaborator yet. Contact
          the checklist owner if you believe this is a mistake.
        </p>
        <Link href="/checklists" className="btn-primary h-[36px] mt-2">
          Back to My Checklists
        </Link>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Top Navigation */}
      <header className="app-header">
        <div className="flex items-center gap-6">
          <AppHeader />
          <Link
            href="/checklists"
            className="btn-primary h-[36px]"
          >
            All Checklists
          </Link>
          <div className="flex items-center gap-3 ml-2">
            <div className="flex items-center px-2 py-1">
              <span className="font-code-md text-sm font-bold text-on-surface uppercase tracking-tight">
                {checklist?.title ?? "Loading..."}
              </span>
            </div>
            {checklist && fullRegionAddress(checklist) && (
              <div className="flex items-center gap-0.5 text-on-surface-variant">
              
                <span className="material-symbols-outlined scale-75">location_on</span>
                
                <span className="text-[10px] uppercase tracking-wider leading-none">
                {checklist.region_name}

                {checklist.region_gadm_id && (
                  <span
                      className="
                        inline-flex items-center
                        px-1.5 py-0.5
                        ml-1 mr-1
                        rounded-sm
                        bg-gray-200
                        text-black
                        text-[9px]
                        font-mono
                        leading-none
                      "
                    >
                      {checklist.region_gadm_id}
                    </span>
                )}

                {checklist.region_state && `, ${checklist.region_state}`}
                {checklist.region_country && `, ${checklist.region_country}`}
              </span>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-4">
          <button className="btn-primary" onClick={() => setAddSpeciesOpen(true)}>
            <span className="material-symbols-outlined text-[11px]">add</span> Add Species
          </button>
          {allReviewed && (
            <Link
              href={`/checklists/${checklistId}/publish`}
              className="btn-primary"
            >
              <span className="material-symbols-outlined text-[11px] leading-none">publish</span>
              Publish
            </Link>
          )}
          {checklist && (
            <div className="mr-2">
              <CollaboratorAvatarStack
                collaborators={[
                  ...(checklist.owner_id
                    ? [{ id: checklist.owner_id, full_name: ownerProfile?.full_name, avatar_url: ownerProfile?.avatar_url }]
                    : []),
                  ...(collaborators ?? []).map((c) => ({
                    id: c.user_id,
                    full_name: c.profile?.full_name,
                    avatar_url: c.profile?.avatar_url,
                  })),
                ]}
                onlineUserIds={new Set(Object.keys(participants))}
                onManage={() => setTeamOpen(true)}
              />
            </div>
          )}
          <NotificationBell userId={user?.id} onNavigate={handleNotificationNavigate} />
          <button
            onClick={() => setTeamOpen(true)}
            className="text-on-surface-variant hover:text-primary transition-colors w-8 h-8 flex items-center justify-center"
            title="Team"
          >
            <span className="material-symbols-outlined text-[20px]">group</span>
          </button>
          <button
            onClick={() => setSettingsOpen(true)}
            className="text-on-surface-variant hover:text-primary transition-colors w-8 h-8 flex items-center justify-center"
            title="Settings"
          >
            <span className="material-symbols-outlined text-[20px]">settings</span>
          </button>
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

      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* Left Navigation Sidebar */}
        <aside className="workbench-sidebar">

          <div className="workbench-sidebar-content">

            {/* VIEWS */}

            <section>

              <h3 className="workbench-sidebar-section-title">
                Views
              </h3>

              <div className="space-y-1">

                {VIEWS.map((view) => (

                  <button
                    key={view.id}
                    onClick={() => setActiveView(view.id)}
                    className={`workbench-sidebar-item ${activeView === view.id
                      ? "workbench-sidebar-item-active"
                      : ""
                      }`}
                  >

                    <div className="workbench-sidebar-item-left">

                      <span className="material-symbols-outlined workbench-sidebar-icon">

                        {view.icon}

                      </span>

                      <span>

                        {view.label}

                      </span>

                    </div>

                    <span
                      className={
                        view.id === "needs_review"
                          ? "workbench-sidebar-count-alert"
                          : "workbench-sidebar-count"
                      }
                    >

                      {counts[view.id]}

                    </span>

                  </button>

                ))}

              </div>

            </section>



            {/* TAXONOMY */}

            <section>

              <h3 className="workbench-sidebar-section-title">

                Taxonomy Issues

              </h3>

              <div className="space-y-1">

                {TAXONOMY_VIEWS.map((view) => (

                  <button
                    key={view.id}
                    onClick={() => setActiveView(view.id)}
                    className={`workbench-sidebar-item ${activeView === view.id
                      ? "workbench-sidebar-item-active"
                      : ""
                      }`}
                  >

                    <div className="workbench-sidebar-item-left">

                      <span className="material-symbols-outlined workbench-sidebar-icon">

                        {view.icon}

                      </span>

                      <span>

                        {view.label}

                      </span>

                    </div>

                    <span className="workbench-sidebar-count">

                      {counts[view.id]}

                    </span>

                  </button>

                ))}

              </div>

            </section>





            {/* ACTIVITY */}

            <section>

              <h3 className="workbench-sidebar-section-title">

                Activity

              </h3>

              <div className="space-y-1">

                <button
                  onClick={() => openActivity("recent_changes")}
                  className={`workbench-sidebar-item ${activityMode === "recent_changes"
                    ? "workbench-sidebar-item-active"
                    : ""
                    }`}
                >

                  <div className="workbench-sidebar-item-left">

                    <span className="material-symbols-outlined workbench-sidebar-icon">

                      update

                    </span>

                    <span>

                      Recent Changes

                    </span>

                  </div>

                </button>


                <button
                  onClick={() => openActivity("recent_comments")}
                  className={`workbench-sidebar-item ${activityMode === "recent_comments"
                    ? "workbench-sidebar-item-active"
                    : ""
                    }`}
                >
                  <div className="workbench-sidebar-item-left">
                    <span className="material-symbols-outlined workbench-sidebar-icon">
                      forum
                    </span>
                    <span>
                      Recent Comments
                    </span>
                  </div>
                </button>
                <button
                  onClick={() => openActivity("history")}
                  className={`workbench-sidebar-item ${activityMode === "history"
                    ? "workbench-sidebar-item-active"
                    : ""
                    }`}
                >
                  <div className="workbench-sidebar-item-left">
                    <span className="material-symbols-outlined workbench-sidebar-icon">
                      history
                    </span>
                    <span>
                      History Timeline
                    </span>
                  </div>
                </button>
              </div>
            </section>

            {/* STATUS */}

            <section>
              <h3 className="workbench-sidebar-section-title">Status</h3>

              <div className="flex flex-col gap-3 px-2">
                {checklist && (
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2 text-xs text-slate-600">
                      <span className="material-symbols-outlined workbench-sidebar-icon">flag</span>
                      <span>Checklist Status</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                      <span className={`status-pill text-[10px] w-fit ${CHECKLIST_STATUS_STYLES[checklist.status].pillClass}`}>
                        {CHECKLIST_STATUS_STYLES[checklist.status].label}
                      </span>
                      {watcherData?.watcher?.is_active && (
                        <span className="status-pill text-[10px] w-fit bg-blue-50 text-blue-600 border border-blue-200">
                          Watcher
                        </span>
                      )}
                    </div>
                  </div>
                )}

                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-1.5 text-xs text-slate-600">
                    <span className="material-symbols-outlined workbench-sidebar-icon">visibility</span>
                    <span>Watching</span>
                    <button
                      onClick={() => setWatcherInfoOpen(true)}
                      title="What does watching do?"
                      className="w-3.5 h-3.5 flex items-center justify-center rounded-full border border-slate-300 text-slate-400 text-[9px] font-bold leading-none hover:border-brand hover:text-brand transition-colors"
                    >
                      ?
                    </button>
                  </div>
                  {watcherData?.watcher?.is_active && (
                    <span className="status-pill text-[10px] w-fit bg-blue-50 text-blue-600 border border-blue-200">
                      {watcherData.watcher.frequency === "weekly" ? "Weekly" : "Monthly"}
                    </span>
                  )}
                  <button
                    onClick={() => setWatcherSetupOpen(true)}
                    className="w-fit bg-primary-container text-white px-2.5 py-1 rounded-sm text-[10px] font-code-md font-bold uppercase tracking-wide transition-transform"
                    style={{ boxShadow: "3px 3px 0 rgba(164, 31, 36, 1)" }}
                  >
                    {watcherData?.watcher?.is_active ? "Manage" : "Watcher"}
                  </button>
                </div>
              </div>
            </section>
          </div>
        </aside>

        {/* Main Content Area — flex row: table section + inline detail panel */}
        <main className="flex flex-1 min-w-0 overflow-hidden">
          {/* Table section */}
          <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
          {/* Table Filters & Actions */}
          <div className="border-b border-outline-variant bg-surface-container-low/50">
            <div className="px-3 py-2 flex flex-wrap items-center gap-2">
              <div className="relative">
                <span className="material-symbols-outlined absolute left-1.5 top-1/2 -translate-y-1/2  scale-75 text-slate-400 leading-none">
                  search
                </span>
                <input
                  className="search-input-sm"
                  placeholder="Search species..."
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onFocus={() => setSearchFocused(true)}
                  onBlur={() => setTimeout(() => setSearchFocused(false), 150)}
                />
                {searchFocused && searchSuggestions.length > 0 && (
                  <div className="absolute left-0 top-full mt-1 z-20 w-72 bg-white border border-outline-variant rounded-sm shadow-hard max-h-72 overflow-y-auto">
                    {searchSuggestions.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setSearch(s.scientific_name);
                          setSearchFocused(false);
                          setActivityMode(null);
                          setActiveSpeciesId(s.id);
                        }}
                        className="w-full text-left px-3 py-2 hover:bg-surface-container-low transition-colors border-b border-outline-variant/40 last:border-b-0"
                      >
                        <div className="text-xs font-code-md italic text-on-surface">{s.scientific_name}</div>
                        {s.common_name && (
                          <div className="text-[10px] text-on-surface-variant">{s.common_name}</div>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Sort */}
              <div className="relative" ref={sortRef}>
                <button
                  onClick={() => {
                    setSortOpen((v) => !v);
                    setFilterOpen(false);
                  }}
                  className="h-[28px] flex items-center gap-1 px-2 border border-outline-variant bg-white rounded-sm text-[10px] font-code-md font-bold uppercase hover:bg-surface-container-low"
                >
                  Sort <span className="material-symbols-outlined text-[14px]">expand_more</span>
                </button>
                {sortOpen && (
                  <div className="absolute left-0 top-full mt-1 z-20 w-64 bg-white border border-outline-variant rounded-sm shadow-hard p-3">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-on-surface-variant mb-2 px-1">Sort By</h4>
                    <div className="space-y-0.5">
                      {SORT_OPTIONS.map((opt) => (
                        <label
                          key={`${opt.key}-${opt.dir}`}
                          className="flex items-center gap-2 px-1 py-1.5 text-xs text-on-surface rounded-sm hover:bg-surface-container-low cursor-pointer"
                        >
                          <input
                            type="radio"
                            name="sort-option"
                            checked={sort.key === opt.key && sort.dir === opt.dir}
                            onChange={() => {
                              setSort(opt);
                              setSortOpen(false);
                            }}
                            className="w-3.5 h-3.5 border-outline-variant text-primary focus:ring-primary"
                          />
                          {opt.label}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Filter */}
              <div className="relative" ref={filterRef}>
                <button
                  onClick={() => {
                    setFilterOpen((v) => !v);
                    setSortOpen(false);
                  }}
                  className="h-[28px] flex items-center gap-1 px-2 border border-outline-variant bg-white rounded-sm text-[10px] font-code-md font-bold uppercase hover:bg-surface-container-low"
                >
                  <span className="material-symbols-outlined scale-95">filter_list</span> Filter
                  {activeFilterCount > 0 && (
                    <span className="bg-primary-container text-white rounded-full w-4 h-4 flex items-center justify-center text-[9px]">
                      {activeFilterCount}
                    </span>
                  )}
                </button>
                {filterOpen && (
                  <div className="absolute left-0 top-full mt-1 z-20 w-72 bg-white border border-outline-variant rounded-sm shadow-hard p-3">
                    <div className="flex gap-1 mb-3 border-b border-outline-variant pb-2">
                      {availableFilterCategories.map((cat) => (
                        <button
                          key={cat.id}
                          onClick={() => setFilterCategory(cat.id)}
                          className={`px-2 py-1 rounded-sm text-[10px] font-code-md font-bold uppercase transition-colors ${
                            effectiveFilterCategory === cat.id
                              ? "bg-primary-container text-white"
                              : "bg-surface-container-low text-on-surface-variant hover:bg-surface-container"
                          }`}
                        >
                          {cat.label}
                        </button>
                      ))}
                    </div>

                    {effectiveFilterCategory === "families" && (
                      <div className="max-h-64 overflow-y-auto space-y-0.5 pr-1">
                        {familyCounts.map(([family, count]) => (
                          <label
                            key={family}
                            className="flex items-center justify-between gap-2 px-1 py-1 text-xs text-on-surface rounded-sm hover:bg-surface-container-low cursor-pointer"
                          >
                            <span className="flex items-center gap-2 truncate">
                              <input
                                type="checkbox"
                                checked={filters.families.has(family)}
                                onChange={() => toggleFilter("families", family)}
                                className="w-3.5 h-3.5 rounded-sm border-outline-variant text-primary focus:ring-primary"
                              />
                              <span className="truncate">{family}</span>
                            </span>
                            <span className="text-[10px] text-on-surface-variant font-code-md">{count}</span>
                          </label>
                        ))}
                      </div>
                    )}
                    {effectiveFilterCategory === "evidenceQuality" && (
                      <div className="max-h-64 overflow-y-auto space-y-0.5">
                        {EVIDENCE_QUALITY_OPTIONS.map((opt) => (
                          <label key={opt} className="flex items-center gap-2 px-1 py-1 text-xs text-on-surface rounded-sm hover:bg-surface-container-low cursor-pointer">
                            <input
                              type="checkbox"
                              checked={filters.evidenceQuality.has(opt)}
                              onChange={() => toggleFilter("evidenceQuality", opt)}
                              className="w-3.5 h-3.5 rounded-sm border-outline-variant text-primary focus:ring-primary"
                            />
                            {EVIDENCE_QUALITY_STYLES[opt].label}
                          </label>
                        ))}
                      </div>
                    )}
                    {effectiveFilterCategory === "taxonomyStatus" && (
                      <div className="max-h-64 overflow-y-auto space-y-0.5">
                        {TAXONOMY_STATUS_OPTIONS.map((opt) => (
                          <label key={opt} className="flex items-center gap-2 px-1 py-1 text-xs text-on-surface rounded-sm hover:bg-surface-container-low cursor-pointer">
                            <input
                              type="checkbox"
                              checked={filters.taxonomyStatus.has(opt)}
                              onChange={() => toggleFilter("taxonomyStatus", opt)}
                              className="w-3.5 h-3.5 rounded-sm border-outline-variant text-primary focus:ring-primary"
                            />
                            {TAXONOMY_STATUS_STYLES[opt].label}
                          </label>
                        ))}
                      </div>
                    )}
                    {effectiveFilterCategory === "reviewStatus" && (
                      <div className="max-h-64 overflow-y-auto space-y-0.5">
                        {REVIEW_STATUS_OPTIONS.map((opt) => (
                          <label key={opt} className="flex items-center gap-2 px-1 py-1 text-xs text-on-surface rounded-sm hover:bg-surface-container-low cursor-pointer">
                            <input
                              type="checkbox"
                              checked={filters.reviewStatus.has(opt)}
                              onChange={() => toggleFilter("reviewStatus", opt)}
                              className="w-3.5 h-3.5 rounded-sm border-outline-variant text-primary focus:ring-primary"
                            />
                            {REVIEW_STATUS_STYLES[opt].label}
                          </label>
                        ))}
                      </div>
                    )}
                    {activeFilterCount > 0 && (
                      <button
                        onClick={() => setFiltersByView((prev) => ({ ...prev, [activeView]: emptyFilters() }))}
                        className="mt-3 text-xs font-code-md font-bold uppercase text-primary hover:underline"
                      >
                        Clear filters
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Active sort/filter tags — own row so adding/removing a tag never reflows the controls above */}
            {activeTags.length > 0 && (
              <div className="px-3 pb-2 flex flex-wrap items-center gap-1.5">
                {activeTags.map((tag) => (
                  <span
                    key={tag.key}
                    className="status-pill inline-flex items-center gap-1 px-2.5 py-1 border border-outline-variant bg-white text-on-surface-variant"
                  >
                    {tag.label}
                    <button
                      type="button"
                      onClick={tag.onRemove}
                      aria-label={`Remove ${tag.label}`}
                      className="leading-none hover:text-primary"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Bulk selection actions */}
          {selectedIds.size > 0 && (
            <div className="px-3 py-1.5 border-b border-outline-variant flex items-center gap-1.5 bg-surface-container-low/30">
              <span className="font-code-md text-[10px] font-bold text-on-surface-variant uppercase">
                {selectedIds.size} selected
              </span>
              {selectedBlockedCount > 0 && (
                <span className="font-code-md text-[10px] text-amber-600" title="These rows have an open taxonomy conflict or outdated-name decision pending and will be skipped.">
                  ({selectedBlockedCount} skipped — taxonomy conflict/outdated name)
                </span>
              )}
              <button
                onClick={handleBulkAccept}
                className="status-pill px-2.5 py-1 border border-green-200 bg-green-50 text-green-700 hover:bg-green-100"
              >
                Accept all
              </button>
              <button
                onClick={handleBulkReject}
                className="status-pill px-2.5 py-1 border border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
              >
                Reject all
              </button>
            </div>
          )}

          {/* High Density Data Table */}
          <div className="flex-1 overflow-auto bg-white" ref={tableScrollRef}>
            <table className="w-full text-left border-collapse border-b border-outline-variant">
              <thead className="workbench-table-header">
                <tr className="mono-text text-[10px] font-medium text-on-surface-variant/70 uppercase tracking-widest">
                  <th className="w-8 pl-2 pr-0 py-3 text-center">
                    <input
                      className="w-4 h-4 rounded-sm border-outline-variant text-primary focus:ring-primary"
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleSelectAll}
                    />
                  </th>
                  <th className="px-3 py-3 border-r border-outline-variant w-[22%]">Species</th>
                  <th className="px-3 py-3 border-r border-outline-variant w-[23%]">Evidence</th>
                  <th className="px-3 py-3 border-r border-outline-variant w-[30%]">Taxonomy Resolution</th>
                  <th className="px-3 py-3 w-[25%]">Review Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant">
                {isLoading && (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-on-surface-variant text-sm">
                      Loading species...
                    </td>
                  </tr>
                )}
                {!isLoading && visibleSpecies.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-on-surface-variant text-sm">
                      No species in this view.
                    </td>
                  </tr>
                )}
                {!isLoading && visibleSpecies.length > 0 && (
                  <>
                    {paddingTop > 0 && (
                      <tr aria-hidden style={{ height: paddingTop }}>
                        <td colSpan={5} style={{ padding: 0, border: "none" }} />
                      </tr>
                    )}
                    {virtualRows.map((virtualRow) => {
                      const s = visibleSpecies[virtualRow.index];
                      return (
                        <SpeciesRow
                          key={s.id}
                          ref={(node) => rowVirtualizer.measureElement(node)}
                          rowIndex={virtualRow.index}
                          species={s}
                          checklistId={checklistId}
                          selected={selectedIds.has(s.id)}
                          isActive={activeSpeciesId === s.id}
                          isPinned={pinnedIds.has(s.id)}
                          relatedRows={relatedRowsByCanonical.get(s.id) ?? []}
                          currentUserId={user?.id}
                          currentUserAvatar={avatarUrl ?? null}
                          collaboratorCount={collaboratorCount}
                          conflictVotes={votes?.conflictsBySpecies.get(s.id)}
                          reviewVoteData={votes?.reviewsBySpecies.get(s.id)}
                          synonymVoteData={votes?.synonymsBySpecies.get(s.id)}
                          onToggleSelect={toggleSelect}
                          onSelect={(id) => {
                            setActivityMode(null);
                            setActiveSpeciesId(id);
                          }}
                          onOpenDiscussion={(id) => {
                            setActivityMode(null);
                            setActiveSpeciesId(id);
                            setPanelTabRequest({ speciesId: id, tab: "discussion" });
                          }}
                          onTogglePin={togglePin}
                          onConflictAgree={(authority, suggestedName) =>
                            castConflictVote.mutate({ speciesId: s.id, authority, suggested_name: suggestedName })
                          }
                          onReviewVote={(decision) =>
                            castReviewVote.mutate({ speciesId: s.id, decision })
                          }
                          onSynonymVote={(decision) =>
                            castReviewVote.mutate({ speciesId: s.id, decision })
                          }
                        />
                      );
                    })}
                    {paddingBottom > 0 && (
                      <tr aria-hidden style={{ height: paddingBottom }}>
                        <td colSpan={5} style={{ padding: 0, border: "none" }} />
                      </tr>
                    )}
                  </>
                )}
              </tbody>
            </table>
          </div>
          </div>{/* end table section */}

          {/* Detail panel — always visible, fixed right column */}
          <SpeciesPanel
            species={activeSpecies}
            checklistId={checklistId}
            region={{
              gadmId: checklist?.region_gadm_id ?? null,
              name: checklist?.region_name ?? null,
              country: checklist?.region_country ?? null,
              state: checklist?.region_state ?? null,
              district: checklist?.region_district ?? null,
              osmType: checklist?.region_osm_type ?? null,
              osmId: checklist?.region_osm_id ?? null,
            }}
            collaborators={collaborators ?? []}
            speciesList={species}
            panelTabRequest={panelTabRequest}
            onClose={() => setActiveSpeciesId(null)}
            onSelectSpecies={(id) => setActiveSpeciesId(id)}
          />
        </main>
      </div>

      {activityMode && (
        <ActivityPanel
          checklistId={checklistId}
          mode={activityMode}
          onClose={() => setActivityMode(null)}
          onSelectSpecies={handleSelectFromActivity}
          speciesById={speciesById}
        />
      )}

      {settingsOpen && checklist && (
        <SettingsModal checklist={checklist} checklistId={checklistId} onClose={() => setSettingsOpen(false)} />
      )}

      {addSpeciesOpen && checklist && (
        <AddSpeciesDialog
          checklist={checklist}
          existingSpecies={allSpecies ?? []}
          onClose={() => setAddSpeciesOpen(false)}
        />
      )}

      {teamOpen && (
        <TeamModal
          checklistId={checklistId}
          collaborators={collaborators ?? []}
          currentUserId={user?.id}
          canManageRoles={currentUserRole === "owner"}
          onClose={() => setTeamOpen(false)}
        />
      )}

      {watcherSetupOpen && checklist && (
        <WatcherSetupDialog
          checklistId={checklistId}
          checklistCreatedAt={checklist.created_at}
          watcher={watcherData?.watcher ?? null}
          subscriberIds={watcherData?.subscribers ?? []}
          collaborators={collaborators ?? []}
          currentUserId={user?.id}
          currentUserName={profile?.full_name ?? user?.email}
          watcherRuns={watcherRuns ?? []}
          onSelectRun={(runId) => {
            setWatcherSetupOpen(false);
            setWatcherResultsRunId(runId);
          }}
          onClose={() => setWatcherSetupOpen(false)}
        />
      )}

      {watcherInfoOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30"
          onClick={() => setWatcherInfoOpen(false)}
        >
          <div
            className="bg-white border border-surface-dim rounded-sm shadow-hard w-[24rem] max-w-[90vw] p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-2">
              <h3 className="mono-text text-xs font-bold uppercase tracking-wider text-slate-700">
                What does watching do?
              </h3>
              <button onClick={() => setWatcherInfoOpen(false)} className="text-slate-400 hover:text-brand">
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Turning on the watcher puts this checklist in a watching state: on a weekly or monthly schedule,
              new occurrences are fetched from GBIF and iNaturalist (and eBird, when this checklist is scoped
              to Aves). If a genuinely new candidate species or new observations on an existing species are
              found, the collaborators you choose are alerted by email and an in-app notification.
            </p>
          </div>
        </div>
      )}

      {watcherResultsRunId && (
        <WatcherResultsDialog
          checklistId={checklistId}
          runId={watcherResultsRunId}
          onClose={() => setWatcherResultsRunId(null)}
        />
      )}
    </div>
  );
}
