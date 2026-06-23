import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Lock, ChevronDown, ChevronRight, Package, BarChart3, ExternalLink } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ShareProgressBanner } from "@/domains/shared/presentation/components/share-progress-banner";
import { SprintItemRow } from "./sprint-item-row";
import { SprintSummaryInline } from "./sprint-summary-inline";
import type {
  SprintHistoryPanelProps,
  SprintWithCount,
  SprintSummaryData,
} from "../../domain/types";

const SprintCard: React.FC<{
  sprint: SprintWithCount;
  isExpanded: boolean;
  onToggle: () => void;
  items: React.ReactNode;
  isLoadingItems: boolean;
  onViewReport?: () => void;
  summary?: SprintSummaryData | null;
  isLoadingSummary?: boolean;
  fullReportHref?: string;
}> = ({ sprint, isExpanded, onToggle, items, isLoadingItems, onViewReport, summary, isLoadingSummary, fullReportHref }) => {
  const t = useTranslations("sprints");
  const isClosed = sprint.status === "closed";

  return (
    <div className="border rounded-lg">
      <div className="flex items-center">
        <button
          type="button"
          onClick={onToggle}
          className="flex-1 flex items-center gap-2 p-3 hover:bg-muted/50 text-left min-w-0"
        >
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm truncate">{sprint.name}</span>
              <Badge
                variant={isClosed ? "secondary" : "default"}
                className="text-[10px] shrink-0"
              >
                {isClosed ? t("closed") : t("open")}
              </Badge>
            </div>
            <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
              <span>{sprint.workItemCount} items</span>
              {sprint.closedAt && (
                <>
                  <span>·</span>
                  <span>
                    {new Date(sprint.closedAt).toLocaleDateString("es-ES", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    })}
                  </span>
                </>
              )}
            </div>
          </div>
        </button>
        {isClosed && onViewReport && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onViewReport();
                  }}
                  className="shrink-0 mr-2 p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Ver reporte"
                >
                  <BarChart3 className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="left">
                <p>Ver reporte</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
      {isExpanded && (
        <div className="border-t px-2 py-1">
          {isClosed && (summary || isLoadingSummary) && (
            <div className="py-1.5">
              <SprintSummaryInline
                summary={summary ?? { completedCount: 0, velocity: 0, aiCost: 0 }}
                isLoading={isLoadingSummary ?? false}
              />
            </div>
          )}
          {isLoadingItems ? (
            <div className="space-y-2 p-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-6 w-full" />
              ))}
            </div>
          ) : (
            items
          )}
          {isClosed && fullReportHref && (
            <div className="px-2 pb-2 pt-1">
              <Link
                href={fullReportHref}
                className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline font-medium"
              >
                <ExternalLink className="h-3 w-3" />
                {t("viewFullReport")}
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export const SprintHistoryPanel: React.FC<SprintHistoryPanelProps> = ({
  open,
  onOpenChange,
  activeSprint,
  closedSprints,
  isLoading,
  expandedSprintId,
  onToggleExpand,
  expandedSprintItems,
  isLoadingItems,
  onCreateSprint,
  onCloseSprint,
  hasActiveSprint,
  onViewReport,
  expandedSprintSummary,
  isLoadingSummary,
  area,
  shareBannerSprintName,
  onShareBannerAction,
  onShareBannerDismiss,
}) => {
  const t = useTranslations("sprints");
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-[440px] flex flex-col p-0">
        <SheetHeader className="px-6 pt-6 pb-4 space-y-3">
          <SheetTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            {t("title")}
          </SheetTitle>
          <div className="flex gap-2">
            {!hasActiveSprint && (
              <Button size="sm" variant="outline" onClick={onCreateSprint}>
                <Plus className="h-3.5 w-3.5 mr-1" />
                {t("create")}
              </Button>
            )}
            <Button size="sm" onClick={onCloseSprint}>
              <Lock className="h-3.5 w-3.5 mr-1" />
              {t("closeSprint")}
            </Button>
          </div>
        </SheetHeader>

        <Separator />

        <ScrollArea className="flex-1 px-6">
          <div className="py-4 space-y-4">
            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : (
              <>
                {shareBannerSprintName && onShareBannerAction && onShareBannerDismiss && (
                  <ShareProgressBanner
                    title={t("shareBanner.title")}
                    description={t("shareBanner.description", {
                      sprintName: shareBannerSprintName,
                    })}
                    shareLabel={t("shareBanner.share")}
                    dismissLabel={t("shareBanner.notNow")}
                    closeLabel={t("shareBanner.close")}
                    onShare={onShareBannerAction}
                    onDismiss={onShareBannerDismiss}
                    onClose={onShareBannerDismiss}
                  />
                )}

                {/* Active sprint */}
                {activeSprint && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                      {t("activeSprint")}
                    </p>
                    <SprintCard
                      sprint={activeSprint}
                      isExpanded={expandedSprintId === activeSprint.id}
                      onToggle={() => onToggleExpand(activeSprint.id)}
                      items={
                        <p className="text-xs text-muted-foreground p-2">
                          {t("activeHint")}
                        </p>
                      }
                      isLoadingItems={false}
                    />
                  </div>
                )}

                {/* Closed sprints */}
                {closedSprints.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                      {t("history")} ({closedSprints.length})
                    </p>
                    <div className="space-y-2">
                      {closedSprints.map((sprint) => (
                        <SprintCard
                          key={sprint.id}
                          sprint={sprint}
                          isExpanded={expandedSprintId === sprint.id}
                          onToggle={() => onToggleExpand(sprint.id)}
                          onViewReport={onViewReport ? () => onViewReport(sprint.id) : undefined}
                          summary={expandedSprintId === sprint.id ? expandedSprintSummary : null}
                          isLoadingSummary={expandedSprintId === sprint.id ? isLoadingSummary : false}
                          fullReportHref={area ? `/board/${area}/sprints/${sprint.id}` : undefined}
                          items={
                            expandedSprintItems.length > 0 ? (
                              expandedSprintItems.map((item) => (
                                <SprintItemRow
                                  key={item.id}
                                  title={item.title}
                                  type={item.type}
                                  priority={item.priority}
                                  assignee={item.assignee}
                                  completedAt={item.completedAt}
                                />
                              ))
                            ) : (
                              <p className="text-xs text-muted-foreground p-2">{t("noItems")}</p>
                            )
                          }
                          isLoadingItems={isLoadingItems && expandedSprintId === sprint.id}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* Empty state */}
                {!activeSprint && closedSprints.length === 0 && (
                  <div className="text-center py-8">
                    <Package className="h-10 w-10 mx-auto text-muted-foreground/50 mb-3" />
                    <p className="text-sm text-muted-foreground">{t("noSprints")}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {t("noSprintsHint")}
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
};
