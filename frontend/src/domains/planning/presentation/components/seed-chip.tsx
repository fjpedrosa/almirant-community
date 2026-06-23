import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ChevronsUp,
  Eye,
  MessageSquare,
  Sprout,
  User,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { Priority } from "@/domains/work-items/domain/types";
import type { SeedChipProps, SeedStatus } from "../../domain/types";

const STATUS_CONFIG: Record<
  SeedStatus,
  { label: string; bgClass: string; borderClass: string }
> = {
  draft: {
    label: "Borrador",
    bgClass: "bg-slate-50 dark:bg-slate-950/30",
    borderClass: "border-slate-300 dark:border-slate-700",
  },
  active: {
    label: "Activa",
    bgClass: "bg-emerald-50 dark:bg-emerald-950/30",
    borderClass: "border-emerald-300 dark:border-emerald-700",
  },
  to_review: {
    label: "En revision",
    bgClass: "bg-amber-50 dark:bg-amber-950/30",
    borderClass: "border-amber-300 dark:border-amber-700",
  },
  approved: {
    label: "Aprobada",
    bgClass: "bg-blue-50 dark:bg-blue-950/30",
    borderClass: "border-blue-300 dark:border-blue-700",
  },
  archived: {
    label: "Archivada",
    bgClass: "bg-gray-50 dark:bg-gray-950/30",
    borderClass: "border-gray-300 dark:border-gray-700",
  },
  rejected: {
    label: "Rechazada",
    bgClass: "bg-rose-50 dark:bg-rose-950/30",
    borderClass: "border-rose-300 dark:border-rose-700",
  },
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
  low: "Baja",
  medium: "Media",
  high: "Alta",
  urgent: "Urgente",
};

const getInitials = (name: string): string => {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return name.slice(0, 2).toUpperCase();
};

export const SeedChip: React.FC<SeedChipProps> = ({
  seed,
  isSelected,
  onToggle,
  onClick,
}) => {
  const statusConfig = STATUS_CONFIG[seed.status];
  const PriorityIcon = seed.priority ? PRIORITY_ICON[seed.priority] : null;
  const priorityColor = seed.priority ? PRIORITY_COLOR[seed.priority] : "";

  return (
    <div
      className={cn(
        "group/chip flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors cursor-pointer",
        statusConfig.bgClass,
        statusConfig.borderClass,
        "hover:bg-accent/50",
        isSelected && "ring-2 ring-primary/40 ring-offset-1",
        seed.selectedForIdeation && "ring-1 ring-emerald-400",
      )}
      onClick={() => onToggle(seed.id, !isSelected)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle(seed.id, !isSelected);
        }
      }}
      aria-label={`Seed: ${seed.title}`}
      aria-pressed={isSelected}
    >
      {seed.owner ? (
        <Avatar className="h-6 w-6 shrink-0">
          <AvatarImage src={seed.owner.image ?? undefined} alt={seed.owner.name} />
          <AvatarFallback className="text-[10px]">
            {getInitials(seed.owner.name)}
          </AvatarFallback>
        </Avatar>
      ) : (
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-dashed border-muted-foreground/40 text-muted-foreground/60">
          <User className="h-3 w-3" />
        </div>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {seed.priority && PriorityIcon && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <PriorityIcon
                    className={cn("h-3.5 w-3.5 shrink-0", priorityColor)}
                  />
                </span>
              </TooltipTrigger>
              <TooltipContent side="top">
                {PRIORITY_LABEL[seed.priority]}
              </TooltipContent>
            </Tooltip>
          )}
          <span className="truncate text-sm font-medium">{seed.title}</span>
        </div>

        {seed.description && (
          <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
            {seed.description}
          </p>
        )}

        {(seed.tags?.length ?? 0) > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {seed.tags!.map((tag) => (
              <Badge
                key={tag.id}
                variant="outline"
                className="px-1.5 py-0 text-[10px]"
                style={
                  tag.color
                    ? {
                        borderColor: tag.color,
                        color: tag.color,
                      }
                    : undefined
                }
              >
                {tag.name}
              </Badge>
            ))}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Button
          variant="ghost"
          size="icon-xs"
          className="h-6 w-6"
          onClick={(e) => {
            e.stopPropagation();
            onClick(seed);
          }}
          aria-label="Ver detalles"
        >
          <Eye className="h-3.5 w-3.5" />
        </Button>

        {seed.commentCount > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
                <MessageSquare className="h-3 w-3" />
                {seed.commentCount}
              </span>
            </TooltipTrigger>
            <TooltipContent side="top">
              {seed.commentCount} comentario{seed.commentCount !== 1 ? "s" : ""}
            </TooltipContent>
          </Tooltip>
        )}

        {seed.selectedForIdeation && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                <Sprout className="h-3 w-3" />
              </span>
            </TooltipTrigger>
            <TooltipContent side="top">
              Seleccionada para planning
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  );
};
