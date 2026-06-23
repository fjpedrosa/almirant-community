"use client";

import { useCallback, useMemo } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import type {
  WorkItemType,
  WorkItemTypeFilter,
  WorkItemWithContext,
  WorkItemsByColumn,
} from "../../domain/types";

const VALID_TYPES: WorkItemType[] = ["epic", "feature", "story", "task"];

const isValidTypeFilter = (value: string | null): value is WorkItemType =>
  value !== null && VALID_TYPES.includes(value as WorkItemType);

export const useWorkItemTypeFilter = () => {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const rawType = searchParams.get("type");
  const activeType: WorkItemTypeFilter = isValidTypeFilter(rawType)
    ? rawType
    : "all";

  const setActiveType = useCallback(
    (type: WorkItemTypeFilter) => {
      const params = new URLSearchParams(searchParams.toString());
      if (type === "all") {
        params.delete("type");
      } else {
        params.set("type", type);
      }
      const paramString = params.toString();
      const url = paramString ? `${pathname}?${paramString}` : pathname;
      router.push(url, { scroll: false });
    },
    [searchParams, router, pathname]
  );

  const filterColumnsByType = useCallback(
    (columns: WorkItemsByColumn[]): WorkItemsByColumn[] => {
      if (activeType === "all") return columns;
      return columns.map((col) => ({
        ...col,
        items: col.items.filter((item) => item.type === activeType),
        count: col.items.filter((item) => item.type === activeType).length,
      }));
    },
    [activeType]
  );

  const computeCounts = useCallback(
    (items: WorkItemWithContext[]): Partial<Record<WorkItemTypeFilter, number>> => {
      const counts: Partial<Record<WorkItemTypeFilter, number>> = {
        all: items.length,
      };
      for (const item of items) {
        counts[item.type] = (counts[item.type] ?? 0) + 1;
      }
      return counts;
    },
    []
  );

  return useMemo(
    () => ({
      activeType,
      setActiveType,
      filterColumnsByType,
      computeCounts,
    }),
    [activeType, setActiveType, filterColumnsByType, computeCounts]
  );
};
