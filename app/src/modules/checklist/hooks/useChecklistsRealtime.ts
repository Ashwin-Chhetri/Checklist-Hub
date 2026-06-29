"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

/**
 * Keeps the checklist organizer list live: if any collaborator deletes,
 * creates, or renames a checklist, every other open tab that can see it
 * (RLS-scoped, same as any other postgres_changes listener) picks it up
 * immediately instead of waiting for a manual refresh. Unlike
 * useChecklistRealtimeChannel this isn't scoped to one checklist — it's a
 * single list-level subscription on the checklists table.
 */
export function useChecklistsRealtime(enabled: boolean) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return;

    const supabase = createClient();
    const channel = supabase
      .channel("checklists:list")
      .on("postgres_changes", { event: "*", schema: "public", table: "checklists" }, () => {
        queryClient.invalidateQueries({ queryKey: ["checklists"] });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled, queryClient]);
}
