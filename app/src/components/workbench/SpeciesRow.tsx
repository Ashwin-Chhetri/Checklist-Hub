"use client";

import { forwardRef, useState } from "react";
import type { Species } from "@/types/species.types";
import type { ConflictCardVotes, ReviewVoteData, SynonymVoteData, VoterProfile } from "@/modules/species/hooks/useChecklistVotes";
import {
  EVIDENCE_QUALITY_STYLES,
  EVIDENCE_SOURCE_LABELS,
  REVIEW_STATUS_STYLES,
} from "@/modules/editor/utils/badges";
import { computeEvidenceQuality } from "@/modules/editor/utils/evidenceScore";
import { useResolveTaxonomy } from "@/modules/taxonomy/hooks/useResolveTaxonomy";
import { useResolveConflict } from "@/modules/taxonomy/hooks/useResolveConflict";
import { sortConflictsGbifFirst } from "@/modules/taxonomy/utils/sortConflicts";

interface SpeciesRowProps {
  species: Species;
  checklistId: string;
  selected: boolean;
  isActive: boolean;
  isPinned: boolean;
  relatedRows?: Species[];
  currentUserId?: string;
  currentUserAvatar?: string | null;
  collaboratorCount?: number;
  conflictVotes?: ConflictCardVotes[];
  reviewVoteData?: ReviewVoteData;
  synonymVoteData?: SynonymVoteData;
  /** Index within the virtualized row list — used by the row virtualizer to measure this row. */
  rowIndex?: number;
  onToggleSelect: (speciesId: string) => void;
  onSelect: (speciesId: string) => void;
  onOpenDiscussion: (speciesId: string) => void;
  onTogglePin: (speciesId: string) => void;
  onConflictAgree?: (authority: string, suggestedName: string) => void;
  onReviewVote?: (decision: "accept" | "reject") => void;
  onSynonymVote?: (decision: "agree" | "disagree") => void;
}

/** Deep link to view this evidence source's own page for the species, when one is known. */
function sourceHref(
  source: { source: string; source_link?: string },
  gbifTaxonKey: number | null,
): string | null {
  if (source.source_link) return source.source_link;
  if (source.source === "gbif" && gbifTaxonKey) return `https://www.gbif.org/species/${gbifTaxonKey}`;
  return null;
}

/** Prepends the current user's profile to a server-confirmed voter list when
 * their choice is locally selected but the vote hasn't round-tripped through
 * the server yet — so the avatar shows up the instant they click, not after
 * the cast-vote -> invalidate -> refetch chain lands. */
function withLocalVoter(
  voters: VoterProfile[],
  included: boolean,
  currentUserId: string | undefined,
  currentUserAvatar: string | null | undefined,
): VoterProfile[] {
  if (!included || !currentUserId) return voters;
  if (voters.some((v) => v.user_id === currentUserId)) return voters;
  return [{ user_id: currentUserId, full_name: null, avatar_url: currentUserAvatar ?? null }, ...voters];
}

// Small overlapping voter avatar stack shown beside AGREE buttons.
function VoterAvatars({ voters }: { voters: VoterProfile[] }) {
  const shown = voters.slice(0, 3);
  const extra = voters.length - shown.length;
  return (
    <div className="flex items-center -space-x-1 shrink-0">
      {shown.map((v) =>
        v.avatar_url ? (
          <img
            key={v.user_id}
            src={v.avatar_url}
            alt={v.full_name ?? ""}
            className="w-4 h-4 rounded-full border border-white object-cover"
          />
        ) : (
          <div
            key={v.user_id}
            className="w-4 h-4 rounded-full border border-white bg-brand text-white flex items-center justify-center"
          >
            <span className="text-[7px] font-bold leading-none">
              {(v.full_name ?? "?").charAt(0).toUpperCase()}
            </span>
          </div>
        ),
      )}
      {extra > 0 && (
        <div className="w-4 h-4 rounded-full border border-white bg-slate-200 text-slate-600 flex items-center justify-center">
          <span className="text-[7px] font-bold">+{extra}</span>
        </div>
      )}
    </div>
  );
}

function rowClassName(species: Species, isActive: boolean, isPinned: boolean): string {
  if (isPinned && !isActive) return "bg-brand/[0.03] border-l-2 border-l-brand/40";
  if (isActive) return "bg-brand/5 border-l-2 border-l-brand";
  if (species.is_active === false) {
    return "bg-slate-50/50 opacity-50 hover:bg-slate-100 border-l-2 border-l-transparent hover:border-l-slate-400";
  }
  if (species.review_status === "rejected") {
    return "bg-slate-50/50 opacity-60 hover:bg-slate-100 border-l-2 border-l-transparent hover:border-l-slate-400";
  }
  if (species.taxonomy_status === "authority_conflict") {
    return "hover:bg-amber-50/50 border-l-2 border-l-transparent hover:border-l-amber-500";
  }
  if (species.taxonomy_status === "synonym") {
    return "hover:bg-brand/[0.02] border-l-2 border-l-transparent";
  }
  if (species.taxonomy_status === "unresolved") {
    return "hover:bg-slate-50/50 border-l-2 border-l-transparent hover:border-l-slate-400";
  }
  if (species.review_status === "accepted") {
    return "bg-green-50/50 hover:bg-green-50 border-l-2 border-l-transparent hover:border-l-green-600";
  }
  return "hover:bg-brand/[0.02] border-l-2 border-l-transparent hover:border-l-brand";
}

const SpeciesRow = forwardRef<HTMLTableRowElement, SpeciesRowProps>(function SpeciesRow({
  species,
  checklistId,
  selected,
  isActive,
  isPinned,
  relatedRows = [],
  currentUserId,
  currentUserAvatar,
  collaboratorCount = 1,
  conflictVotes = [],
  reviewVoteData,
  synonymVoteData,
  rowIndex,
  onToggleSelect,
  onSelect,
  onOpenDiscussion,
  onTogglePin,
  onConflictAgree,
  onReviewVote,
  onSynonymVote,
}, ref) {
  const resolveTaxonomy = useResolveTaxonomy(checklistId, species.id);
  const resolveConflict = useResolveConflict(checklistId, species.id);
  // Key of the currently-selected conflict option card (`${authority}::${suggested_name}`).
  // Single click selects/replaces; double-click on the selected card deselects.
  const [selectedConflictKey, setSelectedConflictKey] = useState<string | null>(null);
  // Inline expanders for the "Accepted / Taxonomy Clean" block's Synonyms and
  // Taxonomic Status rows.
  const [synonymsExpanded, setSynonymsExpanded] = useState(false);
  const [statusExpanded, setStatusExpanded] = useState(false);
  const reviewStyle = REVIEW_STATUS_STYLES[species.review_status];
  // Merge evidence sources from related rows (e.g. eBird + GBIF when deduplicated into one row).
  const sources = [
    ...(species.evidence?.sources ?? []),
    ...relatedRows.flatMap((r) => r.evidence?.sources ?? []),
  ].filter((s, i, arr) => arr.findIndex((x) => x.source === s.source) === i);
  const evidenceQuality = computeEvidenceQuality({ ...species.evidence, sources }, species.class);
  const evidenceStyle = EVIDENCE_QUALITY_STYLES[evidenceQuality];
  // Synonym rows may have occurrence_count = 0 because the aggregator only counted
  // accepted records — actual counts live in evidence.revisions[].occurrenceCounts.
  // Fall back to summing those so existing synonym rows show real observation data.
  const rawOccurrenceCount = species.evidence?.occurrence_count ?? 0;
  const occurrenceCount =
    rawOccurrenceCount > 0
      ? rawOccurrenceCount
      : (species.evidence?.revisions ?? []).reduce((sum, r) => {
          return sum + Object.values(r.occurrenceCounts ?? {}).reduce<number>((s, n) => s + (n ?? 0), 0);
        }, 0);
  const publicationCount = species.evidence?.publication_count ?? 0;
  const synonyms = species.taxonomy?.synonyms ?? [];
  // GBIF-sourced suggestion first, any other-source (e.g. within-batch
  // common-name heuristic) suggestion second — GBIF backbone is the sole
  // source of truth for taxonomy here, so its option leads.
  const authorityConflicts = sortConflictsGbifFirst(species.taxonomy?.authority_conflicts ?? []);
  const gbifConflictOption = authorityConflicts.find((c) => c.authority.startsWith("GBIF"));
  const historyCount = species.history?.length ?? 0;
  const commonName = species.common_name ?? species.identity?.imported_common_name ?? null;
  // A user "disagree" on a synonym/outdated-name resolution means "keep the
  // imported name" — resolve_species_taxonomy deliberately never rewrites
  // scientific_name, so without this check the Species column would keep
  // showing the GBIF-suggested current name regardless of that decision.
  const disagreedWithRename = species.taxonomy?.name_resolution?.decision === "disagree";
  const gbifCurrentName = disagreedWithRename
    ? null
    : species.taxonomy?.current_name ?? species.taxonomy?.gbif_name ?? null;
  const acceptedName = disagreedWithRename
    ? null
    : species.taxonomy?.accepted_name ?? gbifCurrentName;
  const latestSynonym = synonyms[synonyms.length - 1];
  // For an authority-conflict row whose own identity is still unresolved
  // (current_name empty pending review), prefer showing the GBIF-sourced
  // suggestion in the Species column over the row's own (possibly
  // non-GBIF-sourced, e.g. eBird) imported name.
  const displayedSpeciesName = gbifCurrentName ?? gbifConflictOption?.suggested_name ?? species.scientific_name;

  // Authority/year/family are captured once at ingestion (buildSpeciesPayload.server.ts)
  // and stored on species.taxonomy — no live backbone re-lookup needed on render.
  // species.taxonomy.authorship/name_published_in_year always describe the row's
  // resolved CURRENT/accepted name, whatever its taxonomy_status.
  // The authority-conflict "keep current" card shows the species' OWN
  // (current/imported) name specifically — must never fall back to a
  // different option's (e.g. the GBIF conflict suggestion's) data, or the
  // "keep current" card would silently show that other option's hierarchy.
  const ownLiveAuthority = species.taxonomy?.authorship ?? null;
  const ownLiveYear = species.taxonomy?.name_published_in_year ?? null;

  // Falls back to the displayed GBIF conflict option's own data when the
  // row's own identity is unresolved, so this metadata always matches
  // whatever name is actually shown in the Species column above (which, in
  // that case, IS the GBIF option's name, not the row's own).
  const displayedLiveAuthority = ownLiveAuthority ?? gbifConflictOption?.authorship ?? null;
  const displayedLiveYear = ownLiveYear ?? gbifConflictOption?.year ?? null;
  const displayedLiveFamily =
    species.taxonomy?.classification?.family ??
    species.family ??
    gbifConflictOption?.classification?.family ??
    null;

  // Authority/year for the synonym's accepted name, shown in the OUTDATED NAME block —
  // same stored fields, since the accepted name IS the row's current/resolved name.
  // `latestSynonym.authority` is only real taxonomic authorship for event_type
  // "synonym" — for "source_synonym" (flagged from an evidence provider like
  // eBird/iNat) it's intentionally just the provenance source label (e.g.
  // "GBIF"), which would otherwise render here looking like an authorship string.
  const latestSynonymAuthority =
    latestSynonym && latestSynonym.event_type !== "source_synonym" ? latestSynonym.authority ?? null : null;
  const acceptedLiveAuthority = displayedLiveAuthority ?? latestSynonymAuthority;
  const acceptedLiveYear = displayedLiveYear ?? latestSynonym?.year ?? null;
  // A row's taxonomy must be settled (no open conflict or outdated-name
  // decision pending) before it can be voted accept/reject for publication —
  // otherwise a reviewer could accept a row whose identity is still in flux.
  // "unresolved" is deliberately exempt: that status means the backend
  // couldn't match the name to anything (no option to resolve it against),
  // not that the user has a pending decision to make — blocking review there
  // would leave those rows permanently stuck.
  const isTaxonomyResolved = species.taxonomy_status === "accepted" || species.taxonomy_status === "unresolved";

  // Review vote state. Local selection mirrors the synonym block below — the
  // accept/reject buttons should reflect the click immediately, not only once
  // the cast-vote round trip resolves.
  const [selectedReviewDecision, setSelectedReviewDecision] = useState<"accept" | "reject" | null>(null);
  const currentUserAccepted = reviewVoteData?.accept_voters.some((v) => v.user_id === currentUserId);
  const currentUserRejected = reviewVoteData?.reject_voters.some((v) => v.user_id === currentUserId);
  const reviewDecision =
    selectedReviewDecision ?? (currentUserAccepted ? "accept" : currentUserRejected ? "reject" : null);
  const acceptVoters = withLocalVoter(
    reviewVoteData?.accept_voters ?? [],
    reviewDecision === "accept",
    currentUserId,
    currentUserAvatar,
  );
  const rejectVoters = withLocalVoter(
    reviewVoteData?.reject_voters ?? [],
    reviewDecision === "reject",
    currentUserId,
    currentUserAvatar,
  );

  // Synonym vote state
  const currentUserSynAgreed = synonymVoteData?.agree_voters.some((v) => v.user_id === currentUserId);
  const currentUserSynDisagreed = synonymVoteData?.disagree_voters.some((v) => v.user_id === currentUserId);
  // Local selection — drives the UPDATE button immediately on click rather than
  // waiting on the vote round trip (cast vote -> invalidate -> refetch) to land,
  // which is what made AGREE/UPDATE look unresponsive. Falls back to the
  // server-confirmed vote once it arrives, so a reload still reflects the
  // user's prior choice.
  const [selectedSynonymDecision, setSelectedSynonymDecision] = useState<"agree" | "disagree" | null>(null);
  const synonymDecision =
    selectedSynonymDecision ?? (currentUserSynAgreed ? "agree" : currentUserSynDisagreed ? "disagree" : null);
  const synAgreeVoters = withLocalVoter(
    synonymVoteData?.agree_voters ?? [],
    synonymDecision === "agree",
    currentUserId,
    currentUserAvatar,
  );
  const synDisagreeVoters = withLocalVoter(
    synonymVoteData?.disagree_voters ?? [],
    synonymDecision === "disagree",
    currentUserId,
    currentUserAvatar,
  );

  return (
    <tr
      ref={ref}
      data-index={rowIndex}
      className={`transition-colors group cursor-pointer h-px ${rowClassName(species, isActive, isPinned)}`}
      onClick={() => onSelect(species.id)}
    >
      {/* Checkbox + pin */}
      <td className="w-8 pl-1 pr-0 py-2.5 text-center align-top" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-col items-center gap-1.5">
          <input
            className="rounded-sm border-surface-dim text-brand focus:ring-brand"
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelect(species.id)}
          />
          <button
            title={isPinned ? "Unpin row" : "Pin row to top"}
            className={`transition-colors ${isPinned ? "text-brand" : "text-slate-300 hover:text-brand"}`}
            onClick={() => onTogglePin(species.id)}
          >
            <span className="material-symbols-outlined text-[15px]">push_pin</span>
          </button>
        </div>
      </td>

      {/* Species name */}
      <td className="px-3 py-2.5 border-r border-surface-dim align-top w-44 h-[inherit]">
        <div className="flex flex-col h-full gap-1">
          {isPinned && (
            <span className="mono-text text-[8px] text-brand font-bold uppercase tracking-widest">PINNED</span>
          )}
          <span
            className={`mono-text text-sm font-bold italic leading-tight ${
              species.taxonomy_status === "unresolved"
                ? "text-slate-400"
                : "text-on-surface"
            }`}
          >
            {displayedSpeciesName}
            {(() => {
              const storedAuthority = species.identity?.scientific_name_authorship
                ? String(species.identity.scientific_name_authorship)
                : null;
              // Falls back to the displayed GBIF conflict option's own authority/year
              // when the row's own identity is unresolved (so the name and its
              // authority/year shown together are always for the same option).
              const authorityText = ownLiveAuthority ?? gbifConflictOption?.authorship ?? storedAuthority;
              const yearOf = ownLiveYear ?? gbifConflictOption?.year ?? null;
              const yearText = yearOf ? String(yearOf) : null;
              const combined = [authorityText, yearText].filter(Boolean).join(", ");
              if (!combined) return null;
              const parenthesized = combined.startsWith("(") ? combined : `(${combined})`;
              return (
                <span className="not-italic font-normal text-on-surface-variant/70 text-[11px]"> {parenthesized}</span>
              );
            })()}
          </span>
          {displayedSpeciesName !== species.scientific_name && (
            <span className="mono-text text-[9px] text-slate-400 leading-tight">
              Imported as: <span className="italic">{species.scientific_name}</span>
            </span>
          )}
          <span className="text-xs text-slate-500 font-medium">
            {commonName ?? <span className="text-on-surface-variant/40 not-italic font-normal">—</span>}
          </span>
          <div className="flex flex-col gap-0.5 text-[10px] mono-text text-slate-400 mt-0.5">
            {species.gbif_taxon_key && (
              <div className="flex items-center gap-1">
                <span>Taxon ID:</span>
                <a
                  className="text-brand hover:underline"
                  href={`https://www.gbif.org/species/${species.gbif_taxon_key}`}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                >
                  {species.gbif_taxon_key}
                </a>
              </div>
            )}
            {(species.taxonomy_status === "authority_conflict" || species.taxonomy_status === "synonym") &&
              displayedLiveYear && (
                <div className="flex items-center gap-1">
                  <span>Year:</span>
                  <span className="text-slate-600">{displayedLiveYear}</span>
                </div>
              )}
            {(species.family ?? displayedLiveFamily) && (
              <div className="flex items-center gap-1">
                <span>Family:</span>
                <span className="text-slate-600">{species.family ?? displayedLiveFamily}</span>
              </div>
            )}
            {species.first_record_year && (
              <div className="flex items-center gap-1">
                <span>First Record:</span>
                <span className="text-slate-600">{species.first_record_year}</span>
              </div>
            )}
          </div>
        </div>
      </td>

      {/* Evidence */}
      <td className="px-3 py-2.5 border-r border-surface-dim align-top h-[inherit]">
        <div className="flex flex-col justify-between h-full gap-2.5">
          <div className="flex flex-col gap-2.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`status-pill ${evidenceStyle.pillClass} font-bold mono-text text-[9px]`}>
              {evidenceStyle.label}
            </span>
            <span className={`material-symbols-outlined text-[14px] ${evidenceStyle.iconClass}`}>
              {evidenceStyle.icon}
            </span>
          </div>

          {/* For conflict rows, show one evidence container per scientific name */}
          {species.taxonomy_status === "authority_conflict" && relatedRows.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              {[species, ...relatedRows].map((row, i) => {
                const rowSources = row.evidence?.sources ?? [];
                const rawRowCount = row.evidence?.occurrence_count ?? 0;
                const rowCount =
                  rawRowCount > 0
                    ? rawRowCount
                    : (row.evidence?.revisions ?? []).reduce((sum, r) => {
                        return sum + Object.values(r.occurrenceCounts ?? {}).reduce<number>((s, n) => s + (n ?? 0), 0);
                      }, 0);
                return (
                  <div key={row.id} className="p-1.5 border border-surface-dim rounded-sm bg-surface-container-low/50 mono-text">
                    <p className={`text-[9px] italic font-bold truncate mb-1 ${i === 0 ? "text-slate-500" : "text-slate-400"}`}>
                      {row.scientific_name}
                    </p>
                    <div className="flex flex-wrap gap-1 mb-1">
                      {rowSources.map((src) => {
                        const href = sourceHref(src, row.gbif_taxon_key);
                        const label = EVIDENCE_SOURCE_LABELS[src.source] ?? src.source;
                        return href ? (
                          <a
                            key={src.source}
                            href={href}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-[8px] px-1 py-0.5 border border-surface-dim rounded-sm bg-white text-brand hover:underline"
                          >
                            {label}
                          </a>
                        ) : (
                          <span key={src.source} className="text-[8px] px-1 py-0.5 border border-surface-dim rounded-sm bg-white text-slate-500">
                            {label}
                          </span>
                        );
                      })}
                    </div>
                    <span className="text-[9px] text-slate-500">
                      {rowCount.toLocaleString()} obs
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <>
              {sources.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {sources.map((source) => {
                    const href = sourceHref(source, species.gbif_taxon_key);
                    const label = EVIDENCE_SOURCE_LABELS[source.source] ?? source.source;
                    return href ? (
                      <a
                        key={source.source}
                        href={href}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="mono-text text-[9px] px-1.5 py-0.5 border border-surface-dim rounded-sm bg-surface-container-low text-brand hover:underline"
                      >
                        {label}
                      </a>
                    ) : (
                      <span
                        key={source.source}
                        className="mono-text text-[9px] px-1.5 py-0.5 border border-surface-dim rounded-sm bg-surface-container-low text-slate-600"
                      >
                        {label}
                      </span>
                    );
                  })}
                </div>
              )}
              <div className="mono-text text-[10px] text-slate-500 space-y-1">
                <div className="flex items-baseline gap-1">
                  <span>Occurrence:</span>
                  <span className="text-sm font-bold text-on-surface ml-auto">{occurrenceCount.toLocaleString()}</span>
                </div>
                {species.evidence?.occurrence_count_outside_region != null && (
                  <div className="flex items-baseline gap-1">
                    <span>Outside Region:</span>
                    <span className="text-sm font-bold text-on-surface ml-auto">
                      {species.evidence.occurrence_count_outside_region.toLocaleString()}
                    </span>
                  </div>
                )}
                <div className="flex items-baseline gap-1">
                  <span>Publication:</span>
                  <span className="text-sm font-bold text-on-surface ml-auto">{publicationCount.toLocaleString()}</span>
                </div>
              </div>
            </>
          )}
          </div>

          <div className="flex items-center justify-between gap-2 pt-2 border-t border-surface-dim/50">
            <button
              className="flex items-center gap-1 text-[9px] font-bold text-brand uppercase group/link"
              onClick={(e) => { e.stopPropagation(); onSelect(species.id); }}
            >
              View Evidence{" "}
              <span className="material-symbols-outlined text-[14px] transition-transform group-hover/link:translate-y-0.5">
                expand_more
              </span>
            </button>
            {historyCount > 0 && (
              <div className="flex flex-col items-end">
                <span className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">Historical Mention</span>
                <span className="mono-text text-[10px] text-slate-600">{historyCount} record{historyCount !== 1 ? "s" : ""}</span>
              </div>
            )}
          </div>
        </div>
      </td>

      {/* Taxonomy Resolution */}
      <td className="px-3 py-2.5 border-r border-surface-dim align-top h-[inherit]" onClick={() => onSelect(species.id)}>

        {/* ── AUTHORITY CONFLICT ────────────────────────────── */}
        {species.taxonomy_status === "authority_conflict" && (() => {
          // Map raw authority strings → readable source labels.
          function authorityLabel(raw: string): string {
            const l = raw.toLowerCase();
            if (l.includes("gbif") || l.includes("backbone") || l.includes("common name match")) return "GBIF Backbone";
            if (l.includes("ebird")) return "eBird";
            if (l.includes("inaturalist") || l.includes("naturalist")) return "iNaturalist";
            if (l.includes("literature")) return "Literature";
            return raw;
          }

          const speciesRawSource = species.evidence?.sources?.[0]?.source ?? "";
          const speciesSourceLabel = (EVIDENCE_SOURCE_LABELS[speciesRawSource] ?? speciesRawSource) || "Imported";

          // All names already represented by conflict cards (to avoid showing a duplicate "keep current" card).
          const conflictNames = new Set(authorityConflicts.map((c) => c.suggested_name));
          const showKeepCurrent = !conflictNames.has(species.scientific_name);
          const keepCurrentKey = `${speciesSourceLabel}::${species.scientific_name}`;

          // Local-only "voter" — selecting a card shows your own profile in front of
          // AGREE, mirroring the synonym AGREE button, but with no other collaborators
          // required: selecting a different card simply moves your agreement there.
          const currentUserProfile: VoterProfile[] = currentUserId
            ? [{ user_id: currentUserId, full_name: null, avatar_url: currentUserAvatar ?? null }]
            : [];

          function selectCard(cardKey: string) {
            setSelectedConflictKey(cardKey);
          }
          function toggleCardOnDoubleClick(cardKey: string) {
            setSelectedConflictKey((cur) => (cur === cardKey ? null : cur));
          }

          // "Taxon ID: <red>1234</red> (Authority, Year)" — no hierarchy here;
          // full hierarchy now lives in the side panel's Conflicts/Synonyms
          // Details sub-tab, looked up live against the backbone. Shared by
          // every option card (conflict options and "keep current").
          function renderOptionMeta(args: {
            taxonId?: number | null;
            authority?: string | null;
            year?: number | null;
          }) {
            const { taxonId, authority, year } = args;
            const authorityText = [authority, year ? String(year) : null].filter(Boolean).join(", ");
            return (
              <div className="mt-1 pt-1 border-t border-slate-100 flex items-center justify-between text-[8px]">
                  <div>
                    <span className="uppercase tracking-widest text-slate-400">
                      Taxon ID:
                    </span>{" "}
                    <span className="text-red-600 font-bold">
                      {taxonId ?? "—"}
                    </span>
                  </div>

                  {authorityText && (
                    <span className="text-slate-500 whitespace-nowrap">
                      {authorityText}
                    </span>
                  )}
                </div>
                    );
                  }

          return (
            <div className="flex flex-col justify-between h-full mono-text gap-3">
              <div className="space-y-1">
                {/* Header */}
                <div className="flex items-center gap-2">
                  <span className="status-pill bg-red-50 text-red-600 border border-red-200 font-bold text-[9px] px-1.5 py-0.5">
                    CONFLICT FOUND
                  </span>
                </div>
                <p className="text-[9px] text-slate-400 -mt-1">
                  Names from different sources — agree on the accepted name, then update.
                </p>
              </div>

              {/* Option cards — one per source. Click AGREE to select, double-click the selected card to deselect. */}
              <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
                {authorityConflicts.slice(0, 2).map((conflict, idx) => {
                  const cardKey = `${conflict.authority}::${conflict.suggested_name}`;
                  const isSelected = selectedConflictKey === cardKey;
                  const liveTaxonId = conflict.taxon_id;
                  const liveAuthority = conflict.authorship;
                  const liveYear = conflict.year;

                  return (
                    <button
                      key={`${conflict.authority}-${idx}`}
                      type="button"
                      onClick={() => selectCard(cardKey)}
                      onDoubleClick={() => toggleCardOnDoubleClick(cardKey)}
                      className={`w-full p-2 border rounded-sm text-left transition-colors ${
                        isSelected
                          ? "border-green-300 bg-green-50/40"
                          : "border-surface-dim bg-white hover:bg-surface-container-low"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex flex-col min-w-0">
                          <span className="text-[8px] text-slate-400 uppercase tracking-widest">
                            {authorityLabel(conflict.authority)}
                          </span>
                          <span className="text-[11px] font-bold italic text-slate-900">
                            {conflict.suggested_name}
                          </span>
                        </div>
                        <span
                          className={`px-2 py-1 flex items-center gap-1 text-[10px] font-bold border rounded-sm flex-none ${
                            isSelected
                              ? "bg-green-50 text-green-600 border-green-300"
                              : "bg-white text-slate-400 border-surface-dim"
                          }`}
                        >
                          {isSelected && <VoterAvatars voters={currentUserProfile} />}
                          AGREE
                        </span>
                      </div>
                      {renderOptionMeta({
                        taxonId: liveTaxonId,
                        authority: liveAuthority,
                        year: liveYear,
                      })}
                    </button>
                  );
                })}

                {/* "Keep current" card — the species' own imported name as the second option */}
                {showKeepCurrent && (
                  <button
                    type="button"
                    onClick={() => selectCard(keepCurrentKey)}
                    onDoubleClick={() => toggleCardOnDoubleClick(keepCurrentKey)}
                    className={`w-full p-2 border rounded-sm text-left transition-colors ${
                      selectedConflictKey === keepCurrentKey
                        ? "border-green-300 bg-green-50/40"
                        : "border-surface-dim bg-white hover:bg-surface-container-low"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex flex-col min-w-0">
                        <span className="text-[8px] text-slate-400 uppercase tracking-widest">
                          {speciesSourceLabel}
                        </span>
                        <span className="text-[11px] font-bold italic text-slate-900">
                          {species.scientific_name}
                        </span>
                      </div>
                      <span
                        className={`px-2 py-1 flex items-center gap-1 text-[10px] font-bold border rounded-sm flex-none ${
                          selectedConflictKey === keepCurrentKey
                            ? "bg-green-50 text-green-600 border-green-300"
                            : "bg-white text-slate-400 border-surface-dim"
                        }`}
                      >
                        {selectedConflictKey === keepCurrentKey && <VoterAvatars voters={currentUserProfile} />}
                        AGREE
                      </span>
                    </div>
                    {renderOptionMeta({
                      taxonId: species.gbif_taxon_key,
                      authority: ownLiveAuthority,
                      year: ownLiveYear,
                    })}
                  </button>
                )}
              </div>

              {/* Footer: UPDATE applies the selected option immediately — no consensus needed. */}
              <div className="pt-3 border-t border-surface-dim/50 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                <button
                  disabled={!selectedConflictKey}
                  className={`px-2 py-1 text-[9px] font-bold uppercase rounded-sm border transition-colors ${
                    selectedConflictKey
                      ? "border-brand text-brand hover:bg-brand hover:text-white"
                      : "border-slate-200 text-slate-300 cursor-not-allowed"
                  }`}
                  onClick={() => {
                    if (!selectedConflictKey) return;
                    const [authority, suggested_name] = selectedConflictKey.split("::");
                    resolveConflict.mutate({ authority, suggested_name });
                  }}
                >
                  UPDATE
                </button>
                <button
                  className="ml-auto text-[9px] font-bold text-brand uppercase flex items-center gap-1 group/link"
                  onClick={() => onSelect(species.id)}
                >
                  REVIEW TAXONOMY{" "}
                  <span className="material-symbols-outlined text-[14px] transition-transform group-hover/link:translate-y-0.5">
                    expand_more
                  </span>
                </button>
              </div>
            </div>
          );
        })()}

        {/* ── SYNONYM / OUTDATED NAME ───────────────────────── */}
        {species.taxonomy_status === "synonym" && (
          <div className="flex flex-col justify-between h-full mono-text gap-3">
            <div className="flex items-center gap-2">
              <span className="status-pill bg-amber-50 text-amber-600 border border-amber-200 font-label-caps text-[9px]">
                OUTDATED NAME
              </span>
              <span className="material-symbols-outlined text-[14px] text-amber-500">refresh</span>
            </div>
            <div className="space-y-2">
              <div className="p-2 bg-slate-50 border border-slate-200 rounded-sm mono-text text-[10px]">
                <div className="flex justify-between mb-1">
                  <span className="text-slate-400 uppercase text-[8px] tracking-widest">Synonym</span>
                  <span className="text-slate-400">
                    {species.taxonomy?.imported_name ?? species.scientific_name}
                  </span>
                </div>
                <div className="flex justify-between font-bold">
                  <span className="text-slate-400 uppercase text-[8px] tracking-widest">Accepted</span>
                  <span className="text-brand italic">{acceptedName ?? "—"}</span>
                </div>
              </div>
              <div className="flex justify-between mono-text text-[9px] px-1">
                <span className="text-slate-400 uppercase">Authority</span>
                <span className="text-slate-600">
                  {acceptedLiveAuthority ?? latestSynonym?.authority ?? "—"}
                </span>
              </div>
              {acceptedLiveYear && (
                <div className="flex justify-between mono-text text-[9px] px-1">
                  <span className="text-slate-400 uppercase">Year</span>
                  <span className="text-slate-600">{acceptedLiveYear}</span>
                </div>
              )}
            </div>

            {/* AGREE / DISAGREE with voter avatars inside the joined button group.
                Selecting either is a local choice — it also casts a vote (for
                collaborator visibility) but doesn't wait on it to unlock UPDATE. */}
            <div className="flex items-center gap-1.5 pt-2 border-t border-slate-200" onClick={(e) => e.stopPropagation()}>
              <div className="flex border border-slate-200 rounded-sm overflow-hidden">
                {/* AGREE — use the new (accepted) name. Voter avatars on the left inside. */}
                <button
                  className={`px-2 py-1 flex items-center gap-1 border-r border-slate-200 transition-colors ${
                    synonymDecision === "agree"
                      ? "bg-green-50 text-green-600"
                      : "bg-white text-slate-400 hover:bg-green-50 hover:text-green-600"
                  }`}
                  onClick={() => {
                    setSelectedSynonymDecision("agree");
                    onSynonymVote?.("agree");
                  }}
                >
                  {synAgreeVoters.length > 0 && <VoterAvatars voters={synAgreeVoters} />}
                  <span className="text-[9px] font-bold">AGREE</span>
                </button>
                {/* DISAGREE — keep the old (synonym) name. Voter avatars on the right inside. */}
                <button
                  className={`px-2 py-1 flex items-center gap-1 transition-colors ${
                    synonymDecision === "disagree"
                      ? "bg-red-50 text-red-600"
                      : "bg-white text-slate-400 hover:bg-red-50 hover:text-red-600"
                  }`}
                  onClick={() => {
                    setSelectedSynonymDecision("disagree");
                    onSynonymVote?.("disagree");
                  }}
                >
                  <span className="text-[9px] font-bold">DISAGREE</span>
                  {synDisagreeVoters.length > 0 && <VoterAvatars voters={synDisagreeVoters} />}
                </button>
              </div>

              {/* UPDATE — applies whichever option (agree/disagree) is selected above */}
              <button
                disabled={!synonymDecision}
                className={`ml-auto px-2 py-1 text-[9px] font-bold uppercase rounded-sm border transition-colors ${
                  synonymDecision
                    ? "border-brand text-brand hover:bg-brand hover:text-white"
                    : "border-slate-200 text-slate-300 cursor-not-allowed"
                }`}
                onClick={() => {
                  if (!synonymDecision) return;
                  resolveTaxonomy.mutate(synonymDecision);
                }}
              >
                UPDATE
              </button>
            </div>
          </div>
        )}

        {/* ── UNRESOLVED ────────────────────────────────────── */}
        {species.taxonomy_status === "unresolved" && (
          <div className="flex flex-col justify-between h-full mono-text gap-3">
            <div className="flex items-center gap-2">
              <span className="status-pill bg-slate-100 text-slate-500 border border-slate-300 text-[9px]">
                UNRESOLVED
              </span>
              <span className="material-symbols-outlined text-[14px] text-slate-400">help</span>
            </div>
            <div className="flex flex-col gap-1.5 text-[10px]">
              <div className="flex justify-between items-center">
                <span className="text-slate-400 uppercase tracking-wider">Backbone Match</span>
                <span className="text-slate-400 font-bold">NOT FOUND</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400 uppercase tracking-wider">Synonyms</span>
                <span className="text-slate-600">NONE</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400 uppercase tracking-wider">Taxonomic Status</span>
                <span className="text-slate-500">UNKNOWN</span>
              </div>
            </div>
            <div className="pt-2 border-t border-surface-dim/50 flex items-center justify-end" onClick={(e) => e.stopPropagation()}>
              <button
                className="text-[9px] font-bold text-brand uppercase flex items-center gap-1 group/link"
                onClick={() => onSelect(species.id)}
              >
                REVIEW TAXONOMY{" "}
                <span className="material-symbols-outlined text-[14px] transition-transform group-hover/link:translate-y-0.5">
                  expand_more
                </span>
              </button>
            </div>
          </div>
        )}

        {/* ── ACCEPTED / TAXONOMY CLEAN ─────────────────────── */}
        {species.taxonomy_status === "accepted" && (
          <div className="flex flex-col justify-between h-full mono-text gap-2.5">
            <div className="flex items-center gap-2">
              <span className="status-pill bg-green-50 text-green-600 border border-green-200 font-label-caps text-[9px]">
                TAXONOMY CLEAN
              </span>
              <span className="material-symbols-outlined text-[14px] text-green-600">check_circle</span>
            </div>
            <div className="flex flex-col gap-1.5 text-[10px]" onClick={(e) => e.stopPropagation()}>
              <div className="flex justify-between items-center">
                <span className="text-slate-400 uppercase tracking-wider">Current Name</span>
                <span className="text-green-600 font-bold">CURRENT</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400 uppercase tracking-wider">Synonyms</span>
                <button
                  disabled={synonyms.length === 0}
                  onClick={() => setSynonymsExpanded((v) => !v)}
                  className="text-slate-600 hover:underline disabled:no-underline disabled:cursor-default"
                >
                  {synonyms.length > 0 ? synonyms.length : "NONE"}
                </button>
              </div>
              {synonymsExpanded && synonyms.length > 0 && (
                <div className="pl-2 border-l border-slate-200 space-y-1">
                  {synonyms.map((syn, i) => {
                    const outcome = syn.outcome ?? (syn.name === acceptedName ? "accepted" : "rejected");
                    const isAccepted = outcome === "accepted";
                    return (
                      <div key={i} className="flex flex-col gap-0.5 text-[9px]">
                        <div className="flex justify-between items-center">
                          <span className={isAccepted ? "text-green-600 italic" : "text-slate-400 italic line-through"}>
                            {syn.name}
                          </span>
                          <span className={isAccepted ? "text-green-600 font-bold" : "text-slate-400 font-bold"}>
                            {isAccepted ? "ACCEPTED" : "REJECTED"}
                          </span>
                        </div>
                        {(syn.authority || syn.year) && (
                          <div className="text-slate-400">
                            {syn.authority ?? ""}
                            {syn.authority && syn.year ? " · " : ""}
                            {syn.year ?? ""}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="flex justify-between items-center">
                <span className="text-slate-400 uppercase tracking-wider">Taxonomic Status</span>
                <button
                  disabled={authorityConflicts.length === 0}
                  onClick={() => setStatusExpanded((v) => !v)}
                  className="text-slate-600 hover:underline disabled:no-underline disabled:cursor-default"
                >
                  {authorityConflicts.length > 0 ? "CONFLICT RESOLVED" : "STABLE"}
                </button>
              </div>
              {statusExpanded && authorityConflicts.length > 0 && (
                <div className="pl-2 border-l border-slate-200 space-y-1">
                  {authorityConflicts.map((conflict, i) => {
                    const isWinner = conflict.suggested_name === species.taxonomy?.name_resolution?.accepted_name;
                    return (
                      <div key={i} className="flex flex-col gap-0.5 text-[9px]">
                        <div className="flex justify-between items-center">
                          <span className={isWinner ? "text-green-600 italic" : "text-slate-400 italic line-through"}>
                            {conflict.suggested_name}
                            {conflict.authorship && (
                              <span className="font-normal not-italic"> {conflict.authorship}</span>
                            )}
                          </span>
                          <span className="text-slate-400">
                            {conflict.authority}
                            {!conflict.authorship && conflict.year ? ` · ${conflict.year}` : ""}
                          </span>
                        </div>
                        <div className="flex justify-between items-center text-slate-400">
                          <span>{conflict.taxon_id ?? "—"}</span>
                          <span>
                            {conflict.classification?.family ?? "—"} ·{" "}
                            <span className="italic">{conflict.classification?.species ?? conflict.suggested_name}</span>
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="pt-2 border-t border-surface-dim/50 flex items-center justify-between" onClick={(e) => e.stopPropagation()}>
              <button
                className="flex items-center gap-1 text-[9px] font-bold text-brand uppercase group/link"
                onClick={() => onSelect(species.id)}
              >
                VIEW TAXONOMY{" "}
                <span className="material-symbols-outlined text-[14px] transition-transform group-hover/link:translate-y-0.5">
                  expand_more
                </span>
              </button>
            </div>
          </div>
        )}
      </td>

      {/* Review Status */}
      <td className="px-4 pt-5 pb-2.5 align-top h-[inherit] pr-8" onClick={() => onSelect(species.id)}>
        <div className="flex flex-col h-full justify-between pr-8">
          {/* Top: status pill */}
          <div className="flex items-center">
            <span className={`text-[11px] font-bold mono-text px-2 py-0.5 rounded-sm w-fit ${reviewStyle.pillClass}`}>
              {reviewStyle.label}
            </span>
          </div>

          {/* Bottom section: reviewer avatar + comment count, divider, then AGREE / DISAGREE */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3">
              <div className="flex items-center -space-x-2">
                <div className="w-6 h-6 rounded-full border-2 border-white bg-slate-100 flex items-center justify-center text-slate-300">
                  <span className="material-symbols-outlined text-[14px]">person</span>
                </div>
              </div>
              <button
                className="flex items-center gap-1 text-[10px] text-slate-400 font-bold mono-text hover:text-brand transition-colors"
                onClick={() => onOpenDiscussion(species.id)}
              >
                <span className="material-symbols-outlined text-[14px]">chat_bubble</span>
                {species.comment_count} {species.comment_count === 1 ? "comment" : "comments"}
              </button>
            </div>

            {/* Footer: AGREE / DISAGREE — same level as MERGE/UPDATE in taxonomy column.
                Blocked only for "authority_conflict"/"synonym" rows, which have an
                actionable decision pending via the taxonomy column's own UPDATE
                action. "unresolved" rows are left reviewable — that status just
                means the backend found no match to resolve against. */}
            <div className="pt-2 border-t border-surface-dim/50" onClick={(e) => e.stopPropagation()}>
              {!isTaxonomyResolved && (
                <p className="mb-1.5 text-[8px] text-slate-400 uppercase tracking-wider">
                  Resolve taxonomy to review
                </p>
              )}
              <div
                className={`flex border border-slate-200 rounded-sm overflow-hidden w-fit ${
                  !isTaxonomyResolved ? "opacity-40" : ""
                }`}
              >
                <button
                  disabled={!isTaxonomyResolved}
                  title={!isTaxonomyResolved ? "Resolve the taxonomy conflict or outdated name first" : undefined}
                  className={`px-2 py-1 flex items-center gap-1 border-r border-slate-200 transition-colors ${
                    !isTaxonomyResolved
                      ? "bg-white text-slate-300 cursor-not-allowed"
                      : reviewDecision === "accept"
                        ? "bg-green-50 text-green-600"
                        : "bg-white text-slate-400 hover:bg-green-50 hover:text-green-600"
                  }`}
                  onClick={() => {
                    if (!isTaxonomyResolved) return;
                    setSelectedReviewDecision("accept");
                    onReviewVote?.("accept");
                  }}
                >
                  {acceptVoters.length > 0 && <VoterAvatars voters={acceptVoters} />}
                  <span className="text-[9px] font-bold mono-text">AGREE</span>
                </button>
                <button
                  disabled={!isTaxonomyResolved}
                  title={!isTaxonomyResolved ? "Resolve the taxonomy conflict or outdated name first" : undefined}
                  className={`px-2 py-1 flex items-center gap-1 transition-colors ${
                    !isTaxonomyResolved
                      ? "bg-white text-slate-300 cursor-not-allowed"
                      : reviewDecision === "reject"
                        ? "bg-red-50 text-red-600"
                        : "bg-white text-slate-400 hover:bg-red-50 hover:text-red-600"
                  }`}
                  onClick={() => {
                    if (!isTaxonomyResolved) return;
                    setSelectedReviewDecision("reject");
                    onReviewVote?.("reject");
                  }}
                >
                  <span className="text-[9px] font-bold mono-text">DISAGREE</span>
                  {rejectVoters.length > 0 && <VoterAvatars voters={rejectVoters} />}
                </button>
              </div>
            </div>
          </div>
        </div>
      </td>
    </tr>
  );
});

export default SpeciesRow;
