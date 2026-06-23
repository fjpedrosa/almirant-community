import { useCallback, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { format } from "date-fns";
import useFormattedDate from "@/domains/shared/application/hooks/use-formatted-date";
import { CalendarDays, CheckSquare, Clock, ChevronDown, FolderOpen, Loader2, Pencil, Tag, User, X, Check } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { IdeaTagChips } from "@/domains/ideas/presentation/components/idea-tag-chips";
import { InlineTitle } from "@/domains/shared/presentation/components/inline-title";
import { MarkdownPreview } from "@/domains/shared/presentation/components/markdown-preview";
import { UnifiedCommentSection } from "@/domains/shared/presentation/components/unified-comment-section";
import type { UnifiedComment } from "@/domains/shared/presentation/components/unified-comment-section";
import type { MentionMember } from "@/domains/shared/domain/types";
import { cn } from "@/lib/utils";
import type {
  TodoCommentsSectionProps,
  TodoDetailPanelProps,
  TodoItemComment,
  TodoItemEvent,
  TodoItemPriority,
  TodoItemStatus,
  TodoItemTag,
  TodoItemWithRelations,
} from "../../domain/types";
import { TODO_STATUS_COLORS } from "./todo-status-badge";
import { TODO_PRIORITY_COLORS } from "./todo-priority-badge";

// --- Utilities ---

const getInitials = (name: string) =>
  name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);


// --- Sub-components ---

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

// --- Inline Status ---

interface InlineStatusBadgeProps {
  value: TodoItemStatus;
  onChange: (status: TodoItemStatus) => void;
  isLoading?: boolean;
  t: ReturnType<typeof useTranslations<"todos">>;
}

const TODO_STATUSES: TodoItemStatus[] = ["pending", "in_progress", "done", "blocked"];

const InlineStatusBadge: React.FC<InlineStatusBadgeProps> = ({
  value,
  onChange,
  isLoading = false,
  t,
}) => {
  const getStatusLabel = (status: TodoItemStatus) => t(`status.${status}`);

  if (isLoading) {
    return (
      <Badge variant="outline" className="cursor-default">
        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
        {getStatusLabel(value)}
      </Badge>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="rounded-md transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Badge variant="outline" className={cn("cursor-pointer", TODO_STATUS_COLORS[value])}>
            {getStatusLabel(value)}
          </Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-40 p-1" align="start">
        {TODO_STATUSES.map((status) => (
          <button
            key={status}
            type="button"
            className={cn(
              "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-accent",
              status === value && "bg-accent/50",
            )}
            onClick={() => onChange(status)}
          >
            <span className={cn("inline-flex h-2 w-2 rounded-full", TODO_STATUS_COLORS[status].split(" ")[0])} />
            {getStatusLabel(status)}
            {status === value && <Check className="ml-auto h-3.5 w-3.5 text-primary" />}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
};

// --- Inline Priority ---

interface InlinePriorityBadgeProps {
  value: TodoItemPriority | null;
  onChange: (priority: TodoItemPriority) => void;
  isLoading?: boolean;
  t: ReturnType<typeof useTranslations<"todos">>;
}

const TODO_PRIORITIES: TodoItemPriority[] = ["low", "medium", "high", "urgent"];

const InlinePriorityBadge: React.FC<InlinePriorityBadgeProps> = ({
  value,
  onChange,
  isLoading = false,
  t,
}) => {
  const getPriorityLabel = (priority: TodoItemPriority) => t(`priority.${priority}`);
  const noPriorityLabel = t("priority.noPriority");

  if (isLoading) {
    return (
      <Badge variant="outline" className="cursor-default">
        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
        {value ? getPriorityLabel(value) : noPriorityLabel}
      </Badge>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="rounded-md transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Badge
            variant="outline"
            className={cn(
              "cursor-pointer",
              value ? TODO_PRIORITY_COLORS[value] : "bg-muted text-muted-foreground",
            )}
          >
            {value ? getPriorityLabel(value) : noPriorityLabel}
          </Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-40 p-1" align="start">
        {TODO_PRIORITIES.map((priority) => (
          <button
            key={priority}
            type="button"
            className={cn(
              "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-accent",
              priority === value && "bg-accent/50",
            )}
            onClick={() => onChange(priority)}
          >
            <span className={cn("inline-flex h-2 w-2 rounded-full", TODO_PRIORITY_COLORS[priority].split(" ")[0])} />
            {getPriorityLabel(priority)}
            {priority === value && <Check className="ml-auto h-3.5 w-3.5 text-primary" />}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
};

// --- Inline Owner ---

interface InlineOwnerProps {
  currentOwnerId: string | null;
  members: Array<{ id: string; name: string; email: string; image?: string | null }>;
  onChange: (userId: string) => void;
  isLoading?: boolean;
  t: ReturnType<typeof useTranslations<"todos.detail">>;
}

const InlineOwner: React.FC<InlineOwnerProps> = ({
  currentOwnerId,
  members,
  onChange,
  isLoading = false,
  t,
}) => {
  const currentOwner = currentOwnerId ? members.find((m) => m.id === currentOwnerId) : null;

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-md px-1.5 py-1">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        {currentOwner ? (
          <button
            type="button"
            className="flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Avatar className="h-6 w-6">
              <AvatarImage src={currentOwner.image ?? undefined} alt={currentOwner.name} />
              <AvatarFallback className="text-[10px]">{getInitials(currentOwner.name)}</AvatarFallback>
            </Avatar>
            <span className="text-sm">{currentOwner.name}</span>
          </button>
        ) : (
          <button
            type="button"
            className="flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className="flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-muted-foreground/40 text-muted-foreground/60">
              <User className="h-3 w-3" />
            </div>
            <span className="text-sm text-muted-foreground">{t("unassigned")}</span>
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start" onClick={(e) => e.stopPropagation()}>
        <Command>
          <CommandInput placeholder={t("searchMember")} />
          <CommandList>
            <CommandEmpty>{t("noMembersFound")}</CommandEmpty>
            <CommandGroup>
              {members.map((member) => (
                <CommandItem key={member.id} onSelect={() => onChange(member.id)} className="flex items-center gap-2">
                  <Avatar className="h-6 w-6 shrink-0">
                    {member.image && <AvatarImage src={member.image} alt={member.name} />}
                    <AvatarFallback className="text-[10px]">{getInitials(member.name)}</AvatarFallback>
                  </Avatar>
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm">{member.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{member.email}</span>
                  </div>
                  {member.id === currentOwnerId && <Check className="ml-auto h-4 w-4 shrink-0 text-primary" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

// --- Inline Date ---

interface InlineDateProps {
  value: string | null;
  onChange: (date: string | null) => void;
  isLoading?: boolean;
  t: ReturnType<typeof useTranslations<"todos.detail">>;
}

const parseDate = (value: string | null): Date | undefined => {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
};

const InlineDate: React.FC<InlineDateProps> = ({ value, onChange, isLoading = false, t }) => {
  const { formatShort, locale } = useFormattedDate();
  
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-md px-1.5 py-1">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex items-center gap-2 rounded-md px-1.5 py-1 text-sm transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            !value && "text-muted-foreground",
          )}
        >
          <CalendarDays className="h-4 w-4 text-muted-foreground" />
          {value ? formatShort(value) : t("noDate")}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={parseDate(value)}
          onSelect={(date: Date | undefined) => onChange(date ? format(date, "yyyy-MM-dd") : null)}
          locale={locale}
        />
        {value && (
          <div className="border-t p-2">
            <Button variant="ghost" size="sm" className="w-full text-muted-foreground" onClick={() => onChange(null)}>
              <X className="mr-1.5 h-3.5 w-3.5" />
              {t("clearDate")}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
};

// --- Inline Project ---

interface InlineProjectProps {
  currentProjectId: string | null;
  currentProjectName: string | null;
  projects: Array<{ id: string; name: string }>;
  onChange: (projectId: string | null) => void;
  isLoading?: boolean;
  t: ReturnType<typeof useTranslations<"todos.detail">>;
}

const InlineProject: React.FC<InlineProjectProps> = ({
  currentProjectId,
  currentProjectName,
  projects,
  onChange,
  isLoading = false,
  t,
}) => {
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-md px-1.5 py-1">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex items-center gap-2 rounded-md px-1.5 py-1 text-sm transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            !currentProjectId && "text-muted-foreground",
          )}
        >
          <FolderOpen className="h-4 w-4 text-muted-foreground" />
          {currentProjectName ?? t("noProject")}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start" onClick={(e) => e.stopPropagation()}>
        <Command>
          <CommandInput placeholder={t("searchProject")} />
          <CommandList>
            <CommandEmpty>{t("noProjectsFound")}</CommandEmpty>
            <CommandGroup>
              <CommandItem onSelect={() => onChange(null)}>
                <span className="text-muted-foreground">{t("noProject")}</span>
                {!currentProjectId && <Check className="ml-auto h-4 w-4 shrink-0 text-primary" />}
              </CommandItem>
              {projects.map((project) => (
                <CommandItem key={project.id} onSelect={() => onChange(project.id)}>
                  {project.name}
                  {project.id === currentProjectId && <Check className="ml-auto h-4 w-4 shrink-0 text-primary" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

// --- Sticky Header ---

interface StickyHeaderProps {
  item: TodoItemWithRelations;
  savingField: string | null;
  onStatusChange: (status: TodoItemStatus) => void;
  onPriorityChange: (priority: TodoItemPriority) => void;
  onTitleChange: (title: string) => void;
  t: ReturnType<typeof useTranslations<"todos">>;
}

const StickyHeader: React.FC<StickyHeaderProps> = ({
  item,
  savingField,
  onStatusChange,
  onPriorityChange,
  onTitleChange,
  t,
}) => (
  <SheetHeader className="shrink-0 border-b p-4 pr-12">
    <div className="flex items-center gap-2">
      <CheckSquare className="h-4 w-4 text-slate-400" />
      <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-600">
        {t("todoLabel")}
      </Badge>
    </div>

    <div className="mt-2">
      <InlineTitle
        value={item.title}
        onChange={onTitleChange}
        isLoading={savingField === "title"}
      />
    </div>

    <div className="mt-1 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
      <InlineStatusBadge
        value={item.status}
        onChange={onStatusChange}
        isLoading={savingField === "status"}
        t={t}
      />
      <InlinePriorityBadge
        value={item.priority}
        onChange={onPriorityChange}
        isLoading={savingField === "priority"}
        t={t}
      />
    </div>
  </SheetHeader>
);

// --- Tags Section ---

interface TagsSectionProps {
  tags: TodoItemTag[];
  availableTags: TodoItemTag[];
  onAddTag?: (data: { tagId?: string; name?: string; color?: string }) => void;
  onRemoveTag?: (tagId: string) => void;
  t: ReturnType<typeof useTranslations<"todos.detail">>;
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
        {t("tags")}
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
      <span className="text-xs text-muted-foreground italic">{t("noTags")}</span>
    )}
  </div>
);

// --- Metadata Sidebar ---

interface MetadataSidebarProps {
  item: TodoItemWithRelations;
  savingField: string | null;
  members: Array<{ id: string; name: string; email: string; image?: string | null }>;
  projects: Array<{ id: string; name: string }>;
  availableTags?: TodoItemTag[];
  onOwnerChange: (userId: string) => void;
  onDueDateChange: (date: string | null) => void;
  onProjectChange: (projectId: string | null) => void;
  onAddTag?: (data: { tagId?: string; name?: string; color?: string }) => void;
  onRemoveTag?: (tagId: string) => void;
  t: ReturnType<typeof useTranslations<"todos.detail">>;
}

const MetadataSidebar: React.FC<MetadataSidebarProps> = ({
  item,
  savingField,
  members,
  projects,
  availableTags,
  onOwnerChange,
  onDueDateChange,
  onProjectChange,
  onAddTag,
  onRemoveTag,
  t,
}) => {
  const { formatDateTime } = useFormattedDate();

  return (
  <div className="rounded-lg border bg-muted/30 px-4 py-2">
    <MetaField label={t("owner")}>
      <InlineOwner
        currentOwnerId={item.ownerUserId}
        members={members}
        onChange={onOwnerChange}
        isLoading={savingField === "owner"}
        t={t}
      />
    </MetaField>
    <Separator />
    <MetaField label={t("project")}>
      <InlineProject
        currentProjectId={item.projectId}
        currentProjectName={item.projectName}
        projects={projects}
        onChange={onProjectChange}
        isLoading={savingField === "project"}
        t={t}
      />
    </MetaField>
    <Separator />
    <MetaField label={t("dueDate")}>
      <InlineDate
        value={item.dueDate}
        onChange={onDueDateChange}
        isLoading={savingField === "dueDate"}
        t={t}
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
    <MetaField label={t("createdBy")}>
      {item.createdBy ? (
        <div className="flex items-center gap-2">
          <Avatar className="h-5 w-5">
            <AvatarImage src={item.createdBy.image ?? undefined} alt={item.createdBy.name} />
            <AvatarFallback className="text-[10px]">{getInitials(item.createdBy.name)}</AvatarFallback>
          </Avatar>
          <span className="text-sm">{item.createdBy.name}</span>
        </div>
      ) : (
        <span className="text-sm text-muted-foreground">&mdash;</span>
      )}
    </MetaField>
    <Separator />
    <div className="py-1.5 text-xs text-muted-foreground space-y-0.5">
      <p>{t("createdAt")} {formatDateTime(item.createdAt)}</p>
      <p>{t("updatedAt")} {formatDateTime(item.updatedAt)}</p>
    </div>
  </div>
  );
};

// --- Description Block ---

interface DescriptionBlockProps {
  description: string | null;
  onDescriptionChange: (description: string | null) => void;
  isLoading?: boolean;
  t: ReturnType<typeof useTranslations<"todos.detail">>;
}

interface InlineDescriptionProps {
  value: string | null;
  onChange: (description: string | null) => void;
  isLoading?: boolean;
  t: ReturnType<typeof useTranslations<"todos.detail">>;
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
        <span className="text-sm text-muted-foreground">{t("savingDescription")}</span>
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
            {t("cancel")}
          </Button>
          <Button size="sm" onClick={handleSave}>
            {t("save")}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">{t("saveHint")}</p>
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
        <p className="text-sm text-muted-foreground italic">{t("writeDescription")}</p>
      )}
      <Pencil className="absolute right-2 top-2 h-3.5 w-3.5 text-muted-foreground touch-visible" />
    </button>
  );
};

const DescriptionBlock: React.FC<DescriptionBlockProps> = ({
  description,
  onDescriptionChange,
  isLoading = false,
  t,
}) => (
  <div className="space-y-1.5">
    <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
      {t("description")}
    </h3>
    <InlineDescription
      value={description}
      onChange={onDescriptionChange}
      isLoading={isLoading}
      t={t}
    />
  </div>
);

// --- History Section ---

const prettyFieldName = (fieldName: string | null, t: ReturnType<typeof useTranslations<"todos.detail">>): string => {
  if (!fieldName) return "item";
  const knownFields = ["projectId", "status", "priority", "title", "description", "ownerUserId", "dueDate", "metadata"] as const;
  if (knownFields.includes(fieldName as typeof knownFields[number])) {
    return t(`fieldNames.${fieldName}` as Parameters<typeof t>[0]);
  }
  return fieldName;
};

const normalizeValue = (value: string | null, t: ReturnType<typeof useTranslations<"todos.detail">>): string => {
  if (value === null || value === "") return t("emptyValue");
  if (value.length <= 100) return value;
  return `${value.slice(0, 100)}...`;
};

const resolveHistoryFieldValue = (
  fieldName: string | null,
  value: string | null,
  members: Array<{ id: string; name: string }>,
  projects: Array<{ id: string; name: string }>,
  t: ReturnType<typeof useTranslations<"todos.detail">>
): string => {
  const normalized = normalizeValue(value, t);
  if (!fieldName || normalized === t("emptyValue")) return normalized;

  if (fieldName === "ownerUserId") {
    return members.find((member) => member.id === value)?.name ?? normalized;
  }

  if (fieldName === "projectId") {
    return projects.find((project) => project.id === value)?.name ?? normalized;
  }

  return normalized;
};

const renderEventMessage = (
  event: TodoItemEvent,
  members: Array<{ id: string; name: string }>,
  projects: Array<{ id: string; name: string }>,
  t: ReturnType<typeof useTranslations<"todos.detail">>
): string => {
  if (event.eventType === "created") return t("todoCreated");
  if (event.eventType === "updated") {
    const field = prettyFieldName(event.fieldName, t);
    const oldValue = resolveHistoryFieldValue(event.fieldName, event.oldValue, members, projects, t);
    const newValue = resolveHistoryFieldValue(event.fieldName, event.newValue, members, projects, t);
    return `${field}: ${oldValue} -> ${newValue}`;
  }
  return event.eventType;
};

interface HistorySectionProps {
  events: TodoItemEvent[];
  isLoading: boolean;
  members: Array<{ id: string; name: string }>;
  projects: Array<{ id: string; name: string }>;
  t: ReturnType<typeof useTranslations<"todos.detail">>;
}

const HistorySection: React.FC<HistorySectionProps> = ({
  events,
  isLoading,
  members,
  projects,
  t,
}) => {
  const { formatDateTime } = useFormattedDate();
  const count = events.length;

  return (
    <Collapsible defaultOpen={false}>
      <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-muted/50 [&[data-state=open]>svg:last-child]:rotate-180">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground" />
          {t("history")} {count > 0 && `(${count})`}
        </div>
        <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="px-3 pb-2 pt-1">
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : count === 0 ? (
            <p className="py-3 text-center text-sm text-muted-foreground">
              {t("noHistory")}
            </p>
          ) : (
            <div className="relative ml-2 border-l-2 border-muted pl-4">
              {events.map((event) => (
                <div key={event.id} className="relative pb-4 last:pb-0">
                  <div className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full border-2 border-background bg-muted-foreground/40" />
                  <p className="text-sm">{renderEventMessage(event, members, projects, t)}</p>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{event.triggeredByUserName ?? event.triggeredByUserEmail ?? event.triggeredBy}</span>
                    <span>-</span>
                    <span>{formatDateTime(event.createdAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};

// --- Comments Section ---

interface CommentsSectionWrapperProps {
  commentsProps: TodoCommentsSectionProps | undefined;
  members: MentionMember[];
}

const CommentsSectionWrapper: React.FC<CommentsSectionWrapperProps> = ({ commentsProps, members }) => {
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
      members={members}
      onAddComment={commentsProps.onAddComment}
      onDeleteComment={commentsProps.onDeleteComment}
      onNewCommentChange={commentsProps.onNewCommentChange}
      onStartEdit={(c) => commentsProps.onStartEdit(c as unknown as TodoItemComment)}
      onCancelEdit={commentsProps.onCancelEdit}
      onSaveEdit={commentsProps.onSaveEdit}
      onEditContentChange={commentsProps.onEditContentChange}
      onImageUpload={commentsProps.onImageUpload}
      onFileUpload={commentsProps.onFileUpload}
    />
  );
};

// --- Main Detail Panel ---

export const TodoDetailPanel: React.FC<TodoDetailPanelProps> = ({
  open,
  onOpenChange,
  item,
  history,
  isLoading,
  isHistoryLoading,
  projects,
  members,
  commentsProps,
  savingField,
  availableTags,
  onStatusChange,
  onPriorityChange,
  onOwnerChange,
  onDueDateChange,
  onTitleChange,
  onDescriptionChange,
  onProjectChange,
  onAddTag,
  onRemoveTag,
}) => {
  const t = useTranslations("todos");
  const td = useTranslations("todos.detail");

  const mentionMembers: MentionMember[] = members.map((member) => ({
    id: member.id,
    name: member.name,
    email: member.email,
    image: member.image ?? null,
  }));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl p-0 flex flex-col">
        <SheetTitle className="sr-only">{item?.title ?? td("sheetTitle")}</SheetTitle>
        <SheetDescription className="sr-only">
          {td("sheetDescription")}
        </SheetDescription>
        {isLoading || !item ? (
          <DetailSkeleton />
        ) : (
          <>
            <StickyHeader
              item={item}
              savingField={savingField ?? null}
              onStatusChange={onStatusChange}
              onPriorityChange={onPriorityChange}
              onTitleChange={onTitleChange}
              t={t}
            />

            <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col">
              <ScrollArea className={commentsProps ? "flex-1 basis-0 min-h-0 w-full min-w-0" : "flex-1 min-h-0 w-full min-w-0"}>
                <div className="space-y-5 p-6">
                  <MetadataSidebar
                    item={item}
                    savingField={savingField ?? null}
                    members={members}
                    projects={projects}
                    availableTags={availableTags}
                    onOwnerChange={onOwnerChange}
                    onDueDateChange={onDueDateChange}
                    onProjectChange={onProjectChange}
                    onAddTag={onAddTag}
                    onRemoveTag={onRemoveTag}
                    t={td}
                  />

                  <DescriptionBlock
                    description={item.description}
                    onDescriptionChange={onDescriptionChange}
                    isLoading={savingField === "description"}
                    t={td}
                  />

                  <Separator />

                  <HistorySection
                    events={history}
                    isLoading={isHistoryLoading}
                    members={members.map((member) => ({ id: member.id, name: member.name || member.email }))}
                    projects={projects}
                    t={td}
                  />
                </div>
              </ScrollArea>

              {commentsProps && (
                <div className="flex min-h-0 w-full min-w-0 flex-1 basis-0 overflow-hidden border-t bg-background">
                  <CommentsSectionWrapper commentsProps={commentsProps} members={mentionMembers} />
                </div>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
};
