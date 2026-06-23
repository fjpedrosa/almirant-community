import { useState, useCallback, useMemo } from "react";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import {
  useSprintsByBoard,
  useActiveSprint,
  useSprintWorkItems,
  useNextSprintNumber,
  useDonePreview,
  useCreateSprint,
  useCloseSprint,
  useCloseSprintAdHoc,
  useDonePreviewByDateRange,
  useCloseSprintByDateRange,
} from "./use-sprints";
import { useSprintSummary } from "./use-sprint-summary";
import type {
  CreateSprintRequest,
  SprintWithCount,
  DateRange,
  CloseByDateRangeRequest,
} from "../../domain/types";

const SPRINT_SHARE_BANNER_COOLDOWN_MS = 6 * 60 * 60 * 1000;

const getSprintShareBannerStorageKey = (boardId: string) =>
  `share-cta:sprint:${boardId}:dismissed-at`;

const shouldShowSprintShareBanner = (boardId: string) => {
  if (typeof window === "undefined") return false;
  const value = localStorage.getItem(getSprintShareBannerStorageKey(boardId));
  if (!value) return true;

  const lastDismissedAt = Number(value);
  if (!Number.isFinite(lastDismissedAt)) return true;

  return Date.now() - lastDismissedAt >= SPRINT_SHARE_BANNER_COOLDOWN_MS;
};

export const useSprintHistory = (boardId: string, panelOpen: boolean) => {
  // Dialog state
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const [expandedSprintId, setExpandedSprintId] = useState<string | null>(null);
  const [reportSprintId, setReportSprintId] = useState<string | null>(null);
  const [shareBannerSprint, setShareBannerSprint] = useState<SprintWithCount | null>(null);
  const [autoOpenShareOnReport, setAutoOpenShareOnReport] = useState(false);

  // Date range state for close-by-date
  const [dateRange, setDateRange] = useState<DateRange>({
    from: undefined,
    to: undefined,
  });

  // Queries
  const { data: sprintsData, isLoading: isLoadingSprints } =
    useSprintsByBoard(boardId);
  const { data: activeSprint } = useActiveSprint(boardId);
  const { data: nextNumberData } = useNextSprintNumber(boardId, panelOpen);
  const { data: donePreview, isLoading: isLoadingPreview } = useDonePreview(
    boardId,
    closeDialogOpen
  );
  const { data: expandedSprintItems, isLoading: isLoadingItems } =
    useSprintWorkItems(boardId, expandedSprintId);

  // Date range preview query — format as local date to avoid UTC timezone shift
  const fromISO = dateRange.from
    ? `${dateRange.from.getFullYear()}-${String(dateRange.from.getMonth() + 1).padStart(2, "0")}-${String(dateRange.from.getDate()).padStart(2, "0")}`
    : undefined;
  const toISO = dateRange.to
    ? `${dateRange.to.getFullYear()}-${String(dateRange.to.getMonth() + 1).padStart(2, "0")}-${String(dateRange.to.getDate()).padStart(2, "0")}`
    : undefined;
  const { data: dateRangeDoneItems, isLoading: isLoadingDateRangePreview } =
    useDonePreviewByDateRange(
      boardId,
      fromISO,
      toISO,
      closeDialogOpen && !!dateRange.from && !!dateRange.to
    );

  // Mutations
  const createSprint = useCreateSprint(boardId);
  const closeSprint = useCloseSprint(boardId);
  const closeSprintAdHoc = useCloseSprintAdHoc(boardId);
  const closeSprintByDateRange = useCloseSprintByDateRange(boardId);

  // Derived data
  const hasActiveSprint = !!activeSprint;
  const suggestedName = `Sprint ${nextNumberData?.nextNumber ?? 1}`;

  const closedSprints = useMemo(
    () => (sprintsData ?? []).filter((s) => s.status === "closed"),
    [sprintsData]
  );

  // Only fetch summary for expanded closed sprints
  const isExpandedSprintClosed = useMemo(
    () => closedSprints.some((s) => s.id === expandedSprintId),
    [closedSprints, expandedSprintId]
  );

  const { summary: expandedSprintSummary, isLoading: isLoadingSummary } =
    useSprintSummary(isExpandedSprintClosed ? expandedSprintId : null);

  // Handlers
  const handleToggleExpand = useCallback((sprintId: string) => {
    setExpandedSprintId((prev) => (prev === sprintId ? null : sprintId));
  }, []);

  const handleCreateSprint = useCallback(
    (data: CreateSprintRequest) => {
      createSprint.mutate(data, {
        onSuccess: () => {
          showToast.success("Sprint creado");
          setCreateDialogOpen(false);
        },
        onError: (error) => {
          showToast.error(error.message || "Error al crear sprint");
        },
      });
    },
    [createSprint]
  );

  const handleSprintClosed = useCallback((closedSprint: SprintWithCount) => {
    if (shouldShowSprintShareBanner(boardId)) {
      setShareBannerSprint(closedSprint);
    }
  }, [boardId]);

  const handleCloseSprint = useCallback(
    (name?: string) => {
      if (hasActiveSprint && activeSprint) {
        closeSprint.mutate(activeSprint.id, {
          onSuccess: (closedSprint) => {
            showToast.success("Sprint cerrado");
            setCloseDialogOpen(false);
            handleSprintClosed(closedSprint);
          },
          onError: (error) => {
            showToast.error(error.message || "Error al cerrar sprint");
          },
        });
      } else if (name) {
        closeSprintAdHoc.mutate(name, {
          onSuccess: (closedSprint) => {
            showToast.success("Sprint cerrado");
            setCloseDialogOpen(false);
            handleSprintClosed(closedSprint);
          },
          onError: (error) => {
            showToast.error(error.message || "Error al cerrar sprint");
          },
        });
      }
    },
    [hasActiveSprint, activeSprint, closeSprint, closeSprintAdHoc, handleSprintClosed]
  );

  const handleCloseSprintByDateRange = useCallback(
    (data: CloseByDateRangeRequest) => {
      closeSprintByDateRange.mutate(data, {
        onSuccess: (closedSprint) => {
          showToast.success("Sprint cerrado por rango de fechas");
          setCloseDialogOpen(false);
          setDateRange({ from: undefined, to: undefined });
          handleSprintClosed(closedSprint);
        },
        onError: (error) => {
          showToast.error(error.message || "Error al cerrar sprint por fechas");
        },
      });
    },
    [closeSprintByDateRange, handleSprintClosed]
  );

  const handleDateRangeChange = useCallback((range: DateRange) => {
    setDateRange(range);
  }, []);

  const handleViewReport = useCallback((sprintId: string) => {
    setReportSprintId(sprintId);
    setAutoOpenShareOnReport(false);
  }, []);

  const handleCloseReport = useCallback(() => {
    setReportSprintId(null);
    setAutoOpenShareOnReport(false);
  }, []);

  const handleShareBannerDismiss = useCallback(() => {
    setShareBannerSprint(null);
    if (typeof window === "undefined") return;
    localStorage.setItem(
      getSprintShareBannerStorageKey(boardId),
      String(Date.now())
    );
  }, [boardId]);

  const handleShareBannerAction = useCallback(() => {
    if (!shareBannerSprint) return;
    setReportSprintId(shareBannerSprint.id);
    setAutoOpenShareOnReport(true);
    setShareBannerSprint(null);
    if (typeof window !== "undefined") {
      localStorage.setItem(
        getSprintShareBannerStorageKey(boardId),
        String(Date.now())
      );
    }
  }, [boardId, shareBannerSprint]);

  return {
    // Dialog state
    createDialogOpen,
    setCreateDialogOpen,
    closeDialogOpen,
    setCloseDialogOpen,

    // Data
    activeSprint: (activeSprint ?? null) as SprintWithCount | null,
    closedSprints,
    isLoadingSprints,
    expandedSprintId,
    expandedSprintItems: expandedSprintItems ?? [],
    isLoadingItems,
    donePreview: donePreview ?? [],
    isLoadingPreview,
    hasActiveSprint,
    suggestedName,

    // Date range data
    dateRange,
    handleDateRangeChange,
    dateRangeDoneItems: dateRangeDoneItems ?? [],
    isLoadingDateRangePreview,

    // Summary data
    expandedSprintSummary,
    isLoadingSummary,

    // Report state
    reportSprintId,
    reportDialogOpen: !!reportSprintId,
    autoOpenShareOnReport,
    handleViewReport,
    handleCloseReport,
    shareBannerSprint,
    handleShareBannerDismiss,
    handleShareBannerAction,

    // Handlers
    handleToggleExpand,
    handleCreateSprint,
    handleCloseSprint,
    handleCloseSprintByDateRange,
    isCreating: createSprint.isPending,
    isClosing:
      closeSprint.isPending ||
      closeSprintAdHoc.isPending ||
      closeSprintByDateRange.isPending,
  };
};
