"use client";

import { useCallback, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronsUp,
  FolderOpen,
  Loader2,
  MessageCircle,
  Pencil,
  Plus,
  Sprout,
  Tag,
  User,
  X,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTranslations } from "next-intl";
import { MarkdownPreview } from "@/domains/shared/presentation/components/markdown-preview";
import { InlineTitle } from "@/domains/shared/presentation/components/inline-title";
import useFormattedDate from "@/domains/shared/application/hooks/use-formatted-date";
import { cn } from "@/lib/utils";
import { SeedInlineStatus, getSeedSourceLabel } from "./seed-inline-status";
import { SeedTraceabilitySection } from "./seed-traceability-section";
import { SeedHistorySection } from "./seed-history-section";
import { SeedMaturityChecklist } from "./seed-maturity-checklist";
import { SeedMaturityBadge } from "./seed-maturity-badge";
import { UnifiedCommentSection } from "@/domains/shared/presentation/components/unified-comment-section";
import type { UnifiedComment } from "@/domains/shared/presentation/components/unified-comment-section";
import type { MentionMember } from "@/domains/shared/domain/types";
import type {
  SeedDetailSheetProps,
  SeedCommentsSectionProps,
} from "../../domain/types";
import type {
  SeedPriority,
  SeedTag,
  SeedWithRelations,
} from "@/domains/planning/domain/types";
import type { Priority } from "@/domains/work-items/domain/types";

// --- Priority config ---

const PRIORITY_ICON: Record<Priority, React.ElementType> = {
  low: ArrowDown,
  medium: ArrowRight,
  high: ArrowUp,
  urgent: ChevronsUp,
};

const PRIORITY_COLOR: Record<Priority, string> = {
  low: "text-slate-400",
  medium: "text-blue-500",
  high: "text-orange-500",
  urgent: "text-red-500",
};

const PRIORITY_KEYS: Priority[] = ["low", "medium", "high", "urgent"];

// --- Tag helpers ---

const PALETTE = [
  "#6366f1", "#8b5cf6", "#a855f7", "#d946ef", "#ec4899",
  "#f43f5e", "#ef4444", "#f97316", "#eab308", "#84cc16",
  "#22c55e", "#14b8a6", "#06b6d4", "#3b82f6", "#6d28d9",
];

const pickRandomColor = (): string =>
  PALETTE[Math.floor(Math.random() * PALETTE.length)];

const hexToRgba = (hex: string, alpha: number): string => {
  const clean = hex.replace("#", "");
  const r = Number.parseInt(clean.slice(0, 2), 16);
  const g = Number.parseInt(clean.slice(2, 4), 16);
  const b = Number.parseInt(clean.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
    return `rgba(100,100,100,${alpha})`;
  }
  return `rgba(${r},${g},${b},${alpha})`;
};

// --- Helpers ---

const getInitials = (name: string): string => {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return name.slice(0, 2).toUpperCase();
};

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

// --- Inline Owner (seed-specific, avoids coupling to ideas domain) ---

interface SeedInlineOwnerProps {
  currentOwnerId: string | null;
  members: Array<{ id: string; name: string; email: string; image?: string | null }>;
  onChange: (userId: string) => void;
  isLoading?: boolean;
}

const SeedInlineOwner: React.FC<SeedInlineOwnerProps> = ({
  currentOwnerId,
  members,
  onChange,
  isLoading = false,
}) => {
  const t = useTranslations("seeds.detail");
  const currentOwner = currentOwnerId
    ? members.find((m) => m.id === currentOwnerId)
    : null;

  const [open, setOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-md px-1.5 py-1">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            {currentOwner ? (
              <button
                type="button"
                className="flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Avatar className="h-6 w-6">
                  <AvatarImage
                    src={currentOwner.image ?? undefined}
                    alt={currentOwner.name}
                  />
                  <AvatarFallback className="text-[10px]">
                    {getInitials(currentOwner.name)}
                  </AvatarFallback>
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
        </TooltipTrigger>
        <TooltipContent side="top">
          {currentOwner ? t("changeOwner") : t("assignOwner")}
        </TooltipContent>
      </Tooltip>
      <PopoverContent
        className="w-56 p-0"
        align="start"
        onClick={(e) => e.stopPropagation()}
      >
        <Command>
          <CommandInput placeholder={t("searchMember")} />
          <CommandList>
            <CommandEmpty>{t("noMembersFound")}</CommandEmpty>
            <CommandGroup>
              {members.map((member) => {
                const isSelected = member.id === currentOwnerId;
                return (
                  <CommandItem
                    key={member.id}
                    onSelect={() => {
                      onChange(member.id);
                      setOpen(false);
                    }}
                    className="flex items-center gap-2"
                  >
                    <Avatar className="h-6 w-6 shrink-0">
                      {member.image && (
                        <AvatarImage src={member.image} alt={member.name} />
                      )}
                      <AvatarFallback className="text-[10px]">
                        {getInitials(member.name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-sm">{member.name}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {member.email}
                      </span>
                    </div>
                    {isSelected && (
                      <Check className={cn("ml-auto h-4 w-4 shrink-0 text-primary")} />
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

// --- Inline Project (seed-specific) ---

interface SeedInlineProjectProps {
  currentProjectId: string | null;
  currentProjectName: string | null;
  projects: Array<{ id: string; name: string }>;
  onChange: (projectId: string | null) => void;
  isLoading?: boolean;
}

const SeedInlineProject: React.FC<SeedInlineProjectProps> = ({
  currentProjectId,
  currentProjectName,
  projects,
  onChange,
  isLoading = false,
}) => {
  const t = useTranslations("seeds.detail");

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
      <PopoverContent
        className="w-56 p-0"
        align="start"
        onClick={(e) => e.stopPropagation()}
      >
        <Command>
          <CommandInput placeholder={t("searchProject")} />
          <CommandList>
            <CommandEmpty>{t("noProjectsFound")}</CommandEmpty>
            <CommandGroup>
              <CommandItem onSelect={() => onChange(null)}>
                <span className="text-muted-foreground">{t("noProject")}</span>
                {!currentProjectId && (
                  <Check className="ml-auto h-4 w-4 shrink-0 text-primary" />
                )}
              </CommandItem>
              {projects.map((project) => {
                const isSelected = project.id === currentProjectId;
                return (
                  <CommandItem
                    key={project.id}
                    onSelect={() => onChange(project.id)}
                  >
                    {project.name}
                    {isSelected && (
                      <Check className="ml-auto h-4 w-4 shrink-0 text-primary" />
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

// --- Tag Chips (seed-specific) ---

interface SeedTagChipsProps {
  tags: SeedTag[];
  availableTags: SeedTag[];
  onAddTag: (data: { tagId?: string; name?: string; color?: string }) => void;
  onRemoveTag: (tagId: string) => void;
}

const SeedTagChips: React.FC<SeedTagChipsProps> = ({
  tags,
  availableTags,
  onAddTag,
  onRemoveTag,
}) => {
  const t = useTranslations("seeds.detail");
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const assignedIds = new Set(tags.map((t) => t.id));
  const unassigned = availableTags.filter((t) => !assignedIds.has(t.id));

  const trimmedSearch = search.trim();
  const exactMatch = availableTags.some(
    (t) => t.name.toLowerCase() === trimmedSearch.toLowerCase(),
  );
  const showCreate = trimmedSearch.length > 0 && !exactMatch;

  const handleSelect = (tagId: string) => {
    onAddTag({ tagId });
    setSearch("");
    setOpen(false);
  };

  const handleCreate = () => {
    const color = pickRandomColor();
    onAddTag({ name: trimmedSearch, color });
    setSearch("");
    setOpen(false);
  };

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {tags.map((tag) => {
        const bg = tag.color ? hexToRgba(tag.color, 0.15) : undefined;
        const textColor = tag.color ?? undefined;
        return (
          <span
            key={tag.id}
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
            style={{
              backgroundColor: bg,
              color: textColor,
            }}
          >
            <span
              className="h-2 w-2 rounded-full shrink-0"
              style={{ backgroundColor: tag.color ?? "#999" }}
            />
            {tag.name}
            <button
              type="button"
              className="ml-0.5 rounded-full p-0.5 hover:bg-black/10 transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                onRemoveTag(tag.id);
              }}
              aria-label={t("removeTag", { name: tag.name })}
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </span>
        );
      })}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 rounded-full"
            onClick={(e) => e.stopPropagation()}
            aria-label={t("addTag")}
          >
            <Plus className="h-3 w-3" />
            <span className="sr-only">{t("addTag")}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder={t("searchOrCreateTag")}
              value={search}
              onValueChange={setSearch}
            />
            <CommandList>
              {unassigned.filter((t) =>
                t.name.toLowerCase().includes(trimmedSearch.toLowerCase()),
              ).length === 0 && !showCreate ? (
                <CommandEmpty>{t("noTagsAvailable")}</CommandEmpty>
              ) : null}

              {unassigned.filter((t) =>
                t.name.toLowerCase().includes(trimmedSearch.toLowerCase()),
              ).length > 0 && (
                <CommandGroup heading={t("existingTags")}>
                  {unassigned
                    .filter((t) =>
                      t.name.toLowerCase().includes(trimmedSearch.toLowerCase()),
                    )
                    .map((tag) => (
                      <CommandItem
                        key={tag.id}
                        value={tag.name}
                        onSelect={() => handleSelect(tag.id)}
                      >
                        <span
                          className="h-2.5 w-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: tag.color ?? "#999" }}
                        />
                        {tag.name}
                      </CommandItem>
                    ))}
                </CommandGroup>
              )}

              {showCreate && (
                <>
                  <CommandSeparator />
                  <CommandGroup>
                    <CommandItem onSelect={handleCreate}>
                      <Plus className="h-3.5 w-3.5 text-muted-foreground" />
                      <span>
                        {t("createTag", { name: trimmedSearch })}
                      </span>
                    </CommandItem>
                  </CommandGroup>
                </>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
};

// --- Tags Section ---

interface TagsSectionProps {
  tags: SeedTag[];
  availableTags: SeedTag[];
  onAddTag?: (data: { tagId?: string; name?: string; color?: string }) => void;
  onRemoveTag?: (tagId: string) => void;
}

const TagsSection: React.FC<TagsSectionProps> = ({
  tags,
  availableTags,
  onAddTag,
  onRemoveTag,
}) => {
  const t = useTranslations("seeds.detail");
  return (
  <div className="py-1.5">
    <div className="flex items-center justify-between mb-1.5">
      <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
        <Tag className="h-3 w-3" />
        {t("tags")}
      </span>
    </div>
    {onAddTag && onRemoveTag ? (
      <SeedTagChips
        tags={tags}
        availableTags={availableTags}
        onAddTag={onAddTag}
        onRemoveTag={onRemoveTag}
      />
    ) : tags.length > 0 ? (
      <div className="flex items-center gap-1 flex-wrap">
        {tags.map((tag) => {
          const bg = tag.color ? hexToRgba(tag.color, 0.15) : undefined;
          const textColor = tag.color ?? undefined;
          return (
            <span
              key={tag.id}
              className="inline-flex items-center gap-1 rounded-full px-1.5 py-0 text-[10px] font-medium leading-4"
              style={{ backgroundColor: bg, color: textColor }}
            >
              <span
                className="h-1.5 w-1.5 rounded-full shrink-0"
                style={{ backgroundColor: tag.color ?? "#999" }}
              />
              {tag.name}
            </span>
          );
        })}
      </div>
    ) : (
      <span className="text-xs text-muted-foreground italic">{t("noTags")}</span>
    )}
  </div>
  );
};

// --- Sticky Header ---

interface StickyHeaderProps {
  item: SeedWithRelations;
  savingField: string | null;
  onStatusChange: (status: import("@/domains/planning/domain/types").SeedStatus) => void;
  onPromote: (item: SeedWithRelations) => void;
  onTitleChange: (title: string) => void;
}

const StickyHeader: React.FC<StickyHeaderProps> = ({
  item,
  savingField,
  onStatusChange,
  onPromote,
  onTitleChange,
}) => {
  const t = useTranslations("seeds.detail");
  const ts = useTranslations("seeds");
  return (
  <SheetHeader className="shrink-0 border-b p-4 pr-12">
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-center gap-2">
        <Sprout className="h-4 w-4 text-emerald-500" />
        <Badge
          variant="outline"
          className="border-emerald-200 bg-emerald-50 text-emerald-700"
        >
          {getSeedSourceLabel(item.source, ts)}
        </Badge>
      </div>
      {(item.maturityLevel ?? 1) >= 3 ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() => onPromote(item)}
          className="border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
        >
          <ArrowUpRight className="mr-1 h-4 w-4" />
          {t("promote")}
        </Button>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button size="sm" variant="outline" disabled>
                <ArrowUpRight className="mr-1 h-4 w-4" />
                {t("promote")}
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {t("promoteHint")}
          </TooltipContent>
        </Tooltip>
      )}
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
      <SeedInlineStatus
        value={item.status}
        onChange={onStatusChange}
        isLoading={savingField === "status"}
      />
    </div>
  </SheetHeader>
  );
};

// --- Inline Description ---

interface InlineDescriptionProps {
  value: string | null;
  onChange: (description: string | null) => void;
  isLoading?: boolean;
}

const InlineDescription: React.FC<InlineDescriptionProps> = ({
  value,
  onChange,
  isLoading = false,
}) => {
  const t = useTranslations("seeds.detail");
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
        <span className="text-sm text-muted-foreground">{t("saving")}</span>
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
        <p className="text-xs text-muted-foreground">
          {t("saveHint")}
        </p>
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
        <p className="text-sm text-muted-foreground italic">
          {t("writeDescription")}
        </p>
      )}
      <Pencil className="absolute right-2 top-2 h-3.5 w-3.5 text-muted-foreground touch-visible" />
    </button>
  );
};

// --- Description Block ---

interface DescriptionBlockProps {
  description: string | null;
  onDescriptionChange: (description: string | null) => void;
  isLoading?: boolean;
}

const DescriptionBlock: React.FC<DescriptionBlockProps> = ({
  description,
  onDescriptionChange,
  isLoading = false,
}) => {
  const t = useTranslations("seeds.detail");
  return (
  <div className="space-y-1.5">
    <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
      {t("description")}
    </h3>
    <InlineDescription
      value={description}
      onChange={onDescriptionChange}
      isLoading={isLoading}
    />
  </div>
  );
};

// --- Metadata Sidebar ---

interface MetadataSidebarProps {
  item: SeedWithRelations;
  savingField: string | null;
  formatDateTimeValue: (value: string | null | undefined) => string;
  members: Array<{ id: string; name: string; email: string; image?: string | null }>;
  projects: Array<{ id: string; name: string }>;
  availableTags?: SeedTag[];
  onOwnerChange: (userId: string) => void;
  onProjectChange: (projectId: string | null) => void;
  onPriorityChange: (priority: SeedPriority | null) => void;
  onAddTag?: (data: { tagId?: string; name?: string; color?: string }) => void;
  onRemoveTag?: (tagId: string) => void;
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
  onPriorityChange,
  onAddTag,
  onRemoveTag,
}) => {
  const t = useTranslations("seeds.detail");
  const tp = useTranslations("seeds.priority");
  const tf = useTranslations("seeds.filters");
  const ts = useTranslations("seeds");
  return (
  <div className="rounded-lg border bg-muted/30 px-4 py-2">
    {/* Owner */}
    <MetaField label={t("owner")}>
      <SeedInlineOwner
        currentOwnerId={item.ownerUserId}
        members={members}
        onChange={onOwnerChange}
        isLoading={savingField === "owner"}
      />
    </MetaField>
    <Separator />

    {/* Priority */}
    <MetaField label={t("priority")}>
      {savingField === "priority" ? (
        <div className="flex items-center gap-2 rounded-md px-1.5 py-1">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <Select
          value={item.priority ?? "none"}
          onValueChange={(v) => onPriorityChange(v === "none" ? null : v as SeedPriority)}
        >
          <SelectTrigger className="h-7 w-[120px] text-xs border-none shadow-none hover:bg-muted/50">
            <SelectValue>
              {item.priority ? (
                <span className="flex items-center gap-1.5">
                  {(() => {
                    const Icon = PRIORITY_ICON[item.priority];
                    return <Icon className={cn("h-3.5 w-3.5", PRIORITY_COLOR[item.priority])} />;
                  })()}
                  {tp(item.priority)}
                </span>
              ) : (
                <span className="text-muted-foreground">{t("noPriority")}</span>
              )}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">
              <span className="text-muted-foreground">{t("noPriority")}</span>
            </SelectItem>
            {PRIORITY_KEYS.map((key) => {
              const Icon = PRIORITY_ICON[key];
              return (
                <SelectItem key={key} value={key}>
                  <span className="flex items-center gap-1.5">
                    <Icon className={cn("h-3.5 w-3.5", PRIORITY_COLOR[key])} />
                    {tp(key)}
                  </span>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      )}
    </MetaField>
    <Separator />

    {/* Source (read-only) */}
    <MetaField label={t("source")}>
      <Badge variant="outline" className="text-xs">
        {getSeedSourceLabel(item.source, ts)}
      </Badge>
    </MetaField>
    <Separator />

    {/* Project */}
    <MetaField label={t("project")}>
      <SeedInlineProject
        currentProjectId={item.projectId}
        currentProjectName={item.projectName}
        projects={projects}
        onChange={onProjectChange}
        isLoading={savingField === "project"}
      />
    </MetaField>
    <Separator />

    {/* Created By */}
    <MetaField label={t("createdBy")}>
      {item.createdBy ? (
        <div className="flex items-center gap-2">
          <Avatar className="h-5 w-5">
            <AvatarImage
              src={item.createdBy.image ?? undefined}
              alt={item.createdBy.name}
            />
            <AvatarFallback className="text-[10px]">
              {getInitials(item.createdBy.name)}
            </AvatarFallback>
          </Avatar>
          <span className="text-sm">{item.createdBy.name}</span>
        </div>
      ) : (
        <span className="text-sm text-muted-foreground">&mdash;</span>
      )}
    </MetaField>
    <Separator />

    {/* Selected for Ideation (read-only) */}
    <MetaField label={t("selected")}>
      <Badge
        variant="outline"
        className={cn(
          "text-xs",
          item.selectedForIdeation
            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
            : "border-gray-200 bg-gray-50 text-gray-500",
        )}
      >
        {item.selectedForIdeation ? tf("yes") : tf("no")}
      </Badge>
    </MetaField>
    <Separator />

    {/* Maturity Level */}
    <MetaField label={t("maturityLevel")}>
      <SeedMaturityBadge level={item.maturityLevel ?? 1} />
    </MetaField>
    <Separator />

    {/* Tags */}
    <TagsSection
      tags={item.tags ?? []}
      availableTags={availableTags ?? []}
      onAddTag={onAddTag}
      onRemoveTag={onRemoveTag}
    />
    <Separator />

    {/* Dates */}
    <div className="py-1.5 text-xs text-muted-foreground space-y-0.5">
      <p>{t("created")}: {formatDateTimeValue(item.createdAt)}</p>
      <p>{t("updated")}: {formatDateTimeValue(item.updatedAt)}</p>
    </div>
  </div>
  );
};

// --- Comments Section Wrapper (collapsible) ---

interface CommentsSectionWrapperProps {
  commentsProps: SeedCommentsSectionProps | undefined;
  commentsLabel: string;
}

const CommentsSectionWrapper: React.FC<CommentsSectionWrapperProps> = ({
  commentsProps,
  commentsLabel,
}) => {
  if (!commentsProps) return null;

  // SeedComment is structurally compatible with UnifiedComment
  const unifiedComments: UnifiedComment[] = commentsProps.comments as unknown as UnifiedComment[];
  const commentMembers: MentionMember[] = commentsProps.members ?? [];
  const count = unifiedComments.length;

  return (
    <Collapsible defaultOpen={false}>
      <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-muted/50 [&[data-state=open]>svg:last-child]:rotate-180">
        <div className="flex items-center gap-2">
          <MessageCircle className="h-4 w-4 text-muted-foreground" />
          {commentsLabel} {count > 0 && `(${count})`}
        </div>
        <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="px-3 pb-2 pt-1">
          <UnifiedCommentSection
            comments={unifiedComments}
            isLoading={commentsProps.isLoading}
            currentUserId={commentsProps.currentUserId}
            isAdding={commentsProps.isAdding}
            newCommentValue={commentsProps.newCommentValue}
            editingId={commentsProps.editingId}
            editContent={commentsProps.editContent}
            members={commentMembers}
            onAddComment={commentsProps.onAddComment}
            onDeleteComment={commentsProps.onDeleteComment}
            onNewCommentChange={commentsProps.onNewCommentChange}
            onStartEdit={(c) => commentsProps.onStartEdit(c as unknown as import("@/domains/planning/domain/types").SeedComment)}
            onCancelEdit={commentsProps.onCancelEdit}
            onSaveEdit={commentsProps.onSaveEdit}
            onEditContentChange={commentsProps.onEditContentChange}
            onImageUpload={commentsProps.onImageUpload}
            onFileUpload={commentsProps.onFileUpload}
          />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};

// --- Main Component ---

export const SeedDetailSheet: React.FC<SeedDetailSheetProps> = ({
  open,
  onOpenChange,
  item,
  isLoading,
  projects,
  members,
  availableTags,
  commentsProps,
  historyProps,
  traceabilityProps,
  savingField,
  onPromote,
  onStatusChange,
  onOwnerChange,
  onPriorityChange,
  onTitleChange,
  onDescriptionChange,
  onProjectChange,
  onAddTag,
  onRemoveTag,
}) => {
  const t = useTranslations("seeds.detail");
  const { formatDateTime } = useFormattedDate();
  const formatDateTimeValue = useCallback(
    (value: string | null | undefined): string => {
      if (!value) return "-";
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return "-";
      return formatDateTime(date);
    },
    [formatDateTime],
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl p-0 flex flex-col">
        {/* Zone 1: Loading or empty state */}
        {isLoading || !item ? (
          <DetailSkeleton />
        ) : (
          <>
            {/* Zone 1: Sticky header */}
            <StickyHeader
              item={item}
              savingField={savingField ?? null}
              onStatusChange={onStatusChange}
              onPromote={onPromote}
              onTitleChange={onTitleChange}
            />

            <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col">
              {/* Zone 2: Scrollable content */}
              <ScrollArea className="flex-1 min-h-0 w-full min-w-0">
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
                    onPriorityChange={onPriorityChange}
                    onAddTag={onAddTag}
                    onRemoveTag={onRemoveTag}
                  />

                  {/* Description */}
                  <DescriptionBlock
                    description={item.description}
                    onDescriptionChange={onDescriptionChange}
                    isLoading={savingField === "description"}
                  />

                  {/* Maturity Checklist */}
                  <SeedMaturityChecklist
                    description={item.description}
                    metadata={item.metadata}
                  />

                  <Separator />

                  {/* Traceability (collapsible) */}
                  {traceabilityProps && (
                    <SeedTraceabilitySection
                      feedbackLinks={traceabilityProps.feedbackLinks}
                      workItemLinks={traceabilityProps.workItemLinks}
                      isLoading={traceabilityProps.isLoading}
                    />
                  )}

                  {/* History (collapsible) */}
                  {historyProps && (
                    <SeedHistorySection
                      events={historyProps.events}
                      isLoading={historyProps.isLoading}
                      members={historyProps.members}
                      projects={historyProps.projects}
                    />
                  )}

                  {/* Comments (collapsible) */}
                  {commentsProps && (
                    <CommentsSectionWrapper
                      commentsProps={commentsProps}
                      commentsLabel={t("comments")}
                    />
                  )}
                </div>
              </ScrollArea>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
};
