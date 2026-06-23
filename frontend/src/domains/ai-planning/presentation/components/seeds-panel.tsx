/** @deprecated Use seed-import-dialog.tsx for seed context injection instead */
import { useTranslations } from "next-intl";
import { Search, Sprout } from "lucide-react";
import { Input } from "@/components/ui/input";
import { SeedList } from "@/domains/planning/presentation/components/seed-list";
import { SeedQuickAdd } from "@/domains/planning/presentation/components/seed-quick-add";
import { SeedSelectionBar } from "@/domains/planning/presentation/components/seed-selection-bar";
import type { SeedsPanelProps } from "../../domain/types";

export const SeedsPanel: React.FC<SeedsPanelProps> = ({
  seeds,
  loading,
  selectedIds,
  searchQuery,
  onSearchChange,
  onSeedClick,
  onToggleSelection,
  onSelectAll,
  onDeselectAll,
  onBulkAction,
  onQuickAdd,
  isSubmittingQuickAdd,
}) => {
  const t = useTranslations("aiPlanning");

  // Empty state
  if (!loading && seeds.length === 0 && !searchQuery) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 p-8 flex-1">
        <Sprout className="size-12 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">{t("noSeeds")}</p>
        <div className="w-full max-w-md">
          <SeedQuickAdd
            onSubmit={onQuickAdd}
            isSubmitting={isSubmittingQuickAdd}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-4 flex-1 min-h-0 overflow-y-auto">
      {/* Header with count */}
      <div className="flex items-center gap-2">
        <Sprout className="h-5 w-5 text-emerald-500 shrink-0" />
        <h2 className="text-lg font-semibold">{t("seedsTitle")}</h2>
        <span className="text-sm text-muted-foreground">
          ({seeds.length})
        </span>
      </div>

      {/* Quick add */}
      <SeedQuickAdd
        onSubmit={onQuickAdd}
        isSubmitting={isSubmittingQuickAdd}
      />

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t("searchSeeds")}
          className="pl-9 h-8 text-sm"
        />
      </div>

      {/* Selection bar */}
      {selectedIds.size > 0 && (
        <SeedSelectionBar
          selectedCount={selectedIds.size}
          totalCount={seeds.length}
          onSelectAll={onSelectAll}
          onDeselectAll={onDeselectAll}
          onBulkAction={onBulkAction}
        />
      )}

      {/* Seed list */}
      <SeedList
        seeds={seeds}
        loading={loading}
        onSeedClick={onSeedClick}
        onToggleSelection={onToggleSelection}
        selectedIds={selectedIds}
      />
    </div>
  );
};
