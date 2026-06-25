"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Species } from "@/types/species.types";
import type { Collaborator, CommentAttachment, MentionedRef, SpeciesComment } from "@/types/collaboration.types";
import { useComments, usePostComment, useUpdateComment } from "@/modules/collaboration/hooks/useComments";
import { useCurrentUser } from "@/modules/auth/hooks/useCurrentUser";
import { EVIDENCE_SOURCE_LABELS } from "@/modules/editor/utils/badges";
import { createClient } from "@/lib/supabase/client";

const ATTACHMENTS_BUCKET = "evidence-attachments";
const URL_REGEX = /(https?:\/\/[^\s]+)/g;

interface DiscussionPanelProps {
  species: Species;
  checklistId: string;
  collaborators?: Collaborator[];
  speciesList?: Species[];
  onSelectSpecies?: (speciesId: string) => void;
  /** Jump to the Taxonomy tab and select the given name's sub-tab — used when a synonym/conflict tag is clicked. */
  onSelectTaxonomyRef?: (name: string) => void;
  /** Jump to the Evidence tab — used when an evidence-source tag is clicked. */
  onSelectEvidence?: () => void;
}

type MentionTrigger = "@" | "#";

interface MentionMatch {
  trigger: MentionTrigger;
  query: string;
  start: number;
}

/** One selectable row in the @/# suggestion dropdown. */
interface MentionOption {
  id: string;
  insertText: string;
  label: string;
  sublabel?: string;
  icon: string;
  userId?: string;
  speciesId?: string;
  ref?: MentionedRef;
}

interface MentionSection {
  label: string | null;
  options: MentionOption[];
}

function findMentionMatch(text: string, cursor: number): MentionMatch | null {
  const upToCursor = text.slice(0, cursor);
  const match = upToCursor.match(/([@#])([\w .'-]*)$/);
  if (!match) return null;
  return { trigger: match[1] as MentionTrigger, query: match[2], start: upToCursor.length - match[0].length };
}

function linkifyText(text: string): React.ReactNode[] {
  return text.split(URL_REGEX).map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a
        key={i}
        href={part}
        target="_blank"
        rel="noreferrer"
        className="text-brand underline break-all"
      >
        {part}
      </a>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

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

function AttachmentLink({ attachment }: { attachment: CommentAttachment }) {
  async function handleDownload() {
    const supabase = createClient();
    const { data, error } = await supabase.storage
      .from(ATTACHMENTS_BUCKET)
      .createSignedUrl(attachment.file_url, 60);
    if (!error && data?.signedUrl) {
      window.open(data.signedUrl, "_blank", "noopener");
    }
  }

  const fileName = attachment.file_url.split("/").pop() ?? attachment.file_url;

  return (
    <div className="flex items-center gap-3 p-2 bg-surface-container-low/60 border border-surface-dim rounded-sm">
      <span className="material-symbols-outlined text-slate-400">description</span>
      <div className="flex flex-col">
        <span className="text-[10px] font-bold text-slate-700">{fileName}</span>
        {attachment.file_size_mb && (
          <span className="text-[9px] text-slate-400 uppercase mono-text">
            {attachment.file_size_mb.toFixed(2)} MB
          </span>
        )}
      </div>
      <button onClick={handleDownload} className="ml-auto text-slate-400 hover:text-brand">
        <span className="material-symbols-outlined text-[18px]">download</span>
      </button>
    </div>
  );
}

export default function DiscussionPanel({
  species,
  checklistId,
  collaborators = [],
  speciesList = [],
  onSelectSpecies,
  onSelectTaxonomyRef,
  onSelectEvidence,
}: DiscussionPanelProps) {
  const { data: comments, isLoading } = useComments(species.id);
  const postComment = usePostComment(species.id);
  const updateComment = useUpdateComment(species.id);
  const { data: user } = useCurrentUser();
  const [body, setBody] = useState("");
  const [mentions, setMentions] = useState<string[]>([]);
  const [mentionedSpecies, setMentionedSpecies] = useState<string[]>([]);
  const [mentionedRefs, setMentionedRefs] = useState<MentionedRef[]>([]);
  const [mentionMatch, setMentionMatch] = useState<MentionMatch | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [replyTo, setReplyTo] = useState<SpeciesComment | null>(null);
  const [editingComment, setEditingComment] = useState<SpeciesComment | null>(null);
  const [pendingAttachments, setPendingAttachments] = useState<CommentAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow the composer with its content instead of a fixed multi-line box.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [body]);

  const speciesById = useMemo(() => {
    const map = new Map<string, Species>();
    speciesList.forEach((s) => map.set(s.id, s));
    if (!map.has(species.id)) map.set(species.id, species);
    return map;
  }, [speciesList, species]);

  const mentionSections = useMemo<MentionSection[]>(() => {
    if (!mentionMatch) return [];
    const query = mentionMatch.query.trim().toLowerCase();

    if (mentionMatch.trigger === "@") {
      const options: MentionOption[] = collaborators
        .filter((c) => {
          const name = (c.profile?.full_name ?? "").toLowerCase();
          const email = (c.profile?.email ?? "").toLowerCase();
          return name.includes(query) || email.includes(query);
        })
        .slice(0, 6)
        .map((c) => ({
          id: `user:${c.user_id}`,
          insertText: `@${c.profile?.full_name ?? "user"}`,
          label: c.profile?.full_name ?? "Unknown user",
          sublabel: c.profile?.email ?? undefined,
          icon: "person",
          userId: c.user_id,
        }));
      return [{ label: null, options }];
    }

    const speciesOptions: MentionOption[] = speciesList
      .filter(
        (s) =>
          s.scientific_name.toLowerCase().includes(query) ||
          (s.common_name ?? "").toLowerCase().includes(query),
      )
      .slice(0, 4)
      .map((s) => ({
        id: `species:${s.id}`,
        insertText: `#${s.scientific_name}`,
        label: s.scientific_name,
        sublabel: s.common_name ?? undefined,
        icon: "pets",
        speciesId: s.id,
      }));

    const synonymOptions: MentionOption[] = (species.taxonomy?.synonyms ?? [])
      .filter((s) => s.name.toLowerCase().includes(query))
      .slice(0, 4)
      .map((s) => ({
        id: `synonym:${s.name}`,
        insertText: `#${s.name}`,
        label: s.name,
        sublabel: s.year ? `Synonym · ${s.year}` : "Synonym",
        icon: "history",
        ref: { kind: "synonym", species_id: species.id, key: s.name, label: s.name } as MentionedRef,
      }));

    const conflictOptions: MentionOption[] = (species.taxonomy?.authority_conflicts ?? [])
      .filter((c) => c.suggested_name.toLowerCase().includes(query))
      .slice(0, 4)
      .map((c) => ({
        id: `conflict:${c.suggested_name}`,
        insertText: `#${c.suggested_name}`,
        label: c.suggested_name,
        sublabel: `${c.authority} conflict`,
        icon: "rule",
        ref: {
          kind: "authority_conflict",
          species_id: species.id,
          key: c.suggested_name,
          label: c.suggested_name,
        } as MentionedRef,
      }));

    const evidenceOptions: MentionOption[] = (species.evidence?.sources ?? [])
      .filter((s) => (EVIDENCE_SOURCE_LABELS[s.source] ?? s.source).toLowerCase().includes(query))
      .slice(0, 4)
      .map((s) => {
        const label = EVIDENCE_SOURCE_LABELS[s.source] ?? s.source;
        return {
          id: `evidence:${s.source}`,
          insertText: `#${label}`,
          label,
          sublabel: s.record_count ? `${s.record_count} occurrences` : "Evidence source",
          icon: "fact_check",
          ref: { kind: "evidence_source", species_id: species.id, key: s.source, label } as MentionedRef,
        };
      });

    const sections: MentionSection[] = [];
    if (speciesOptions.length) sections.push({ label: "Species", options: speciesOptions });
    if (synonymOptions.length || conflictOptions.length)
      sections.push({ label: "Synonyms", options: [...synonymOptions, ...conflictOptions] });
    if (evidenceOptions.length) sections.push({ label: "Evidence", options: evidenceOptions });
    return sections;
  }, [mentionMatch, collaborators, speciesList, species]);

  const flatMentionOptions = useMemo(() => mentionSections.flatMap((s) => s.options), [mentionSections]);

  // Reset the highlighted suggestion whenever the query changes, adjusted
  // during render (not an effect) to avoid the extra render an effect would cause.
  const mentionQueryKey = mentionMatch ? `${mentionMatch.trigger}:${mentionMatch.query}` : null;
  const [prevMentionQueryKey, setPrevMentionQueryKey] = useState<string | null>(null);
  if (mentionQueryKey !== prevMentionQueryKey) {
    setPrevMentionQueryKey(mentionQueryKey);
    setHighlightedIndex(0);
  }

  function updateMentionMatch(value: string, cursor: number) {
    setMentionMatch(findMentionMatch(value, cursor));
  }

  function handleBodyChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value;
    setBody(value);
    updateMentionMatch(value, e.target.selectionStart);
  }

  function handleBodySelect(e: React.SyntheticEvent<HTMLTextAreaElement>) {
    const target = e.target as HTMLTextAreaElement;
    updateMentionMatch(target.value, target.selectionStart);
  }

  function applyMentionOption(option: MentionOption) {
    if (!mentionMatch) return;
    const cursor = textareaRef.current?.selectionStart ?? body.length;
    const before = body.slice(0, mentionMatch.start);
    const after = body.slice(cursor);
    const next = `${before}${option.insertText} ${after}`;
    setBody(next);
    setMentionMatch(null);
    if (option.userId) {
      setMentions((prev) => (prev.includes(option.userId!) ? prev : [...prev, option.userId!]));
    } else if (option.speciesId) {
      setMentionedSpecies((prev) => (prev.includes(option.speciesId!) ? prev : [...prev, option.speciesId!]));
    } else if (option.ref) {
      setMentionedRefs((prev) =>
        prev.some((r) => r.kind === option.ref!.kind && r.key === option.ref!.key)
          ? prev
          : [...prev, option.ref!],
      );
    }
    requestAnimationFrame(() => {
      const newCursor = before.length + option.insertText.length + 1;
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(newCursor, newCursor);
    });
  }

  function resetComposer() {
    setBody("");
    setMentions([]);
    setMentionedSpecies([]);
    setMentionedRefs([]);
    setMentionMatch(null);
    setReplyTo(null);
    setEditingComment(null);
    setPendingAttachments([]);
  }

  function handleSubmit() {
    if (!body.trim() && pendingAttachments.length === 0) return;
    if (editingComment) {
      updateComment.mutate(
        {
          commentId: editingComment.id,
          body: body.trim(),
          mentions,
          mentionedSpecies,
          mentionedRefs,
        },
        { onSuccess: resetComposer },
      );
      return;
    }
    if (!user) return;
    postComment.mutate(
      {
        speciesId: species.id,
        authorId: user.id,
        body: body.trim(),
        parentCommentId: replyTo?.id,
        mentions,
        mentionedSpecies,
        mentionedRefs,
        attachments: pendingAttachments,
      },
      { onSuccess: resetComposer },
    );
  }

  function startEdit(comment: SpeciesComment) {
    setReplyTo(null);
    setEditingComment(comment);
    setBody(comment.body);
    setMentions(comment.mentions ?? []);
    setMentionedSpecies(comment.mentioned_species ?? []);
    setMentionedRefs(comment.mentioned_refs ?? []);
    setPendingAttachments([]);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function handleTextareaKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (mentionMatch && flatMentionOptions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightedIndex((i) => (i + 1) % flatMentionOptions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightedIndex((i) => (i - 1 + flatMentionOptions.length) % flatMentionOptions.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        applyMentionOption(flatMentionOptions[highlightedIndex]);
        return;
      }
      if (e.key === "Escape") {
        setMentionMatch(null);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setUploading(true);
    try {
      const supabase = createClient();
      const path = `${checklistId}/${species.id}/${Date.now()}-${file.name}`;
      const { error } = await supabase.storage.from(ATTACHMENTS_BUCKET).upload(path, file);
      if (error) throw error;
      setPendingAttachments((prev) => [
        ...prev,
        { file_url: path, file_type: file.type, file_size_mb: file.size / (1024 * 1024) },
      ]);
    } finally {
      setUploading(false);
    }
  }

  function removePendingAttachment(index: number) {
    setPendingAttachments((prev) => prev.filter((_, i) => i !== index));
  }

  // Top-level comments first, with their replies nested directly beneath.
  const topLevel = comments?.filter((c) => !c.parent_comment_id) ?? [];
  const repliesByParent = new Map<string, SpeciesComment[]>();
  comments?.forEach((c) => {
    if (c.parent_comment_id) {
      const list = repliesByParent.get(c.parent_comment_id) ?? [];
      list.push(c);
      repliesByParent.set(c.parent_comment_id, list);
    }
  });

  function renderComment(comment: SpeciesComment, isReply: boolean) {
    const isOwn = comment.author_id === user?.id;
    return (
      <div key={comment.id} className={`group flex flex-col gap-1.5 ${isReply ? "ml-6 pl-3 border-l-2 border-surface-dim" : ""}`}>
        <div className="flex items-center gap-2">
          {comment.author?.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img alt="" className="w-6 h-6 rounded-full" src={comment.author.avatar_url} />
          ) : (
            <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center text-[10px] font-bold text-slate-500">
              {(comment.author?.full_name ?? "?").charAt(0).toUpperCase()}
            </div>
          )}
          <span className="mono-text text-xs font-bold text-slate-900">
            {comment.author?.full_name ?? "Unknown"}
          </span>
          <span className="text-[9px] text-slate-400 mono-text uppercase">
            {formatRelativeTime(comment.created_at)}
            {comment.edited_at && " · edited"}
          </span>
          <div className="ml-auto flex items-center gap-3 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
            {!isReply && (
              <button
                className="text-slate-400 hover:text-brand text-[10px] mono-text font-bold uppercase"
                onClick={() => {
                  setEditingComment(null);
                  setReplyTo(comment);
                }}
              >
                Reply
              </button>
            )}
            {isOwn && (
              <button
                className="text-slate-400 hover:text-brand text-[10px] mono-text font-bold uppercase"
                onClick={() => startEdit(comment)}
              >
                Edit
              </button>
            )}
          </div>
        </div>
        <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-wrap">{linkifyText(comment.body)}</p>
        {(comment.mentioned_species?.length > 0 || comment.mentioned_refs?.length > 0) && (
          <div className="flex flex-wrap items-center gap-1.5">
            {comment.mentioned_species?.map((speciesId) => {
              const mentioned = speciesById.get(speciesId);
              return (
                <button
                  key={speciesId}
                  onClick={() => onSelectSpecies?.(speciesId)}
                  className="text-[10px] mono-text italic text-brand hover:underline disabled:no-underline disabled:text-slate-400"
                  disabled={!onSelectSpecies}
                >
                  #{mentioned?.scientific_name ?? "Unknown species"}
                </button>
              );
            })}
            {comment.mentioned_refs?.map((ref) => (
              <button
                key={`${ref.kind}:${ref.key}`}
                onClick={() =>
                  ref.kind === "evidence_source" ? onSelectEvidence?.() : onSelectTaxonomyRef?.(ref.key)
                }
                className="text-[10px] mono-text italic text-brand hover:underline disabled:no-underline disabled:text-slate-400"
                disabled={ref.kind === "evidence_source" ? !onSelectEvidence : !onSelectTaxonomyRef}
              >
                #{ref.label}
              </button>
            ))}
          </div>
        )}
        {comment.attachments?.map((attachment, idx) => (
          <AttachmentLink key={idx} attachment={attachment} />
        ))}
        {!isReply && repliesByParent.get(comment.id)?.map((reply) => renderComment(reply, true))}
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-5">
        <span className="text-[10px] mono-text text-slate-400 font-bold uppercase self-end">
          {comments?.length ?? 0} comment{(comments?.length ?? 0) === 1 ? "" : "s"}
        </span>

        <div className="flex flex-col gap-5 divide-y divide-surface-dim">
          {isLoading && <p className="text-xs text-slate-400">Loading comments...</p>}
          {!isLoading && (comments?.length ?? 0) === 0 && (
            <p className="text-xs text-slate-400">No comments yet. Be the first to add one.</p>
          )}
          {topLevel.map((comment) => renderComment(comment, false))}
        </div>
      </div>

      <div className="p-3 border-t border-surface-dim bg-surface-container-low/30">
        <div className="flex flex-col gap-2">
          {(replyTo || editingComment) && (
            <div className="flex items-center justify-between bg-surface-container-low border border-surface-dim rounded-sm px-3 py-1.5 text-[10px] mono-text text-slate-500">
              <span>
                {editingComment ? (
                  "Editing message"
                ) : (
                  <>
                    Replying to{" "}
                    <span className="font-bold text-slate-700">{replyTo?.author?.full_name ?? "Unknown"}</span>
                  </>
                )}
              </span>
              <button onClick={resetComposer} className="text-slate-400 hover:text-brand">
                <span className="material-symbols-outlined text-[16px]">close</span>
              </button>
            </div>
          )}
          {pendingAttachments.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {pendingAttachments.map((attachment, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-2 bg-white border border-surface-dim rounded-sm px-2 py-1 text-[10px] mono-text text-slate-600"
                >
                  <span className="material-symbols-outlined text-[14px] text-slate-400">description</span>
                  <span className="truncate">{attachment.file_url.split("/").pop()}</span>
                  <button onClick={() => removePendingAttachment(idx)} className="ml-auto text-slate-400 hover:text-red-600">
                    <span className="material-symbols-outlined text-[14px]">close</span>
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="relative">
            <div className="flex items-end gap-1 border border-surface-dim rounded-sm bg-white p-1.5 focus-within:ring-1 focus-within:ring-brand focus-within:border-brand">
              <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileSelected} />
              <button
                className="p-1.5 text-slate-400 hover:text-brand rounded transition-all disabled:opacity-50 shrink-0"
                title="Attach file"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
              >
                <span className="material-symbols-outlined text-[20px]">
                  {uploading ? "hourglass_empty" : "attach_file"}
                </span>
              </button>
              <textarea
                ref={textareaRef}
                rows={1}
                className="flex-1 resize-none overflow-hidden text-xs p-1.5 bg-transparent focus:outline-none max-h-40"
                placeholder="Add a comment — @ to mention someone, # to tag a species, synonym, or evidence source"
                value={body}
                onChange={handleBodyChange}
                onSelect={handleBodySelect}
                onKeyDown={handleTextareaKeyDown}
                onClick={handleBodySelect}
                onBlur={() => setMentionMatch(null)}
              />
              <button
                className="p-1.5 text-slate-400 hover:text-brand rounded transition-all shrink-0"
                title="Mention someone (@) or tag a species/synonym/evidence source (#)"
                onClick={() => {
                  const cursor = textareaRef.current?.selectionStart ?? body.length;
                  const before = body.slice(0, cursor);
                  const after = body.slice(cursor);
                  const next = `${before}@${after}`;
                  setBody(next);
                  requestAnimationFrame(() => {
                    textareaRef.current?.focus();
                    textareaRef.current?.setSelectionRange(cursor + 1, cursor + 1);
                    updateMentionMatch(next, cursor + 1);
                  });
                }}
              >
                <span className="material-symbols-outlined text-[20px]">alternate_email</span>
              </button>
              <button
                className="p-1.5 text-brand hover:bg-surface-container-low rounded transition-all disabled:opacity-30 shrink-0"
                title="Send (Enter)"
                onClick={handleSubmit}
                disabled={
                  (!body.trim() && pendingAttachments.length === 0) || postComment.isPending || updateComment.isPending
                }
              >
                <span className="material-symbols-outlined text-[20px]">send</span>
              </button>
            </div>
            {mentionMatch && flatMentionOptions.length > 0 && (
              <div className="absolute bottom-full left-0 mb-1 w-72 max-h-52 overflow-y-auto bg-white border border-surface-dim rounded-sm shadow-hard z-10">
                {mentionSections.map((section) => {
                  return (
                    <div key={section.label ?? "default"}>
                      {section.label && (
                        <div className="px-3 pt-2 pb-1 text-[9px] mono-text uppercase font-bold text-slate-400">
                          {section.label}
                        </div>
                      )}
                      {section.options.map((option) => {
                        const globalIndex = flatMentionOptions.indexOf(option);
                        return (
                          <button
                            key={option.id}
                            type="button"
                            className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 ${
                              globalIndex === highlightedIndex ? "bg-surface-container-low" : "hover:bg-surface-container-low"
                            }`}
                            onMouseEnter={() => setHighlightedIndex(globalIndex)}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              applyMentionOption(option);
                            }}
                          >
                            <span className="material-symbols-outlined text-[14px] text-slate-400">{option.icon}</span>
                            <span className="flex flex-col">
                              <span className={option.userId ? "" : "italic mono-text"}>{option.label}</span>
                              {option.sublabel && <span className="text-[10px] text-slate-400">{option.sublabel}</span>}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
