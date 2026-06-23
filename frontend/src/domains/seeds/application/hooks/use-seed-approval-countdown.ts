"use client";

import { useCallback, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { seedKeys } from "@/domains/planning/domain/query-keys";
import { seedsApi } from "@/domains/planning/infrastructure/api/planning-api";
import type {
  SeedStatus,
  SeedWithRelations,
} from "@/domains/planning/domain/types";

const COUNTDOWN_SECONDS = 10;

interface RetainedSeed {
  item: SeedWithRelations;
  previousStatus: SeedStatus;
  toastId: string | number;
  countdownTimer: ReturnType<typeof setInterval>;
  expirationTimer: ReturnType<typeof setTimeout>;
}

/**
 * Hook that manages a 10-second countdown when a seed is approved from the
 * "active" tab. During the countdown the seed remains visible in the list
 * and a toast with an "Undo" button is shown.
 */
export const useSeedApprovalCountdown = (activeTab: string) => {
  const t = useTranslations("seeds.toasts");
  const queryClient = useQueryClient();

  // Map of seedId -> RetainedSeed kept in a ref to avoid re-renders
  const retainedRef = useRef<Map<string, RetainedSeed>>(new Map());

  // Direct API mutation without automatic query invalidation
  const setStatusDirect = useMutation({
    mutationFn: ({ id, status }: { id: string; status: SeedStatus }) =>
      seedsApi.setStatus(id, status),
  });

  const clearRetained = useCallback((seedId: string) => {
    const entry = retainedRef.current.get(seedId);
    if (!entry) return;
    clearInterval(entry.countdownTimer);
    clearTimeout(entry.expirationTimer);
    retainedRef.current.delete(seedId);
  }, []);

  const invalidateSeeds = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: seedKeys.all });
  }, [queryClient]);

  const handleUndo = useCallback(
    (seedId: string) => {
      const entry = retainedRef.current.get(seedId);
      if (!entry) return;

      const { previousStatus, toastId } = entry;

      // Dismiss the toast
      showToast.dismiss(toastId);
      clearRetained(seedId);

      // Revert status on backend
      setStatusDirect.mutate(
        { id: seedId, status: previousStatus },
        {
          onSuccess: () => {
            invalidateSeeds();
          },
          onError: (error) => {
            showToast.error(
              error instanceof Error ? error.message : t("statusError"),
            );
            invalidateSeeds();
          },
        },
      );
    },
    [clearRetained, invalidateSeeds, setStatusDirect, t],
  );

  const finishCountdown = useCallback(
    (seedId: string) => {
      const entry = retainedRef.current.get(seedId);
      if (!entry) return;
      showToast.dismiss(entry.toastId);
      clearRetained(seedId);
      invalidateSeeds();
    },
    [clearRetained, invalidateSeeds],
  );

  const startCountdown = useCallback(
    (item: SeedWithRelations) => {
      const seedId = item.id;

      // If already tracking this seed, clear previous
      clearRetained(seedId);

      let remaining = COUNTDOWN_SECONDS;

      // Create toast with initial message
      const toastId = showToast.info(
        t("seedApproved", { seconds: remaining }),
        {
          duration: Infinity,
          action: {
            label: t("undo"),
            onClick: () => handleUndo(seedId),
          },
        },
      );

      // Countdown interval - update toast every second
      const countdownTimer = setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) {
          return; // expirationTimer will handle cleanup
        }
        showToast.info(
          t("seedApproved", { seconds: remaining }),
          {
            id: String(toastId),
            duration: Infinity,
            action: {
              label: t("undo"),
              onClick: () => handleUndo(seedId),
            },
          },
        );
      }, 1000);

      // Expiration timer - clean up after countdown
      const expirationTimer = setTimeout(() => {
        finishCountdown(seedId);
      }, COUNTDOWN_SECONDS * 1000);

      retainedRef.current.set(seedId, {
        item,
        previousStatus: item.status,
        toastId,
        countdownTimer,
        expirationTimer,
      });
    },
    [clearRetained, finishCountdown, handleUndo, t],
  );

  /**
   * Wraps the default status-change handler. If the status is "approved" and
   * the current tab is "active", it applies the countdown logic instead of
   * the normal flow.
   *
   * Returns `true` if the countdown was triggered (caller should skip normal flow).
   */
  const handleStatusChangeWithCountdown = useCallback(
    (
      item: SeedWithRelations,
      status: SeedStatus,
      fallback: (item: SeedWithRelations, status: SeedStatus) => void,
    ) => {
      if (status !== "approved" || activeTab !== "active") {
        fallback(item, status);
        return;
      }

      // Call API directly (no auto-invalidation)
      setStatusDirect.mutate(
        { id: item.id, status },
        {
          onSuccess: () => {
            // Don't invalidate queries yet - start countdown instead
            // Invalidate detail query so the detail panel is correct
            queryClient.invalidateQueries({
              queryKey: seedKeys.detail(item.id),
            });
            startCountdown(item);
          },
          onError: (error) => {
            showToast.error(
              error instanceof Error ? error.message : t("statusError"),
            );
          },
        },
      );
    },
    [activeTab, queryClient, setStatusDirect, startCountdown, t],
  );

  /**
   * Merges items from the query result with locally retained approved seeds.
   * Retained seeds that are no longer in the query result (because the backend
   * now returns them under "finished") are re-injected so they stay visible.
   */
  const getVisibleItems = useCallback(
    (queryItems: SeedWithRelations[]): SeedWithRelations[] => {
      if (retainedRef.current.size === 0) return queryItems;

      const queryIds = new Set(queryItems.map((item) => item.id));
      const retained: SeedWithRelations[] = [];

      for (const [seedId, entry] of retainedRef.current) {
        if (!queryIds.has(seedId)) {
          retained.push(entry.item);
        }
      }

      if (retained.length === 0) return queryItems;
      return [...queryItems, ...retained];
    },
    [],
  );

  // Cleanup on unmount
  useEffect(() => {
    const retained = retainedRef.current;
    return () => {
      for (const [, entry] of retained) {
        clearInterval(entry.countdownTimer);
        clearTimeout(entry.expirationTimer);
      }
      retained.clear();
    };
  }, []);

  return {
    handleStatusChangeWithCountdown,
    getVisibleItems,
  };
};
