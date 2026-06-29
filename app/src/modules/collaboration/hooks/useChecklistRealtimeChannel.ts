"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { PresenceState } from "@/types/collaboration.types";
import type { Species } from "@/types/species.types";
import { openChecklistChannel } from "../services/realtimeChannel";
import { usePresenceStore } from "../stores/presenceStore";
import { patchSpeciesFromRow, removeSpeciesFromList } from "@/modules/species/utils/patchSpeciesCache";
import type { ActivityLogEntry } from "@/types/collaboration.types";

type ChangePayload<T> = { eventType?: string; new?: T; old?: Partial<T> };

/**
 * Sets up the realtime channel for a checklist: presence (collaborator avatars),
 * and postgres_changes for species/comments/reviews. Species row changes patch
 * the cached list directly (no full-list refetch); comment/review changes are
 * scoped to this checklist's species via `speciesIds` since those two tables
 * have no checklist_id column to filter on server-side.
 */
export function useChecklistRealtimeChannel(
  checklistId: string,
  currentUser: PresenceState | null,
  speciesIds: Set<string>,
) {
  const queryClient = useQueryClient();
  const setParticipants = usePresenceStore((state) => state.setParticipants);
  const clearParticipants = usePresenceStore((state) => state.clear);

  // Read via ref so the channel doesn't get torn down/resubscribed every time
  // the species list changes — handlers always see the latest set.
  const speciesIdsRef = useRef(speciesIds);
  useEffect(() => {
    speciesIdsRef.current = speciesIds;
  }, [speciesIds]);

  useEffect(() => {
    if (!checklistId || !currentUser) return;

    const supabase = createClient();
    const channel = openChecklistChannel(supabase, checklistId, currentUser, {
      onPresenceSync: setParticipants,
      onSpeciesChange: (payload) => {
        const { eventType, new: newRow, old: oldRow } = payload as ChangePayload<Species>;
        if (eventType === "DELETE") {
          if (oldRow?.id) removeSpeciesFromList(queryClient, checklistId, oldRow.id);
        } else if (newRow) {
          patchSpeciesFromRow(queryClient, checklistId, newRow);
        }
      },
      onCommentChange: (payload) => {
        const { new: newRow, old: oldRow } = payload as ChangePayload<{ species_id: string }>;
        const speciesId = newRow?.species_id ?? oldRow?.species_id;
        if (speciesId && speciesIdsRef.current.has(speciesId)) {
          queryClient.invalidateQueries({ queryKey: ["comments", speciesId] });
          queryClient.invalidateQueries({ queryKey: ["checklists", checklistId, "recent-comments"] });
        }
      },
      onReviewChange: (payload) => {
        const { new: newRow, old: oldRow } = payload as ChangePayload<{ species_id: string }>;
        const speciesId = newRow?.species_id ?? oldRow?.species_id;
        if (speciesId && speciesIdsRef.current.has(speciesId)) {
          queryClient.invalidateQueries({ queryKey: ["checklist-votes", checklistId] });
        }
      },
      onCollaboratorChange: () => {
        queryClient.invalidateQueries({ queryKey: ["checklists", checklistId, "collaborators"] });
      },
      onInviteChange: () => {
        queryClient.invalidateQueries({ queryKey: ["checklists", checklistId, "invites"] });
      },
      onActivityInsert: (payload) => {
        const { new: newRow } = payload as ChangePayload<ActivityLogEntry>;
        if (!newRow) return;
        const matches = queryClient.getQueryCache().findAll({
          queryKey: ["checklists", checklistId, "activity"],
          exact: false,
        });
        for (const query of matches) {
          const actionsFilter = query.queryKey[3];
          const included =
            actionsFilter === "all" || (Array.isArray(actionsFilter) && actionsFilter.includes(newRow.action));
          if (!included) continue;
          queryClient.setQueryData<ActivityLogEntry[]>(query.queryKey, (old) =>
            old ? [{ ...newRow, actor: undefined }, ...old].slice(0, 30) : old,
          );
        }
      },
    });

    return () => {
      clearParticipants();
      supabase.removeChannel(channel);
    };
  }, [checklistId, currentUser, queryClient, setParticipants, clearParticipants]);
}
