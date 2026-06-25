export type CollaboratorRole = "owner" | "editor" | "reviewer" | "commenter" | "viewer";

export interface Profile {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  email: string | null;
  profession: string | null;
  location: string | null;
  institution: string | null;
  designation: string | null;
}

export interface Collaborator {
  checklist_id: string;
  user_id: string;
  role: CollaboratorRole;
  invited_by: string | null;
  created_at: string;
  profile?: Profile;
}

/**
 * A tag pointing at a synonym/authority-conflict/evidence-source entry —
 * entities that live inside a species' JSON columns and so have no stable
 * uuid of their own (unlike users and species rows). `key` is the synonym's
 * `name` or the evidence source's `source` enum value, stable within the
 * species it belongs to.
 */
export interface MentionedRef {
  kind: "synonym" | "authority_conflict" | "evidence_source";
  species_id: string;
  key: string;
  label: string;
}

export interface SpeciesComment {
  id: string;
  species_id: string;
  author_id: string;
  body: string;
  attachments: CommentAttachment[];
  parent_comment_id: string | null;
  mentions: string[];
  mentioned_species: string[];
  mentioned_refs: MentionedRef[];
  created_at: string;
  edited_at: string | null;
  author?: Profile;
}

export type NotificationType =
  | "mention"
  | "comment_reply"
  | "comment_added"
  | "taxonomy_vote"
  | "review_status_changed"
  | "authority_conflict_resolved"
  | "species_merged"
  | "taxonomy_resolved"
  | "added_as_collaborator"
  | "watcher_new_species"
  | "watcher_observations_updated"
  | string;

export interface AppNotification {
  id: string;
  user_id: string;
  checklist_id: string | null;
  species_id: string | null;
  type: NotificationType;
  payload: Record<string, unknown> & {
    actor_id?: string;
    scientific_name?: string;
    common_name?: string;
    body?: string;
    suggested_name?: string;
    decision?: string;
    from?: string;
    to?: string;
    target_species_id?: string;
    resolved_by?: string;
    checklist_title?: string;
    watcher_run_id?: string;
    new_species_count?: number;
    updated_species_count?: number;
  };
  read: boolean;
  /** How many times this ambient-activity notification has re-occurred since it was last marked read. Always 1 for direct/personal types (mention, comment_reply). */
  occurrence_count: number;
  created_at: string;
}

export interface CommentAttachment {
  file_url: string;
  file_type: string;
  file_size_mb?: number;
}

export type ReviewDecision = "accept" | "reject" | "agree" | "disagree";

export interface SpeciesReview {
  id: string;
  species_id: string;
  reviewer_id: string;
  decision: ReviewDecision;
  target: Record<string, unknown>;
  note: string | null;
  created_at: string;
}

export interface ActivityLogEntry {
  id: string;
  checklist_id: string;
  actor_id: string | null;
  action:
    | "review_status_changed"
    | "comment_added"
    | "taxonomy_vote"
    | "species_added"
    | "authority_conflict_resolved"
    | "species_merged"
    | "taxonomy_resolved"
    | string;
  target_type: string;
  target_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
  actor?: Profile;
}

export interface RecentComment extends SpeciesComment {
  species?: { id: string; scientific_name: string; common_name: string | null; checklist_id: string };
}

export interface ChecklistInvite {
  id: string;
  checklist_id: string;
  email: string;
  note: string | null;
  role: CollaboratorRole;
  invited_by: string;
  status: "pending" | "accepted" | "declined" | "expired";
  token: string;
  created_at: string;
  responded_at: string | null;
}

export interface PresenceState {
  user_id: string;
  name: string;
  avatar_url?: string;
  current_species_id?: string;
}
