"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, MessageCircle, Paperclip, Pencil, Send, Trash2 } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { hasVisibleContent } from "@/lib/comment-utils";
import { sanitizeCommentHtml } from "@/lib/sanitize-comment-html";
import { CommentContent } from "./comment-content";
import { FileDropZone } from "./file-drop-zone";
import { TiptapCommentEditor } from "./tiptap-comment-editor";
import type { MentionMember, TiptapCommentEditorRef } from "../../domain/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A comment with author info, agnostic of entity type (seed, todo, idea). */
interface UnifiedCommentAuthor {
  id: string;
  name: string;
  email: string;
  image?: string | null;
}

export interface UnifiedComment {
  id: string;
  userId: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  author?: UnifiedCommentAuthor;
  userName?: string | null;
  userEmail?: string | null;
  userImage?: string | null;
}

export interface UnifiedCommentSectionProps {
  /** Full list of comments for this entity. */
  comments: UnifiedComment[];
  /** Whether the comments are still being fetched. */
  isLoading: boolean;
  /** ID of the currently logged-in user (used to determine own-comment styling). */
  currentUserId: string | null;
  /** Whether a new comment is currently being submitted. */
  isAdding: boolean;
  /** Controlled value for the new-comment editor. */
  newCommentValue: string;
  /** ID of the comment currently being edited, or null. */
  editingId: string | null;
  /** Controlled value for the edit editor. */
  editContent: string;
  /** Team members available for @mentions. */
  members: MentionMember[];
  /** Submit the new comment using the controlled `newCommentValue`. */
  onAddComment: () => void;
  /** Delete a comment by ID. */
  onDeleteComment: (commentId: string) => void;
  /** Update the controlled new-comment value. */
  onNewCommentChange: (value: string) => void;
  /** Enter edit mode for the given comment. */
  onStartEdit: (comment: UnifiedComment) => void;
  /** Cancel edit mode. */
  onCancelEdit: () => void;
  /** Save the current edit. */
  onSaveEdit: () => void;
  /** Update the controlled edit value. */
  onEditContentChange: (value: string) => void;
  /** Upload an image and return its URL. */
  onImageUpload?: (file: File) => Promise<string>;
  /** Upload a file and return metadata. */
  onFileUpload?: (file: File) => Promise<{ url: string; fileName: string; mimeType: string }>;
  /** Message shown when there are no comments. */
  emptyMessage?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const getInitials = (name: string) =>
  name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

const getCommentAuthor = (comment: UnifiedComment, fallbackName: string): UnifiedCommentAuthor => ({
  id: comment.author?.id ?? comment.userId,
  name: comment.author?.name?.trim() || comment.userName?.trim() || fallbackName,
  email: comment.author?.email ?? comment.userEmail ?? "",
  image: comment.author?.image ?? comment.userImage ?? null,
});

interface FormatTimeStrings {
  now: string;
  minutesAgo: (count: number) => string;
  hoursAgo: (count: number) => string;
}

const formatTime = (value: string, strings: FormatTimeStrings) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return strings.now;
  if (diffMins < 60) return strings.minutesAgo(diffMins);
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return strings.hoursAgo(diffHours);
  return date.toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const CommentsSkeleton = () => (
  <div className="space-y-4 p-5">
    {Array.from({ length: 3 }).map((_, i) => (
      <div key={i} className="flex gap-3">
        <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-12 w-3/4 rounded-2xl" />
        </div>
      </div>
    ))}
  </div>
);

interface CommentBubbleProps {
  comment: UnifiedComment;
  isOwn: boolean;
  isEditing: boolean;
  editContent: string;
  members: MentionMember[];
  onStartEdit: (comment: UnifiedComment) => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onEditContentChange: (value: string) => void;
  onDelete: (commentId: string) => void;
  onImageUpload?: (file: File) => Promise<string>;
  translations: {
    editPlaceholder: string;
    cancel: string;
    save: string;
    edited: string;
    editAriaLabel: string;
    deleteAriaLabel: string;
    userFallback: string;
    formatTimeStrings: FormatTimeStrings;
  };
}

const CommentBubble: React.FC<CommentBubbleProps> = ({
  comment,
  isOwn,
  isEditing,
  editContent,
  members,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onEditContentChange,
  onDelete,
  onImageUpload,
  translations,
}) => {
  const isEdited =
    new Date(comment.updatedAt).getTime() - new Date(comment.createdAt).getTime() > 60000;
  const author = getCommentAuthor(comment, translations.userFallback);

  return (
    <div
      className={cn(
        "group group/bubble flex w-full min-w-0 items-start gap-3",
        isOwn && "flex-row-reverse",
      )}
    >
      <Avatar className="h-8 w-8 shrink-0">
        <AvatarImage
          src={author.image ?? undefined}
          alt={author.name}
        />
        <AvatarFallback className="text-xs">
          {getInitials(author.name)}
        </AvatarFallback>
      </Avatar>

      <div className={cn("min-w-0 max-w-[min(82%,42rem)] space-y-1.5", isOwn && "items-end")}>
        <div
          className={cn(
            "relative min-w-0 overflow-hidden rounded-2xl px-4 py-3 shadow-sm ring-1 ring-inset",
            isOwn
              ? "rounded-tr-sm bg-primary/12 ring-primary/15"
              : "rounded-tl-sm bg-muted/80 ring-border/70",
          )}
        >
          {isEditing ? (
            <div className="space-y-2">
              <TiptapCommentEditor
                value={editContent}
                onChange={onEditContentChange}
                onSubmit={onSaveEdit}
                members={members}
                placeholder={translations.editPlaceholder}
                onImageUpload={onImageUpload}
              />
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={onCancelEdit}>
                  {translations.cancel}
                </Button>
                <Button
                  size="sm"
                  onClick={onSaveEdit}
                  disabled={!hasVisibleContent(editContent)}
                >
                  {translations.save}
                </Button>
              </div>
            </div>
          ) : (
            <CommentContent html={sanitizeCommentHtml(comment.content)} />
          )}

          {isOwn && !isEditing && (
            <div className="absolute -top-2 right-0 flex items-center gap-0.5 touch-visible">
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 rounded-full bg-background shadow-sm"
                onClick={() => onStartEdit(comment)}
                aria-label={translations.editAriaLabel}
              >
                <Pencil className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 rounded-full bg-background shadow-sm text-destructive hover:text-destructive"
                onClick={() => onDelete(comment.id)}
                aria-label={translations.deleteAriaLabel}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          )}
        </div>

        <div
          className={cn(
            "flex items-center gap-1.5 px-2 text-xs text-muted-foreground",
            isOwn && "flex-row-reverse",
          )}
        >
          {!isOwn && <span className="font-medium">{author.name}</span>}
          <span>{formatTime(comment.createdAt, translations.formatTimeStrings)}</span>
          {isEdited && (
            <span className="italic">{translations.edited}</span>
          )}
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export const UnifiedCommentSection: React.FC<UnifiedCommentSectionProps> = ({
  comments,
  isLoading,
  currentUserId,
  isAdding,
  newCommentValue,
  editingId,
  editContent,
  members,
  onAddComment,
  onDeleteComment,
  onNewCommentChange,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onEditContentChange,
  onImageUpload,
  onFileUpload,
  emptyMessage,
}) => {
  const t = useTranslations("shared.comments");
  const tc = useTranslations("common");

  const resolvedEmptyMessage = emptyMessage ?? t("empty");

  const scrollRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(comments.length);
  const editorRef = useRef<TiptapCommentEditorRef>(null);
  const [isUploading, setIsUploading] = useState(false);
  const handleUploadingChange = useCallback((nextIsUploading: boolean) => {
    setIsUploading((current) => (current === nextIsUploading ? current : nextIsUploading));
  }, []);

  // Auto-scroll when a new comment is added
  useEffect(() => {
    if (comments.length > prevCountRef.current && scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
    prevCountRef.current = comments.length;
  }, [comments.length]);

  const handleSubmit = useCallback(() => {
    if (!hasVisibleContent(newCommentValue) || isAdding || isUploading) return;
    onAddComment();
  }, [newCommentValue, isAdding, isUploading, onAddComment]);

  const handleAttachClick = useCallback(() => {
    editorRef.current?.triggerFileUpload();
  }, []);

  const handleFilesDropped = useCallback(
    async (files: File[]) => {
      if (editorRef.current) {
        await editorRef.current.handleDroppedFiles(files);
        return;
      }

      const hasImageUploadFn = !!onImageUpload;
      const hasFileUploadFn = !!onFileUpload;
      if (!hasImageUploadFn && !hasFileUploadFn) return;
    },
    [onImageUpload, onFileUpload],
  );

  const sorted = [...comments].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  const bubbleTranslations = {
    editPlaceholder: t("editPlaceholder"),
    cancel: tc("cancel"),
    save: tc("save"),
    edited: t("edited"),
    editAriaLabel: t("editAriaLabel"),
    deleteAriaLabel: t("deleteAriaLabel"),
    userFallback: t("user"),
    formatTimeStrings: {
      now: t("timeNow"),
      minutesAgo: (count: number) => t("timeMinutes", { count }),
      hoursAgo: (count: number) => t("timeHours", { count }),
    },
  };

  if (isLoading) {
    return <CommentsSkeleton />;
  }

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 max-w-full flex-col overflow-x-hidden">
      {/* Comment list */}
      <div ref={scrollRef} className="min-w-0 flex-1 space-y-4 overflow-x-hidden overflow-y-auto px-4 py-4">
        {sorted.length === 0 ? (
          <div className="flex h-full min-h-[14rem] flex-col items-center justify-center py-12 text-muted-foreground">
            <MessageCircle className="mb-2 h-10 w-10 opacity-40" />
            <p className="text-sm">{resolvedEmptyMessage}</p>
          </div>
        ) : (
          sorted.map((comment) => (
            <CommentBubble
              key={comment.id}
              comment={comment}
              isOwn={comment.userId === currentUserId}
              isEditing={editingId === comment.id}
              editContent={editContent}
              members={members}
              onStartEdit={onStartEdit}
              onCancelEdit={onCancelEdit}
              onSaveEdit={onSaveEdit}
              onEditContentChange={onEditContentChange}
              onDelete={onDeleteComment}
              onImageUpload={onImageUpload}
              translations={bubbleTranslations}
            />
          ))
        )}
      </div>

      {/* Sticky input */}
      <FileDropZone
        onFilesDropped={handleFilesDropped}
        disabled={isAdding || isUploading || (!onImageUpload && !onFileUpload)}
      >
        <div className="w-full min-w-0 border-t bg-background px-4 py-4">
          <div className="flex w-full min-w-0 items-end gap-2 overflow-x-hidden">
            <div className="min-w-0 flex-1">
              <TiptapCommentEditor
                ref={editorRef}
                value={newCommentValue}
                onChange={onNewCommentChange}
                onSubmit={handleSubmit}
                members={members}
                placeholder={t("writePlaceholder")}
                disabled={isAdding}
                onImageUpload={onImageUpload}
                onFileUpload={onFileUpload}
                onUploadingChange={handleUploadingChange}
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-[38px] w-[38px] shrink-0"
              disabled={isAdding || isUploading}
              onClick={handleAttachClick}
              aria-label={t("attachFile")}
            >
              {isUploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Paperclip className="h-4 w-4" />
              )}
            </Button>
            <Button
              size="icon"
              className="h-[38px] w-[38px] shrink-0"
              disabled={!hasVisibleContent(newCommentValue) || isAdding || isUploading}
              onClick={handleSubmit}
              aria-label={t("sendComment")}
            >
              {isAdding ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
          <p
            className="mt-1 text-xs text-muted-foreground"
            dangerouslySetInnerHTML={{ __html: t.raw("mentionHint") }}
          />
        </div>
      </FileDropZone>
    </div>
  );
};
