"use client";

import { useState } from "react";

export interface CollaboratorAvatarPerson {
  id: string;
  full_name?: string | null;
  avatar_url?: string | null;
}

export interface CollaboratorAvatarPendingInvite {
  email: string;
  status: string;
}

interface CollaboratorAvatarStackProps {
  collaborators: CollaboratorAvatarPerson[];
  pendingInvites?: CollaboratorAvatarPendingInvite[];
  maxVisible?: number;
  onlineUserIds?: Set<string>;
  onManage?: () => void;
  /** Hover popover listing every collaborator/invite. Off for the organizer table (click-only there). */
  showHoverPreview?: boolean;
}

/** Avatar image with a hard fallback to initials — handles broken/blocked/expired
 * OAuth avatar URLs (e.g. a collaborator's Google photo) so a load failure never
 * renders nothing. */
function CollaboratorAvatarImage({ person, className }: { person: CollaboratorAvatarPerson; className: string }) {
  const [failed, setFailed] = useState(false);
  if (!person.avatar_url || failed) {
    return <>{(person.full_name ?? "?").charAt(0).toUpperCase()}</>;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      alt={person.full_name ?? "Collaborator"}
      className={className}
      src={person.avatar_url}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}

/**
 * Overlapping avatar stack + "+N" overflow chip (workbench header style), with
 * an optional hover popover listing every collaborator and pending invite.
 * Shared by the workbench header and the checklist organizer's COLLABORATORS
 * column so the two stay visually identical.
 */
export default function CollaboratorAvatarStack({
  collaborators,
  pendingInvites = [],
  maxVisible = 3,
  onlineUserIds,
  onManage,
  showHoverPreview = true,
}: CollaboratorAvatarStackProps) {
  const visible = collaborators.slice(0, maxVisible);
  const overflow = collaborators.length - visible.length;

  if (collaborators.length === 0 && pendingInvites.length === 0) return null;

  return (
    <div className="relative group">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onManage?.();
        }}
        className="flex items-center -space-x-2"
      >
        {visible.map((person) => (
          <div
            key={person.id}
            className="relative w-7 h-7 rounded-full border-2 border-white bg-slate-100 flex items-center justify-center text-[9px] font-bold text-on-surface-variant shadow-sm overflow-hidden"
            title={person.full_name ?? person.id}
          >
            {onlineUserIds?.has(person.id) && (
              <span className="absolute bottom-0 right-0 w-2 h-2 rounded-full bg-green-500 border border-white" />
            )}
            <CollaboratorAvatarImage person={person} className="w-full h-full object-cover" />
          </div>
        ))}
        {overflow > 0 && (
          <div className="w-7 h-7 rounded-full border-2 border-white bg-slate-100 flex items-center justify-center text-[9px] font-bold text-on-surface-variant shadow-sm">
            +{overflow}
          </div>
        )}
        {collaborators.length === 0 &&
          pendingInvites.map((invite) => (
            <div
              key={invite.email}
              className="w-7 h-7 rounded-full border-2 border-dashed border-slate-300 bg-white flex items-center justify-center"
              title={`${invite.email} (pending)`}
            >
              <span className="material-symbols-outlined text-[14px] text-slate-300">person</span>
            </div>
          ))}
      </button>

      {showHoverPreview && (
        // pt-1 (not mt-1 on the panel) keeps the hover bridge gapless: the
        // padding is still part of this wrapper's hoverable box, so moving
        // the cursor from the button down into the panel never crosses a
        // dead zone that would hide it first.
        <div className="hidden group-hover:block absolute right-0 top-full pt-1 w-56 z-30">
          <div className="bg-white border border-surface-dim rounded-sm shadow-hard p-2">
            <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400 px-1 mb-1">Collaborators</p>
            <div className="space-y-1 mb-2">
              {collaborators.map((person) => (
                <div key={person.id} className="flex items-center gap-2 px-1 py-1">
                  <div className="w-5 h-5 rounded-full bg-slate-100 flex items-center justify-center text-[8px] font-bold text-slate-500 overflow-hidden shrink-0">
                    <CollaboratorAvatarImage person={person} className="w-full h-full object-cover" />
                  </div>
                  <span className="text-xs text-slate-700 truncate">{person.full_name ?? "Unknown"}</span>
                </div>
              ))}
            </div>
            {pendingInvites.length > 0 && (
              <>
                <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400 px-1 mb-1">Invited</p>
                <div className="space-y-1 mb-2">
                  {pendingInvites.map((invite) => (
                    <div key={invite.email} className="flex items-center gap-2 px-1 py-1">
                      <div className="w-5 h-5 rounded-full border border-dashed border-slate-300 flex items-center justify-center shrink-0">
                        <span className="material-symbols-outlined text-[12px] text-slate-300">person</span>
                      </div>
                      <span className="text-xs text-slate-500 truncate flex-1">{invite.email}</span>
                      <span className="status-pill bg-amber-50 text-amber-600 border border-amber-200">Pending</span>
                    </div>
                  ))}
                </div>
              </>
            )}
            {onManage && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onManage();
                }}
                className="w-full text-left text-[10px] font-bold uppercase tracking-wider text-brand hover:underline px-1 pt-1 border-t border-surface-dim"
              >
                Manage team
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
