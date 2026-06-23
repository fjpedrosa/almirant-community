"use client";

import { useTranslations } from "next-intl";
import { Sprout } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { SeedListProps } from "../../domain/types";
import { SeedChip } from "./seed-chip";

const ListSkeleton: React.FC = () => (
  <div className="space-y-2">
    {Array.from({ length: 5 }).map((_, i) => (
      <div key={i} className="flex items-center gap-3 rounded-lg border px-3 py-2.5">
        <Skeleton className="h-4 w-4 rounded" />
        <Skeleton className="h-4 w-4 rounded-full" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-3 w-32" />
        </div>
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
    ))}
  </div>
);

const EmptyState: React.FC<{ title: string; description: string }> = ({ title, description }) => (
  <div className="flex flex-col items-center justify-center py-12 text-center">
    <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
      <Sprout className="h-6 w-6 text-muted-foreground" />
    </div>
    <h3 className="text-sm font-medium">{title}</h3>
    <p className="mt-1 max-w-xs text-xs text-muted-foreground">
      {description}
    </p>
  </div>
);

export const SeedList: React.FC<SeedListProps> = ({
  seeds,
  loading,
  onSeedClick,
  onToggleSelection,
  selectedIds,
}) => {
  const t = useTranslations("planning.seedList");

  if (loading) {
    return <ListSkeleton />;
  }

  if (seeds.length === 0) {
    return <EmptyState title={t("emptyTitle")} description={t("emptyDescription")} />;
  }

  return (
    <div className="space-y-1.5" role="list" aria-label={t("ariaLabel")}>
      {seeds.map((seed) => (
        <div key={seed.id} role="listitem">
          <SeedChip
            seed={seed}
            isSelected={selectedIds.has(seed.id)}
            onToggle={onToggleSelection}
            onClick={onSeedClick}
          />
        </div>
      ))}
    </div>
  );
};
