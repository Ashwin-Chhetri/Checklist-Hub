import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import type { PresenceState } from "@/types/collaboration.types";

/**
 * Opens the single Realtime channel for a checklist (channel name "checklist:<id>"),
 * combining Presence, Broadcast, and postgres_changes as described in the
 * implementation plan section 3. Caller is responsible for unsubscribing.
 */
export function openChecklistChannel(
  supabase: SupabaseClient,
  checklistId: string,
  presenceState: PresenceState,
  handlers: {
    onPresenceSync?: (participants: Record<string, PresenceState>) => void;
    onBroadcast?: (event: string, payload: unknown) => void;
    onSpeciesChange?: (payload: unknown) => void;
    onCommentChange?: (payload: unknown) => void;
    onReviewChange?: (payload: unknown) => void;
    onActivityInsert?: (payload: unknown) => void;
    onCollaboratorChange?: (payload: unknown) => void;
    onInviteChange?: (payload: unknown) => void;
  },
): RealtimeChannel {
  const channel = supabase.channel(`checklist:${checklistId}`, {
    config: { presence: { key: presenceState.user_id } },
  });

  if (handlers.onPresenceSync) {
    channel.on("presence", { event: "sync" }, () => {
      const raw = channel.presenceState<PresenceState>();
      const participants: Record<string, PresenceState> = {};
      for (const [key, presences] of Object.entries(raw)) {
        if (presences[0]) participants[key] = presences[0];
      }
      handlers.onPresenceSync!(participants);
    });
  }

  if (handlers.onBroadcast) {
    channel.on("broadcast", { event: "*" }, ({ event, payload }) =>
      handlers.onBroadcast!(event, payload),
    );
  }

  channel
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "species", filter: `checklist_id=eq.${checklistId}` },
      (payload) => handlers.onSpeciesChange?.(payload),
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "species_comments" },
      (payload) => handlers.onCommentChange?.(payload),
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "species_reviews" },
      (payload) => handlers.onReviewChange?.(payload),
    )
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "activity_log", filter: `checklist_id=eq.${checklistId}` },
      (payload) => handlers.onActivityInsert?.(payload),
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "checklist_collaborators", filter: `checklist_id=eq.${checklistId}` },
      (payload) => handlers.onCollaboratorChange?.(payload),
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "checklist_invites", filter: `checklist_id=eq.${checklistId}` },
      (payload) => handlers.onInviteChange?.(payload),
    );

  channel.subscribe(async (status) => {
    if (status === "SUBSCRIBED") {
      await channel.track(presenceState);
    }
  });

  return channel;
}

/** Send an ephemeral broadcast event (e.g. typing indicator, live cell edit preview). */
export function broadcast(channel: RealtimeChannel, event: string, payload: unknown) {
  return channel.send({ type: "broadcast", event, payload });
}
