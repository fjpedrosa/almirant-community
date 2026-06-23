"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { workItemsApi } from "@/lib/api/client";
import { useOrgScopedKey } from "@/lib/query-keys";
import type { WorkItemParticipant } from "../../domain/types";
import { workItemKeys } from "./use-work-items";

const normalizeIds = (ids: string[]) =>
  Array.from(new Set(ids.filter(Boolean))).sort();

export const useWorkItemParticipants = (workItemIds: string[]) => {
  const normalizedIds = useMemo(() => normalizeIds(workItemIds), [workItemIds]);
  const idsHash = useMemo(() => normalizedIds.join(","), [normalizedIds]);
  const scopedKey = useOrgScopedKey(workItemKeys.participants(idsHash));

  return useQuery({
    queryKey: scopedKey,
    queryFn: async () => {
      const response = await workItemsApi.getParticipants(normalizedIds);
      return response as Record<string, WorkItemParticipant[]>;
    },
    enabled: normalizedIds.length > 0,
  });
};
