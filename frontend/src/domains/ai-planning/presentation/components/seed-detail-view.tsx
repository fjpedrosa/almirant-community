import { Drawer } from "vaul";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ChevronsUp,
  ExternalLink,
  User,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/lib/hooks/use-is-mobile";
import type { SeedDetailViewProps } from "../../domain/types";
import type { SeedWithRelations } from "@/domains/planning/domain/types";
import type { Priority } from "@/domains/work-items/domain/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_VARIANT: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  active:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300",
  to_review:
    "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  approved:
    "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  archived:
    "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  rejected:
    "bg-rose-100 text-rose-700 dark:bg-rose-900 dark:text-rose-300",
};

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

const PRIORITY_LABEL: Record<Priority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const getInitials = (name: string): string => {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return name.slice(0, 2).toUpperCase();
};

const formatStatus = (status: string): string =>
  status
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

// ---------------------------------------------------------------------------
// Overlay props
// ---------------------------------------------------------------------------

interface SeedDetailOverlayProps extends SeedDetailViewProps {
  isOpen: boolean;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Shared detail content (used by both Drawer and Sheet)
// ---------------------------------------------------------------------------

const DetailContent: React.FC<SeedDetailViewProps> = ({
  seed,
  annotation,
  onAnnotationChange,
  readOnly,
  comments,
  isLoadingComments,
}) => {
  if (!seed) return null;

  const PriorityIcon = seed.priority
    ? PRIORITY_ICON[seed.priority]
    : null;

  return (
    <div className="space-y-5 px-5 pb-6">
      {/* Status + Priority badges */}
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
            STATUS_VARIANT[seed.status] ?? STATUS_VARIANT.draft,
          )}
        >
          {formatStatus(seed.status)}
        </span>

        {seed.priority && PriorityIcon && (
          <span className="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium">
            <PriorityIcon
              className={cn("size-3", PRIORITY_COLOR[seed.priority])}
            />
            <span>{PRIORITY_LABEL[seed.priority]}</span>
          </span>
        )}
      </div>

      {/* Owner */}
      <div className="flex items-center gap-2.5">
        {seed.owner ? (
          <>
            <Avatar className="size-6">
              <AvatarImage
                src={seed.owner.image ?? undefined}
                alt={seed.owner.name}
              />
              <AvatarFallback className="text-[10px]">
                {getInitials(seed.owner.name)}
              </AvatarFallback>
            </Avatar>
            <span className="text-sm text-foreground">{seed.owner.name}</span>
          </>
        ) : (
          <>
            <span className="flex size-6 items-center justify-center rounded-full border border-dashed border-muted-foreground/40 text-muted-foreground/60">
              <User className="size-3" />
            </span>
            <span className="text-sm text-muted-foreground">Unassigned</span>
          </>
        )}
      </div>

      {/* Full description */}
      {seed.description && (
        <div className="space-y-1.5">
          <h4 className="text-xs font-medium text-muted-foreground">
            Description
          </h4>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
            {seed.description}
          </p>
        </div>
      )}

      {/* Enrichment note */}
      <div className="space-y-1.5">
        <h4 className="text-xs font-medium text-muted-foreground">
          Enrichment note
        </h4>
        {readOnly ? (
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
            {annotation || (
              <span className="italic text-muted-foreground">
                No enrichment note
              </span>
            )}
          </p>
        ) : (
          <Textarea
            value={annotation ?? ""}
            onChange={(e) =>
              onAnnotationChange?.(seed.id, e.target.value)
            }
            placeholder="Add context or instructions for the AI..."
            className="min-h-[80px] resize-none text-sm"
            rows={3}
          />
        )}
      </div>

      {/* Comments */}
      <div className="space-y-2">
        <h4 className="text-xs font-medium text-muted-foreground">
          Comments
        </h4>

        {isLoadingComments ? (
          <div className="space-y-3">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="flex items-start gap-2.5">
                <Skeleton className="size-6 rounded-full" />
                <div className="flex-1 space-y-1">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-4 w-full" />
                </div>
              </div>
            ))}
          </div>
        ) : comments.length === 0 ? (
          <p className="text-sm italic text-muted-foreground">
            No comments yet
          </p>
        ) : (
          <div className="space-y-3">
            {comments.map((comment) => (
              <div key={comment.id} className="flex items-start gap-2.5">
                <Avatar className="size-6 shrink-0">
                  <AvatarImage
                    src={comment.author.image ?? undefined}
                    alt={comment.author.name}
                  />
                  <AvatarFallback className="text-[10px]">
                    {getInitials(comment.author.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-xs font-medium text-foreground">
                      {comment.author.name}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {new Date(comment.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="mt-0.5 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                    {comment.content}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Tags */}
      {(seed.tags?.length ?? 0) > 0 && (
        <div className="space-y-1.5">
          <h4 className="text-xs font-medium text-muted-foreground">Tags</h4>
          <div className="flex flex-wrap gap-1.5">
            {seed.tags!.map((tag) => (
              <Badge
                key={tag.id}
                variant="outline"
                className="px-2 py-0.5 text-xs"
                style={
                  tag.color
                    ? { borderColor: tag.color, color: tag.color }
                    : undefined
                }
              >
                {tag.name}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Related work items */}
      {(seed.workItemLinks?.length ?? 0) > 0 && (
        <div className="space-y-1.5">
          <h4 className="text-xs font-medium text-muted-foreground">
            Related work items
          </h4>
          <div className="space-y-1">
            {seed.workItemLinks!.map((link) => (
              <div
                key={link.id}
                className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
              >
                <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate text-foreground">
                  {link.taskId && (
                    <span className="mr-1.5 font-mono text-xs text-muted-foreground">
                      {link.taskId}
                    </span>
                  )}
                  {link.title}
                </span>
                <Badge
                  variant="secondary"
                  className="ml-auto shrink-0 text-[10px]"
                >
                  {link.type}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// SeedDetailOverlay — responsive Drawer (mobile) / Sheet (desktop)
// ---------------------------------------------------------------------------

export const SeedDetailOverlay: React.FC<SeedDetailOverlayProps> = ({
  isOpen,
  onClose,
  seed,
  annotation,
  onAnnotationChange,
  readOnly,
  comments,
  isLoadingComments,
}) => {
  const isMobile = useIsMobile();

  const detailProps: SeedDetailViewProps = {
    seed,
    annotation,
    onAnnotationChange,
    readOnly,
    comments,
    isLoadingComments,
  };

  const title = seed?.title ?? "Seed detail";

  if (isMobile) {
    return (
      <Drawer.Root
        open={isOpen}
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-40 bg-black/30" />
          <Drawer.Content className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col rounded-t-2xl border-t border-border bg-background shadow-2xl outline-none">
            <Drawer.Handle className="mx-auto mt-3 mb-1 h-1.5 w-10 rounded-full bg-muted-foreground/30" />
            <Drawer.Title className="px-5 pb-3 pt-1 text-base font-semibold leading-tight line-clamp-2">
              {title}
            </Drawer.Title>
            <ScrollArea className="flex-1 min-h-0">
              <DetailContent {...detailProps} />
            </ScrollArea>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    );
  }

  return (
    <Sheet
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        side="right"
        className="flex w-full flex-col p-0 sm:max-w-[420px]"
        aria-describedby={undefined}
      >
        <SheetHeader className="px-5 pt-5 pb-3">
          <SheetTitle className="text-base leading-tight line-clamp-2">
            {title}
          </SheetTitle>
        </SheetHeader>
        <ScrollArea className="flex-1 min-h-0">
          <DetailContent {...detailProps} />
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
};
