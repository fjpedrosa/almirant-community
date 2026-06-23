import { Badge } from "@/components/ui/badge";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import type { WorkItemTypeFilter, WorkItemTypeTabsProps } from "../../domain/types";

const TAB_ORDER: WorkItemTypeFilter[] = ["all", "epic", "feature", "story", "task", "idea"];

const typeAccentColors: Record<WorkItemTypeFilter, string> = {
  all: "border-foreground/80 text-foreground",
  epic: "border-purple-600 text-purple-600 dark:text-purple-400",
  feature: "border-blue-600 text-blue-600 dark:text-blue-400",
  story: "border-green-600 text-green-600 dark:text-green-400",
  task: "border-slate-600 text-slate-600 dark:text-slate-400",
  idea: "border-amber-600 text-amber-600 dark:text-amber-400",
};

const typeDotColors: Record<WorkItemTypeFilter, string> = {
  all: "",
  epic: "bg-purple-600",
  feature: "bg-blue-600",
  story: "bg-green-600",
  task: "bg-slate-600",
  idea: "bg-amber-500",
};

export const WorkItemTypeTabs: React.FC<WorkItemTypeTabsProps> = ({
  activeType,
  onTypeChange,
  counts,
  canScrollLeft = false,
  canScrollRight = false,
}) => {
  const t = useTranslations("workItems.typeFilter");
  const tTypes = useTranslations("workItemTypes");

  // Determine if we should show indicators (only when there's overflow)
  const showLeftIndicator = canScrollLeft;
  const showRightIndicator = canScrollRight;

  return (
    <div className="relative w-full border-b border-border/50 pb-2 mb-3">
      {/* Left fade gradient indicator */}
      <div
        className={cn(
          "absolute left-0 top-0 bottom-2 w-8 bg-gradient-to-r from-background to-transparent z-10 pointer-events-none transition-opacity duration-200",
          showLeftIndicator ? "opacity-100" : "opacity-0"
        )}
        aria-hidden="true"
      />

      <ScrollArea className="w-full">
        <div
          className="flex items-center gap-1 whitespace-nowrap w-max touch-pan-x"
          role="tablist"
          aria-label={t("label")}
        >
          {TAB_ORDER.map((type) => {
            const isActive = activeType === type;
            const count = counts?.[type];
            const label = type === "all" ? t("all") : tTypes(type);

            return (
              <button
                key={type}
                role="tab"
                aria-selected={isActive}
                onClick={() => onTypeChange(type)}
                className={cn(
                  "inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                  "border border-transparent",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                  isActive
                    ? cn("bg-background shadow-sm", typeAccentColors[type])
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                )}
              >
                {type !== "all" && (
                  <span
                    className={cn(
                      "inline-block h-2 w-2 rounded-full shrink-0",
                      typeDotColors[type]
                    )}
                  />
                )}
                {label}
                {count !== undefined && (
                  <Badge
                    variant="secondary"
                    className={cn(
                      "h-4 min-w-[16px] px-1 text-[10px] font-bold",
                      isActive && "bg-muted"
                    )}
                  >
                    {count}
                  </Badge>
                )}
              </button>
            );
          })}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>

      {/* Right fade gradient indicator */}
      <div
        className={cn(
          "absolute right-0 top-0 bottom-2 w-8 bg-gradient-to-l from-background to-transparent z-10 pointer-events-none transition-opacity duration-200",
          showRightIndicator ? "opacity-100" : "opacity-0"
        )}
        aria-hidden="true"
      />
    </div>
  );
};
