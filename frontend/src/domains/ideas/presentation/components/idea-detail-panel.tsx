"use client";

import { useCallback, useRef, useState } from "react";
import { ArrowUpRight, Lightbulb, Loader2, Pencil, Tag } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { MarkdownPreview } from "@/domains/shared/presentation/components/markdown-preview";
import { UnifiedCommentSection } from "@/domains/shared/presentation/components/unified-comment-section";
import type { UnifiedComment } from "@/domains/shared/presentation/components/unified-comment-section";
import { IdeaHistorySection } from "./idea-history-section";
import { IdeaInlineOwner } from "./idea-inline-owner";
import { IdeaInlineProject } from "./idea-inline-project";
import { IdeaInlineStatus } from "./idea-inline-status";
import { InlineTitle } from "@/domains/shared/presentation/components/inline-title";
import { IdeaTagChips } from "./idea-tag-chips";
import { IdeaTraceabilitySection } from "./idea-traceability-section";
import useFormattedDate from "@/domains/shared/application/hooks/use-formatted-date";
import type {
  IdeaCommentsSectionProps,
  IdeaDetailPanelProps,
  IdeaItemStatus,
  IdeaItemTag,
  IdeaItemWithRelations,
} from "../../domain/types";

const TypeIcon: React.FC<{ type: "idea" }> = () => (
  <Lightbulb className="h-4 w-4 text-violet-500" />
);

const DetailSkeleton = () => (
  <div className="space-y-4 p-6">
    <Skeleton className="h-7 w-2/3" />
    <div className="flex gap-3">
      <Skeleton className="h-6 w-20 rounded-full" />
      <Skeleton className="h-6 w-24 rounded-full" />
    </div>
    <Skeleton className="h-32 w-full" />
    <Skeleton className="h-20 w-full" />
  </div>
);

interface MetaFieldProps {
  label: string;
  children: React.ReactNode;
}

const MetaField: React.FC<MetaFieldProps> = ({ label, children }) => (
  <div className="flex items-center justify-between gap-2 py-1.5">
    <span className="text-xs font-medium text-muted-foreground">{label}</span>
    <div onClick={(e) => e.stopPropagation()}>{children}</div>
  </div>
);

interface StickyHeaderProps {
  item: IdeaItemWithRelations;
  savingField: string | null;
  onStatusChange: (status: IdeaItemStatus) => void;
  onPromote: (item: IdeaItemWithRelations) => void;
  onTitleChange: (title: string) => void;
  t: ReturnType<typeof useTranslations<"ideas">>;
}

const StickyHeader: React.FC<StickyHeaderProps> = ({
  item,
  savingField,
  onStatusChange,
  onPromote,
  onTitleChange,
  t,
}) => (
  <SheetHeader className="shrink-0 border-b p-4 pr-12">
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-center gap-2">
        <TypeIcon type={item.type} />
        <Badge
          variant="outline"
          className="border-violet-200 bg-violet-50 text-violet-700"
        >
          {t(`types.${item.type}`)}
        </Badge>
      </div>
      <Button size="sm" variant="outline" onClick={() => onPromote(item)}>
        <ArrowUpRight className="mr-1 h-4 w-4" />
        {t("detail.promote")}
      </Button>
    </div>

    <div className="mt-2">
      <SheetTitle className="sr-only">{item.title}</SheetTitle>
      <InlineTitle
        value={item.title}
        onChange={onTitleChange}
        isLoading={savingField === "title"}
      />
    </div>

    <div className="mt-1" onClick={(e) => e.stopPropagation()}>
      <IdeaInlineStatus
        value={item.status}
        type={item.type}
        onChange={onStatusChange}
        isLoading={savingField === "status"}
      />
    </div>
  </SheetHeader>
);

interface TagsSectionProps {
  tags: IdeaItemTag[];
  availableTags: IdeaItemTag[];
  onAddTag?: (data: { tagId?: string; name?: string; color?: string }) => void;
  onRemoveTag?: (tagId: string) => void;
  t: ReturnType<typeof useTranslations<"ideas">>;
}

const TagsSection: React.FC<TagsSectionProps> = ({
  tags,
  availableTags,
  onAddTag,
  onRemoveTag,
  t,
}) => (
  <div className="py-1.5">
    <div className="flex items-center justify-between mb-1.5">
      <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
        <Tag className="h-3 w-3" />
        {t("detail.tags")}
      </span>
    </div>
    {onAddTag && onRemoveTag ? (
      <IdeaTagChips
        tags={tags}
        availableTags={availableTags}
        onAddTag={onAddTag}
        onRemoveTag={onRemoveTag}
      />
    ) : tags.length > 0 ? (
      <IdeaTagChips
        tags={tags}
        availableTags={[]}
        onAddTag={() => {}}
        onRemoveTag={() => {}}
        isCompact
      />
    ) : (
      <span className="text-xs text-muted-foreground italic">{t("detail.noTags")}</span>
    )}
  </div>
);

interface MetadataSidebarProps {
  item: IdeaItemWithRelations;
  savingField: string | null;
  formatDateTimeValue: (value: string | null | undefined) => string;
  members: Array<{ id: string; name: string; email: string; image?: string | null }>;
  projects: Array<{ id: string; name: string }>;
  availableTags?: IdeaItemTag[];
  onOwnerChange: (userId: string) => void;
  onProjectChange: (projectId: string | null) => void;
  onDiscussedToggle?: (item: IdeaItemWithRelations) => void;
  onAddTag?: (data: { tagId?: string; name?: string; color?: string }) => void;
  onRemoveTag?: (tagId: string) => void;
  t: ReturnType<typeof useTranslations<"ideas">>;
}

const MetadataSidebar: React.FC<MetadataSidebarProps> = ({
  item,
  savingField,
  formatDateTimeValue,
  members,
  projects,
  availableTags,
  onOwnerChange,
  onProjectChange,
  onDiscussedToggle,
  onAddTag,
  onRemoveTag,
  t,
}) => (
  <div className="rounded-lg border bg-muted/30 px-4 py-2">
    <MetaField label={t("detail.owner")}>
      <IdeaInlineOwner
        currentOwnerId={item.ownerUserId}
        members={members}
        onChange={onOwnerChange}
        isLoading={savingField === "owner"}
      />
    </MetaField>
    <Separator />
    <MetaField label={t("detail.project")}>
      <IdeaInlineProject
        currentProjectId={item.projectId}
        currentProjectName={item.projectName}
        projects={projects}
        onChange={onProjectChange}
        isLoading={savingField === "project"}
      />
    </MetaField>
    <Separator />
    <MetaField label={t("detail.createdBy")}>
      {item.createdBy ? (
        <div className="flex items-center gap-2">
          <Avatar className="h-5 w-5">
            <AvatarImage
              src={item.createdBy.image ?? undefined}
              alt={item.createdBy.name}
            />
            <AvatarFallback className="text-[10px]">
              {item.createdBy.name
                ?.split(" ")
                .map((n) => n[0])
                .join("")
                .slice(0, 2)
                .toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <span className="text-sm">{item.createdBy.name}</span>
        </div>
      ) : (
        <span className="text-sm text-muted-foreground">&mdash;</span>
      )}
    </MetaField>
    <Separator />
    <MetaField label={t("detail.discussed")}>
      <Checkbox
        checked={item.discussed}
        onCheckedChange={() => onDiscussedToggle?.(item)}
        aria-label={
          item.discussed
            ? t("detail.markAsNotDiscussed")
            : t("detail.markAsDiscussed")
        }
      />
    </MetaField>
    <Separator />
    <TagsSection
      tags={item.tags ?? []}
      availableTags={availableTags ?? []}
      onAddTag={onAddTag}
      onRemoveTag={onRemoveTag}
      t={t}
    />
    <Separator />
    <div className="py-1.5 text-xs text-muted-foreground space-y-0.5">
      <p>{t("detail.createdAt", { date: formatDateTimeValue(item.createdAt) })}</p>
      <p>{t("detail.updatedAt", { date: formatDateTimeValue(item.updatedAt) })}</p>
    </div>
  </div>
);

// --- Inline Description ---

interface InlineDescriptionProps {
  value: string | null;
  onChange: (description: string | null) => void;
  isLoading?: boolean;
  t: ReturnType<typeof useTranslations<"ideas">>;
}

const InlineDescription: React.FC<InlineDescriptionProps> = ({
  value,
  onChange,
  isLoading = false,
  t,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(el.scrollHeight, 120)}px`;
  }, []);

  const handleStartEdit = () => {
    setDraft(value ?? "");
    setIsEditing(true);
    requestAnimationFrame(() => {
      adjustHeight();
      textareaRef.current?.focus();
    });
  };

  const handleSave = () => {
    const normalizedDraft = draft.trim();
    const normalizedCurrent = value?.trim() ?? "";
    if (normalizedDraft !== normalizedCurrent) {
      onChange(normalizedDraft.length > 0 ? normalizedDraft : null);
    }
    setIsEditing(false);
  };

  const handleCancel = () => {
    setDraft(value ?? "");
    setIsEditing(false);
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      handleSave();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      handleCancel();
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-dashed bg-muted/20 px-3 py-2">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        <span className="text-sm text-muted-foreground">{t("detail.savingDescription")}</span>
      </div>
    );
  }

  if (isEditing) {
    return (
      <div className="space-y-2">
        <Textarea
          ref={textareaRef}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            adjustHeight();
          }}
          onKeyDown={handleKeyDown}
          rows={5}
          className="min-h-[120px] resize-y"
        />
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={handleCancel}>
            {t("detail.cancel")}
          </Button>
          <Button size="sm" onClick={handleSave}>
            {t("detail.save")}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">{t("detail.keyboardHint")}</p>
      </div>
    );
  }

  return (
    <button
      type="button"
      className="group group/desc relative w-full rounded-md border border-dashed px-3 py-2 text-left transition-colors hover:bg-muted/40"
      onClick={handleStartEdit}
    >
      {value ? (
        <MarkdownPreview content={value} size="sm" />
      ) : (
        <p className="text-sm text-muted-foreground italic">{t("detail.writeDescription")}</p>
      )}
      <Pencil className="absolute right-2 top-2 h-3.5 w-3.5 text-muted-foreground touch-visible" />
    </button>
  );
};

interface DescriptionBlockProps {
  description: string | null;
  onDescriptionChange: (description: string | null) => void;
  isLoading?: boolean;
  t: ReturnType<typeof useTranslations<"ideas">>;
}

const DescriptionBlock: React.FC<DescriptionBlockProps> = ({
  description,
  onDescriptionChange,
  isLoading = false,
  t,
}) => (
  <div className="space-y-1.5">
    <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
      {t("detail.description")}
    </h3>
    <InlineDescription
      value={description}
      onChange={onDescriptionChange}
      isLoading={isLoading}
      t={t}
    />
  </div>
);

interface CommentsSectionWrapperProps {
  commentsProps: IdeaCommentsSectionProps | undefined;
}

const CommentsSectionWrapper: React.FC<CommentsSectionWrapperProps> = ({
  commentsProps,
}) => {
  if (!commentsProps) return null;

  const unifiedComments: UnifiedComment[] = commentsProps.comments as unknown as UnifiedComment[];

  return (
    <UnifiedCommentSection
      comments={unifiedComments}
      isLoading={commentsProps.isLoading}
      currentUserId={commentsProps.currentUserId}
      isAdding={commentsProps.isAdding}
      newCommentValue={commentsProps.newCommentValue}
      editingId={commentsProps.editingId}
      editContent={commentsProps.editContent}
      members={commentsProps.members}
      onAddComment={commentsProps.onAddComment}
      onDeleteComment={commentsProps.onDeleteComment}
      onNewCommentChange={commentsProps.onNewCommentChange}
      onStartEdit={(c) => commentsProps.onStartEdit(c as unknown as import("../../domain/types").IdeaItemComment)}
      onCancelEdit={commentsProps.onCancelEdit}
      onSaveEdit={commentsProps.onSaveEdit}
      onEditContentChange={commentsProps.onEditContentChange}
      onImageUpload={commentsProps.onImageUpload}
      onFileUpload={commentsProps.onFileUpload}
    />
  );
};

export const IdeaDetailPanel: React.FC<IdeaDetailPanelProps> = ({
  open,
  onOpenChange,
  item,
  traceability,
  history,
  isLoading,
  isTraceabilityLoading,
  isHistoryLoading,
  projects,
  members,
  availableTags,
  commentsProps,
  onPromote,
  onStatusChange,
  onOwnerChange,
  onDueDateChange: _onDueDateChange, // eslint-disable-line @typescript-eslint/no-unused-vars -- prop defined in IdeaDetailPanelProps; due-date editing not yet wired to MetadataSidebar
  onTitleChange,
  onDescriptionChange,
  onProjectChange,
  onDiscussedToggle,
  onAddTag,
  onRemoveTag,
  savingField,
}) => {
  const t = useTranslations("ideas");
  const { formatDateTime } = useFormattedDate();
  const formatDateTimeValue = useCallback(
    (value: string | null | undefined): string => {
      if (!value) return "-";
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return "-";
      return formatDateTime(date);
    },
    [formatDateTime]
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl p-0 flex flex-col">
        {/* Zone 1: Sticky header */}
        {isLoading || !item ? (
          <DetailSkeleton />
        ) : (
          <>
            <StickyHeader
              item={item}
              savingField={savingField ?? null}
              onStatusChange={onStatusChange}
              onPromote={onPromote}
              onTitleChange={onTitleChange}
              t={t}
            />

            <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col">
              {/* Zone 2: Scrollable content */}
              <ScrollArea className={commentsProps ? "flex-1 basis-0 min-h-0 w-full min-w-0" : "flex-1 min-h-0 w-full min-w-0"}>
                <div className="space-y-5 p-6">
                  {/* Metadata fields */}
                  <MetadataSidebar
                    item={item}
                    savingField={savingField ?? null}
                    formatDateTimeValue={formatDateTimeValue}
                    members={members}
                    projects={projects}
                    availableTags={availableTags}
                    onOwnerChange={onOwnerChange}
                    onProjectChange={onProjectChange}
                    onDiscussedToggle={onDiscussedToggle}
                    onAddTag={onAddTag}
                    onRemoveTag={onRemoveTag}
                    t={t}
                  />

                  {/* Description */}
                  <DescriptionBlock
                    description={item.description}
                    onDescriptionChange={onDescriptionChange}
                    isLoading={savingField === "description"}
                    t={t}
                  />

                  <Separator />

                  {/* Traceability (collapsible) */}
                  <IdeaTraceabilitySection
                    feedbackLinks={traceability?.feedbackLinks ?? []}
                    workItemLinks={traceability?.workItemLinks ?? []}
                    isLoading={isTraceabilityLoading}
                  />

                  {/* History (collapsible) */}
                  <IdeaHistorySection
                    events={history}
                    isLoading={isHistoryLoading}
                    members={members}
                    projects={projects}
                  />
                </div>
              </ScrollArea>

              {commentsProps && (
                <div className="flex min-h-0 w-full min-w-0 flex-1 basis-0 overflow-hidden border-t bg-background">
                  <CommentsSectionWrapper commentsProps={commentsProps} />
                </div>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
};
