"use client";

import { useEffect, useRef, useState } from "react";
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  useUnreadNotificationCount,
} from "@/modules/collaboration/hooks/useNotifications";
import type { AppNotification } from "@/types/collaboration.types";

interface NotificationBellProps {
  userId: string | undefined;
  onNavigate: (notification: AppNotification) => void;
}

function describeNotification(n: AppNotification): string {
  const name = n.payload.scientific_name ?? "a species";
  const commonName = n.payload.common_name;
  const fullName = commonName ? `${name} (${commonName})` : name;
  switch (n.type) {
    case "mention":
      return `You were mentioned on ${fullName}`;
    case "comment_reply":
      return `New reply on ${name}`;
    case "comment_added":
      return `New comment on ${name}`;
    case "taxonomy_vote":
      return `${n.payload.decision === "agree" ? "Agreed" : "Disagreed"} with ${n.payload.suggested_name ?? "a suggestion"} for ${name}`;
    case "review_status_changed":
      return `${name} review status changed to ${n.payload.to ?? "?"}`;
    case "authority_conflict_resolved":
      return n.payload.resolved_by === "consensus"
        ? `Collaborators reached consensus on the authority conflict for ${name}`
        : `Authority conflict resolved for ${name}`;
    case "species_merged":
      return `${name} was merged into another species`;
    case "taxonomy_resolved":
      return `Taxonomy ${n.payload.decision ?? "resolved"} for ${name}`;
    case "added_as_collaborator":
      return `You were added as a collaborator on ${n.payload.checklist_title ?? "a checklist"}`;
    case "watcher_new_species": {
      const parts: string[] = [];
      if (n.payload.new_species_count) parts.push(`${n.payload.new_species_count} possible new species`);
      if (n.payload.updated_species_count) parts.push(`${n.payload.updated_species_count} updated species`);
      return `Watcher found ${parts.join(" · ") || "new activity"} on ${n.payload.checklist_title ?? "a checklist"}`;
    }
    default:
      return `Update on ${name}`;
  }
}

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

export default function NotificationBell({ userId, onNavigate }: NotificationBellProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { data: notifications } = useNotifications(userId);
  const { data: unreadCount } = useUnreadNotificationCount(userId);
  const markRead = useMarkNotificationRead(userId);
  const markAllRead = useMarkAllNotificationsRead(userId);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function handleClick(notification: AppNotification) {
    if (!notification.read) markRead.mutate(notification.id);
    setOpen(false);
    onNavigate(notification);
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative text-on-surface-variant hover:text-primary transition-colors w-8 h-8 flex items-center justify-center"
        title="Notifications"
      >
        <span className="material-symbols-outlined text-[20px]">notifications</span>
        {!!unreadCount && unreadCount > 0 && (
          <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-sm w-64 bg-white border border-outline-variant shadow-lg z-50 rounded-sm flex flex-col">
          <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-outline-variant">
            <span className="font-code-md text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">
              Notifications
            </span>
            {!!unreadCount && unreadCount > 0 && (
              <button
                onClick={() => markAllRead.mutate()}
                className="font-code-md text-[9px] font-bold uppercase text-primary hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-[150px] overflow-y-auto">
            {(notifications?.length ?? 0) === 0 && (
              <p className="px-2.5 py-4 text-center text-[11px] text-on-surface-variant">No notifications yet.</p>
            )}
            {notifications?.map((n) => (
              <button
                key={n.id}
                onClick={() => handleClick(n)}
                className={`w-full text-left flex items-start gap-1.5 px-2.5 py-2 border-b border-outline-variant last:border-b-0 hover:bg-surface-container-low transition-colors ${
                  n.read ? "" : "bg-primary/5"
                }`}
              >
                <span className="flex-1 min-w-0">
                  <span className="block text-[11px] text-on-surface leading-snug">
                    {describeNotification(n)}
                    {n.occurrence_count > 1 && (
                      <span className="text-on-surface-variant"> (×{n.occurrence_count})</span>
                    )}
                  </span>
                  <span className="block text-[9px] font-code-md uppercase text-on-surface-variant mt-0.5">
                    {formatRelativeTime(n.created_at)}
                  </span>
                </span>
                {!n.read && <span className="w-1.5 h-1.5 rounded-full bg-primary mt-1 shrink-0" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
