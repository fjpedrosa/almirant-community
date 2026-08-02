"use client";

import { useMemo, useCallback } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useClusterDetailQuery } from "./use-cluster-detail";
import { useClusterBugFixAttempts } from "./use-cluster-bug-fix-attempts";
import { useLaunchInvestigation } from "./use-launch-investigation";
import { useAbortInvestigation } from "./use-abort-investigation";
import { computeClusterSummaryStats } from "../../domain/cluster-summary";
import type { ClusterTicketItem } from "../../domain/types";

/**
 * Orchestrator hook for the cluster detail modal.
 * Manages URL state synchronization for clusterId and ticketId,
 * composes queries and mutation, and provides handlers for modal actions.
 *
 * URL params:
 * - clusterId: Controls modal open state and which cluster to display
 * - ticketId: Controls which ticket is selected within the cluster
 *
 * @returns Modal state, data, loading states, and action handlers
 *
 * @example
 * const {
 *   isOpen,
 *   detail,
 *   selectedTicket,
 *   openCluster,
 *   closeModal,
 *   selectTicket,
 *   handleLaunch,
 * } = useClusterDetailModal();
 */
export const useClusterDetailModal = () => {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // Read URL state
  const clusterId = searchParams.get("clusterId");
  const ticketId = searchParams.get("ticketId");

  // Queries
  const detailQuery = useClusterDetailQuery(clusterId);
  const attemptsQuery = useClusterBugFixAttempts(clusterId);

  // Mutations
  const launchMutation = useLaunchInvestigation();
  const abortMutation = useAbortInvestigation();

  // Derived data
  const detail = detailQuery.data ?? null;
  const tickets = useMemo(() => detail?.tickets ?? [], [detail?.tickets]);
  const attempts = attemptsQuery.data ?? [];
  const summaryStats = useMemo(() => computeClusterSummaryStats(tickets), [tickets]);
  // Lifecycle/incident summary surfaced by the backend (A-1876). Exposed at
  // the top level so consumers (e.g. the cluster detail header) can read it
  // without reaching into `detail` themselves.
  const summary = detail?.summary ?? null;

  // Auto-select first ticket if ticketId not in URL or invalid
  const selectedTicket = useMemo((): ClusterTicketItem | null => {
    if (tickets.length === 0) return null;
    if (ticketId) {
      const found = tickets.find((t) => t.id === ticketId);
      if (found) return found;
    }
    return tickets[0] ?? null;
  }, [tickets, ticketId]);

  // Handlers for URL manipulation
  const openCluster = useCallback(
    (id: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("clusterId", id);
      params.delete("ticketId"); // Reset ticket selection when opening new cluster
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [searchParams, router, pathname]
  );

  const closeModal = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("clusterId");
    params.delete("ticketId");
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  }, [searchParams, router, pathname]);

  const selectTicket = useCallback(
    (id: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("ticketId", id);
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [searchParams, router, pathname]
  );

  // Launch investigation handler. The backend derives the Almirant projectId
  // from `getAlmirantProjectId()` server-side (A-1903), so the frontend does
  // not pass any body fields — just the clusterId in the URL.
  const handleLaunch = useCallback(async () => {
    if (!clusterId) return;
    return launchMutation.mutateAsync({ clusterId });
  }, [clusterId, launchMutation]);

  // Abort investigation handler (A-1934). Returns a Promise so the
  // container can wrap it with confirm + toast.
  const handleAbort = useCallback(async () => {
    if (!clusterId) return;
    return abortMutation.mutateAsync({ clusterId });
  }, [clusterId, abortMutation]);

  // Whether an abort is currently possible: cluster is in `investigating`
  // AND there is an active attempt (covers the edge case of a stuck
  // cluster without an active attempt — the backend also validates).
  const activeAttempt = detail?.activeAttempt ?? null;
  const canAbort =
    detail?.cluster.status === "investigating" && Boolean(activeAttempt);

  return {
    // URL state
    clusterId,
    isOpen: !!clusterId,

    // Data
    detail,
    summary,
    attempts,
    tickets,
    selectedTicket,
    summaryStats,

    // Loading states
    isLoading: detailQuery.isLoading || attemptsQuery.isLoading,
    isLaunching: launchMutation.isPending,
    isAborting: abortMutation.isPending,

    // Derived flags
    canAbort,

    // Errors
    launchError: launchMutation.error,
    abortError: abortMutation.error,

    // Handlers
    openCluster,
    closeModal,
    selectTicket,
    handleLaunch,
    handleAbort,
  };
};
