"use client";

import { useState } from "react";
import type { Collaborator } from "@/types/collaboration.types";
import {
  useChecklistInvites,
  useEmailLookup,
  useInviteCollaborator,
  useProfileSearch,
  useRemoveCollaborator,
} from "@/modules/checklist/hooks/useChecklist";
import { isValidEmailFormat } from "@/lib/validation/email";

/** Avatar image with a hard fallback to initials — handles broken/blocked/expired
 * OAuth avatar URLs (e.g. a collaborator's Google photo) so a load failure never
 * renders nothing. */
function MemberAvatar({ avatarUrl, fullName }: { avatarUrl?: string | null; fullName?: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!avatarUrl || failed) {
    return <>{(fullName ?? "?").charAt(0).toUpperCase()}</>;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      alt=""
      className="w-full h-full object-cover"
      src={avatarUrl}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}

interface TeamModalProps {
  checklistId: string;
  collaborators: Collaborator[];
  currentUserId?: string;
  canManageRoles: boolean;
  onClose: () => void;
}

export default function TeamModal({
  checklistId,
  collaborators,
  currentUserId,
  canManageRoles,
  onClose,
}: TeamModalProps) {
  const { data: invites } = useChecklistInvites(checklistId);
  const inviteCollaborator = useInviteCollaborator(checklistId);
  const removeCollaborator = useRemoveCollaborator(checklistId);
  const [email, setEmail] = useState("");
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);

  const existingIds = collaborators.map((c) => c.user_id);
  const { data: suggestions } = useProfileSearch(email, existingIds);
  const trimmedEmail = email.trim();
  const alreadySuggested = suggestions?.some((p) => p.email?.toLowerCase() === trimmedEmail.toLowerCase());
  const showNewEmailRow = isValidEmailFormat(trimmedEmail) && !alreadySuggested;

  const emailLookup = useEmailLookup(trimmedEmail);
  const lookupChecking = showNewEmailRow && (emailLookup.isLoading || emailLookup.isFetching);
  const lookupUnverified = showNewEmailRow && emailLookup.data?.matched === false && !emailLookup.data.verified;

  function handleInvite() {
    if (!email.trim()) return;
    if (showNewEmailRow && (lookupChecking || lookupUnverified)) return;
    inviteCollaborator.mutate({ email: email.trim() }, { onSuccess: () => setEmail("") });
    setSuggestionsOpen(false);
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30" onClick={onClose}>
      <div
        className="bg-white border border-surface-dim rounded-sm shadow-hard w-[32rem] max-w-[90vw] p-5 max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="mono-text text-sm font-bold uppercase tracking-wider text-slate-700">Team</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-brand">
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Members</h4>
        <div className="space-y-2 mb-4">
          {collaborators.length === 0 && <p className="text-xs text-slate-400">No collaborators yet.</p>}
          {collaborators.map((c) => {
            const removable = canManageRoles && c.role !== "owner" && c.user_id !== currentUserId;
            return (
              <div key={c.user_id} className="flex items-center gap-3 p-2 border border-surface-dim rounded-sm">
                <div className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center text-[10px] font-bold text-slate-500 overflow-hidden">
                  <MemberAvatar avatarUrl={c.profile?.avatar_url} fullName={c.profile?.full_name} />
                </div>
                <span className="text-xs text-slate-700 flex-1 truncate">
                  {c.profile?.full_name ?? c.profile?.email ?? c.user_id}
                </span>
                {c.role === "owner" ? (
                  <span className="mono-text text-[9px] uppercase text-slate-400">Owner</span>
                ) : removable ? (
                  <button
                    type="button"
                    onClick={() => removeCollaborator.mutate(c.user_id)}
                    disabled={removeCollaborator.isPending}
                    title="Remove from checklist"
                    className="text-slate-400 hover:text-red-600 transition-colors disabled:opacity-50"
                  >
                    <span className="material-symbols-outlined text-[18px]">person_remove</span>
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>

        {invites && invites.length > 0 && (
          <>
            <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Pending Invites</h4>
            <div className="space-y-2 mb-4">
              {invites.map((invite) => (
                <div key={invite.id} className="flex items-center gap-3 p-2 border border-surface-dim rounded-sm">
                  <span className="material-symbols-outlined text-[16px] text-slate-400">mail</span>
                  <span className="text-xs text-slate-700 flex-1">{invite.email}</span>
                  <span
                    className={`status-pill ${
                      invite.status === "pending"
                        ? "bg-amber-50 text-amber-600 border border-amber-200"
                        : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {invite.status}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}

        <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Invite by Email</h4>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <input
              className="flex-1 border border-surface-dim rounded-sm px-3 py-1.5 text-xs focus:border-brand focus:ring-0"
              placeholder="Search by name or email…"
              type="text"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setSuggestionsOpen(true);
              }}
              onFocus={() => setSuggestionsOpen(true)}
              onBlur={() => setSuggestionsOpen(false)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleInvite();
                }
              }}
            />
            <button
              onClick={handleInvite}
              disabled={
                !email.trim() || inviteCollaborator.isPending || (showNewEmailRow && (lookupChecking || lookupUnverified))
              }
              className="bg-brand text-white mono-text text-[10px] font-bold uppercase px-3 py-2 rounded-sm shadow-hard hover:translate-y-[-1px] transition-transform disabled:opacity-50"
            >
              Invite
            </button>
          </div>
          {/* Rendered in normal flow (not absolute) so the dialog grows taller
              to fit suggestions instead of floating an overlay over the role
              select/Invite button below it. */}
          {suggestionsOpen && ((suggestions?.length ?? 0) > 0 || showNewEmailRow) && (
            <div className="max-h-48 overflow-y-auto bg-white border border-surface-dim rounded-sm shadow-hard">
              {suggestions?.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-surface-container-low flex items-center gap-2"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setEmail(p.email ?? "");
                    setSuggestionsOpen(false);
                  }}
                >
                  <span className="material-symbols-outlined text-[14px] text-slate-400">person</span>
                  <span className="flex flex-col">
                    <span>{p.full_name ?? "Unknown user"}</span>
                    {p.email && <span className="text-[10px] text-slate-400">{p.email}</span>}
                  </span>
                </button>
              ))}
              {showNewEmailRow && (
                <button
                  type="button"
                  disabled={lookupChecking || lookupUnverified}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-surface-container-low flex items-center gap-2 border-t border-dashed border-surface-dim disabled:opacity-60 disabled:hover:bg-transparent"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleInvite();
                  }}
                >
                  <span className="mono-text text-[8px] uppercase tracking-wider text-slate-400 bg-surface-container-low px-1.5 py-0.5">
                    New
                  </span>
                  {lookupChecking ? (
                    <span className="flex items-center gap-1.5 text-slate-400">
                      <span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span>
                      Checking <strong>{trimmedEmail}</strong>…
                    </span>
                  ) : lookupUnverified ? (
                    <span className="text-slate-400">
                      Couldn&apos;t find a mail server for <strong>{trimmedEmail}</strong>
                    </span>
                  ) : (
                    <span>
                      Invite <strong>{trimmedEmail}</strong> by email
                    </span>
                  )}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
