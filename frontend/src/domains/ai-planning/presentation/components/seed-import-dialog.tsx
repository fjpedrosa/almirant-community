"use client";

import { useTranslations } from "next-intl";
import { Search, Sprout, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DynamicFilters } from "@/domains/shared/presentation/components/filters/dynamic-filters";
import { cn } from "@/lib/utils";
import type { SeedStatus } from "@/domains/planning/domain/types";
import type { SeedImportDialogProps } from "../../domain/types";

const STATUS_VARIANT: Record<SeedStatus, string> = {
  draft: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  active:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300",
  to_review:
    "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  approved: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  archived: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  rejected: "bg-rose-100 text-rose-700 dark:bg-rose-900 dark:text-rose-300",
};

const truncateDescription = (text: string, maxLength = 120): string =>
  text.length <= maxLength ? text : `${text.slice(0, maxLength)}...`;

const LoadingState: React.FC<{ message: string }> = ({ message }) => (
  <div className="flex flex-col items-center justify-center py-12">
    <Loader2 className="size-6 animate-spin text-muted-foreground" />
    <p className="mt-2 text-sm text-muted-foreground">{message}</p>
  </div>
);

const EmptyState: React.FC<{ hasSearch: boolean; noResultsTitle: string; noResultsHint: string; noSeedsTitle: string; noSeedsHint: string }> = ({
  hasSearch,
  noResultsTitle,
  noResultsHint,
  noSeedsTitle,
  noSeedsHint,
}) => (
  <div className="flex flex-col items-center justify-center py-12 text-center">
    <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-muted">
      <Sprout className="size-6 text-muted-foreground" />
    </div>
    <h3 className="text-sm font-medium">
      {hasSearch ? noResultsTitle : noSeedsTitle}
    </h3>
    <p className="mt-1 max-w-xs text-xs text-muted-foreground">
      {hasSearch ? noResultsHint : noSeedsHint}
    </p>
  </div>
);

export const SeedImportDialog: React.FC<SeedImportDialogProps> = ({
  isOpen,
  onClose,
  seeds,
  isLoading,
  selectedIds,
  selectedCount,
  searchQuery,
  onSearchChange,
  onToggle,
  onSelectAll,
  onDeselectAll,
  onImport,
  filtersConfig,
  dynamicFilters,
  hasActiveFilters,
}) => {
  const t = useTranslations("aiPlanning.seedImport");
  const allSelected = seeds.length > 0 && selectedCount === seeds.length;

  const statusLabels: Record<SeedStatus, string> = {
    draft: t("statusLabel.draft"),
    active: t("statusLabel.active"),
    to_review: t("statusLabel.to_review"),
    approved: t("statusLabel.approved"),
    archived: t("statusLabel.archived"),
    rejected: t("statusLabel.rejected"),
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="sm:max-w-2xl flex flex-col overflow-hidden max-h-[80vh]"
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sprout className="size-5 text-emerald-500" />
            {t("title")}
          </DialogTitle>
        </DialogHeader>

        {/* Search + Filters bar */}
        <DynamicFilters
          config={filtersConfig}
          appliedFilters={dynamicFilters.appliedFilters}
          onAddFilter={dynamicFilters.addFilter}
          onRemoveFilter={dynamicFilters.removeFilter}
          onUpdateFilter={dynamicFilters.updateFilter}
          onClearFilters={dynamicFilters.clearFilters}
          availableFilters={dynamicFilters.availableFilters}
          searchSlot={
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder={t("searchPlaceholder")}
                className="pl-9 h-9 text-sm"
                autoFocus
              />
            </div>
          }
        />

        {/* Select all / deselect all bar */}
        {!isLoading && seeds.length > 0 && (
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {selectedCount > 0
                ? t("selectedCount", { count: selectedCount })
                : t("availableCount", { count: seeds.length })}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-3 text-xs"
              onClick={allSelected ? onDeselectAll : onSelectAll}
            >
              {allSelected ? t("deselectAll") : t("selectAll")}
            </Button>
          </div>
        )}

        {/* Seed list */}
        <ScrollArea className="flex-1 min-h-0 overflow-y-auto -mx-6 px-6">
          {isLoading ? (
            <LoadingState message={t("loading")} />
          ) : seeds.length === 0 ? (
            <EmptyState
              hasSearch={searchQuery.trim().length > 0 || hasActiveFilters}
              noResultsTitle={t("noResultsTitle")}
              noResultsHint={t("noResultsHint")}
              noSeedsTitle={t("noSeedsTitle")}
              noSeedsHint={t("noSeedsHint")}
            />
          ) : (
            <div className="space-y-1" role="list" aria-label={t("seedsAriaLabel")}>
              {seeds.map((seed) => {
                const isSelected = selectedIds.has(seed.id);
                return (
                  <label
                    key={seed.id}
                    role="listitem"
                    className={cn(
                      "flex items-start gap-3 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors overflow-hidden",
                      "hover:bg-accent/50",
                      isSelected &&
                        "border-primary/40 bg-primary/5 dark:bg-primary/10",
                    )}
                  >
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => onToggle(seed.id)}
                      className="mt-0.5 shrink-0"
                      aria-label={t("selectSeedAriaLabel", { title: seed.title })}
                    />

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">
                          {seed.title}
                        </span>
                        <Badge
                          variant="secondary"
                          className={cn(
                            "shrink-0 px-1.5 py-0 text-[10px] font-normal border-0",
                            STATUS_VARIANT[seed.status],
                          )}
                        >
                          {statusLabels[seed.status]}
                        </Badge>
                      </div>

                      {seed.owner && (
                        <div className="mt-1 flex items-center gap-1.5">
                          {seed.owner.image ? (
                            <img
                              src={seed.owner.image}
                              alt={seed.owner.name}
                              className="size-4 rounded-full object-cover shrink-0"
                            />
                          ) : (
                            <div className="size-4 rounded-full bg-muted flex items-center justify-center shrink-0">
                              <span className="text-[8px] text-muted-foreground leading-none">
                                {seed.owner.name[0]}
                              </span>
                            </div>
                          )}
                          <span className="text-xs text-muted-foreground truncate">
                            {seed.owner.name}
                          </span>
                        </div>
                      )}

                      {seed.description && (
                        <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                          {truncateDescription(seed.description)}
                        </p>
                      )}

                      {(seed.tags?.length ?? 0) > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {seed.tags!.slice(0, 3).map((tag) => (
                            <Badge
                              key={tag.id}
                              variant="outline"
                              className="px-1.5 py-0 text-[10px]"
                              style={
                                tag.color
                                  ? { borderColor: tag.color, color: tag.color }
                                  : undefined
                              }
                            >
                              {tag.name}
                            </Badge>
                          ))}
                          {seed.tags!.length > 3 && (
                            <span className="text-[10px] text-muted-foreground">
                              +{seed.tags!.length - 3}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </ScrollArea>

        {/* Footer */}
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button onClick={onImport} disabled={selectedCount === 0}>
            <Sprout className="size-4 mr-1.5" />
            {selectedCount > 0 ? t("importCount", { count: selectedCount }) : t("import")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
