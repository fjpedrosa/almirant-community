"use client";

import { useState, useCallback } from "react";
import { Layers, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ListPageShell } from "@/domains/shared/presentation/components/list-page-shell";
import { ListSelectionActionBar } from "@/domains/shared/presentation/components/list-selection-action-bar";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { ConfirmDialog } from "@/domains/shared/presentation/components/confirm-dialog";
import { useConfirmDialog } from "@/domains/shared/application/hooks/use-confirm-dialog";
import {
  usePromoteCluster,
  useClusterDetailModal,
  useBatchLaunchInvestigation,
} from "../../application/hooks";
import { useClustersTable } from "../../application/hooks/use-clusters-table";
import { useTransitionCluster } from "../../application/hooks/use-transition-cluster";
import {
  useAbortInvestigation,
  parseAbortInvestigationError,
} from "../../application/hooks/use-abort-investigation";
import { ClusterDetailModalContainer } from "./cluster-detail-modal-container";
import { DismissClusterDialogContainer } from "./dismiss-cluster-dialog-container";
import { useAllBoards } from "@/domains/boards/application/hooks/use-boards";
import { ClustersDataTable } from "../components/clusters-data-table";
import { ClusterActionsMenu } from "../components/cluster-actions-menu";
import { ClustersFilterBar } from "../components/clusters-filter-bar";
import {
  PromoteClusterDialog,
  type PromoteClusterFormValues,
} from "../components/promote-cluster-dialog";
import type {
  ClusterActionKind,
  ClusterRow,
  ClusterStatus,
  TriageCluster,
} from "../../domain/types";

// ---------------------------------------------------------------------------
// Default values
// ---------------------------------------------------------------------------

const DEFAULT_FORM_VALUES: PromoteClusterFormValues = {
  workItemType: "story",
  title: "",
  description: "",
  priority: "medium",
  boardId: "",
  boardColumnId: "",
  notes: "",
};

// Map from action kind to target cluster status for inline transitions.
// `abort` is intentionally absent: it's a maintenance action that goes through
// a dedicated mutation/endpoint and does not correspond to a status transition.
const ACTION_TO_STATUS: Partial<Record<ClusterActionKind, ClusterStatus>> = {
  investigate: "investigating",
  mark_fix_ready: "fix_ready",
  resolve: "resolved",
  reopen: "open",
  mark_regression: "regression",
  dismiss: "dismissed",
};

// Statuses from which launching an investigation is allowed. Aligned with the
// backend serial service: `investigating`, `fix_ready`, `dismissed`, and
// `promoted` are excluded.
const LAUNCH_ELIGIBLE_STATUSES: ClusterStatus[] = [
  "open",
  "resolved",
  "regression",
];

// ---------------------------------------------------------------------------
// Container
// ---------------------------------------------------------------------------

export const ClustersContainer: React.FC = () => {
  // ---------------------------------------------------------------------------
  // URL-synced filters + clusters query (rows flattened by topic)
  // ---------------------------------------------------------------------------

  const {
    filters,
    handleStatusesChange,
    handleShowResolvedChange,
    handleMinItemCountChange,
    handleSortChange,
    handleClearFilters,
    clustersQuery,
    rows,
  } = useClustersTable();

  // ---------------------------------------------------------------------------
  // Data fetching (boards + promote mutation)
  // ---------------------------------------------------------------------------

  const { data: boards = [] } = useAllBoards();
  const promoteClusterMutation = usePromoteCluster();
  const transitionMutation = useTransitionCluster();
  const abortInvestigationMutation = useAbortInvestigation();
  const abortConfirm = useConfirmDialog();

  // ---------------------------------------------------------------------------
  // Promote dialog state
  // ---------------------------------------------------------------------------

  const [promoteDialogOpen, setPromoteDialogOpen] = useState(false);
  const [selectedCluster, setSelectedCluster] = useState<TriageCluster | null>(null);
  const [formValues, setFormValues] = useState<PromoteClusterFormValues>(DEFAULT_FORM_VALUES);
  const [selectedBoardId, setSelectedBoardId] = useState("");
  const [selectedColumnId, setSelectedColumnId] = useState("");

  // ---------------------------------------------------------------------------
  // Dismiss dialog (confirmation) - kept for future use
  // ---------------------------------------------------------------------------

  const dismissDialog = useConfirmDialog();

  // ---------------------------------------------------------------------------
  // Dismiss-cluster dialog (reason capture + cascade)
  // ---------------------------------------------------------------------------

  const [dismissClusterOpen, setDismissClusterOpen] = useState(false);
  const [dismissClusterTarget, setDismissClusterTarget] = useState<{
    id: string;
    title: string;
  } | null>(null);

  // ---------------------------------------------------------------------------
  // Cluster detail modal
  // ---------------------------------------------------------------------------

  const { openCluster } = useClusterDetailModal();

  // ---------------------------------------------------------------------------
  // Batch launch investigation — multi-select state
  // ---------------------------------------------------------------------------

  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  const isSelectable = useCallback(
    (row: ClusterRow) => LAUNCH_ELIGIBLE_STATUSES.includes(row.status),
    [],
  );

  const toggleRow = useCallback((clusterId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(clusterId)) next.delete(clusterId);
      else next.add(clusterId);
      return next;
    });
  }, []);

  const toggleAllVisible = useCallback(
    (ids: string[], nextSelected: boolean) => {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of ids) {
          if (nextSelected) next.add(id);
          else next.delete(id);
        }
        return next;
      });
    },
    [],
  );

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  // Clear selection whenever filters change. `filters` is memoized by
  // `useClustersTable` against `searchParams`, so this only fires when the
  // URL-synced filter state actually changes. Adjusted during render (React's
  // recommended pattern for "reset state when a prop changes") instead of an
  // Effect, which would run one commit late and trigger a second render pass.
  const [prevFilters, setPrevFilters] = useState(filters);
  if (filters !== prevFilters) {
    setPrevFilters(filters);
    setSelectedIds(new Set());
  }

  const batchLaunchMutation = useBatchLaunchInvestigation({
    onSuccess: (data) => {
      const { launched, total, codeCounts } = data.summary;
      const codeBreakdown = Object.entries(codeCounts)
        .map(([code, count]) => `${code}: ${count}`)
        .join(", ");
      if (launched === total) {
        showToast.success(`${launched} investigaciones lanzadas`);
      } else if (launched === 0) {
        showToast.error("Ninguna investigación lanzada", {
          description: codeBreakdown,
        });
      } else {
        showToast.info(`${launched} lanzadas · ${total - launched} saltadas`, {
          description: codeBreakdown,
        });
      }
      clearSelection();
    },
    onError: (err) =>
      showToast.error("Error al lanzar investigaciones", {
        description: err.message,
      }),
  });

  const handleBatchLaunch = useCallback(() => {
    if (selectedIds.size === 0) return;
    batchLaunchMutation.mutate({ clusterIds: Array.from(selectedIds) });
  }, [selectedIds, batchLaunchMutation]);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleOpenDetail = useCallback(
    (cluster: ClusterRow) => {
      openCluster(cluster.id);
    },
    [openCluster]
  );

  // The `currentStatus` argument is accepted at the call-site (row.status) to
  // match the scoped API of `handleTransition(row.id, row.status)`, even though
  // the backend computes/validates the transition from the cluster id alone.
  //
  // `dismiss` is special: it opens the dedicated dismiss-cluster dialog
  // (A-1913) so the user can capture a reason and see the cascade warning
  // before the destructive backend action fires. All other actions fall
  // through to the generic `transitionCluster` mutation.
  const handleTransition = useCallback(
    (clusterId: string, _currentStatus: ClusterStatus) => {
      void _currentStatus;
      return async (action: ClusterActionKind) => {
        if (action === "dismiss") {
          const row = rows.find((r) => r.id === clusterId);
          setDismissClusterTarget({
            id: clusterId,
            title: row?.title ?? "",
          });
          setDismissClusterOpen(true);
          return;
        }
        if (action === "abort") {
          const ok = await abortConfirm.confirm({
            variant: "destructive",
            title: "Abortar investigación",
            description:
              'Se marcará el intento activo como failed y el cluster volverá a "open". Esta acción es irreversible pero podés relanzar la investigación después.',
            confirmLabel: "Abortar y resetear",
          });
          if (!ok) return;
          try {
            await abortInvestigationMutation.mutateAsync({ clusterId });
            showToast.success("Investigación abortada");
          } catch (err) {
            const payload = parseAbortInvestigationError(err);
            const description =
              payload?.code === "INVALID_STATE"
                ? `Cluster no está en investigating (actual: ${payload.currentStatus ?? "desconocido"})`
                : err instanceof Error
                  ? err.message
                  : "Error al abortar investigación";
            showToast.error("Error al abortar investigación", { description });
          }
          return;
        }
        const toStatus = ACTION_TO_STATUS[action];
        if (!toStatus) return;
        transitionMutation.mutate({ clusterId, toStatus, reason: undefined });
      };
    },
    [transitionMutation, rows, abortConfirm, abortInvestigationMutation]
  );

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept for PromoteClusterDialog, will be wired from detail modal
  const handlePromoteClick = useCallback((cluster: TriageCluster) => {
    setSelectedCluster(cluster);

    // Pre-fill form with cluster suggestions
    setFormValues({
      workItemType: cluster.suggestedType ?? "story",
      title: cluster.title,
      description: cluster.summary ?? "",
      priority: cluster.suggestedPriority ?? "medium",
      boardId: "",
      boardColumnId: "",
      notes: "",
    });

    // Reset board/column selection
    setSelectedBoardId("");
    setSelectedColumnId("");

    setPromoteDialogOpen(true);
  }, []);

  const handleBoardChange = useCallback(
    (boardId: string) => {
      setSelectedBoardId(boardId);
      // Auto-select first column of the board
      const board = boards.find((b) => b.id === boardId);
      const firstColumn = board?.columns?.[0];
      setSelectedColumnId(firstColumn?.id ?? "");
    },
    [boards]
  );

  const handleColumnChange = useCallback((columnId: string) => {
    setSelectedColumnId(columnId);
  }, []);

  const handleFieldChange = useCallback(
    <K extends keyof PromoteClusterFormValues>(
      field: K,
      value: PromoteClusterFormValues[K]
    ) => {
      setFormValues((prev) => ({ ...prev, [field]: value }));
    },
    []
  );

  const handlePromoteSubmit = useCallback(() => {
    if (!selectedCluster || !selectedBoardId || !selectedColumnId) return;

    promoteClusterMutation.mutate(
      {
        clusterId: selectedCluster.id,
        input: {
          workItemType: formValues.workItemType,
          title: formValues.title.trim(),
          description: formValues.description.trim() || undefined,
          priority: formValues.priority,
          boardId: selectedBoardId,
          boardColumnId: selectedColumnId,
          notes: formValues.notes.trim() || undefined,
        },
      },
      {
        onSuccess: (data) => {
          showToast.success("Cluster promoted", {
            description: `Created work item: ${data.workItem.title}`,
          });
          setPromoteDialogOpen(false);
          setSelectedCluster(null);
        },
        onError: (error) => {
          showToast.error("Failed to promote cluster", {
            description: error.message,
          });
        },
      }
    );
  }, [selectedCluster, selectedBoardId, selectedColumnId, formValues, promoteClusterMutation]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <>
      <ListPageShell
        contained={false}
        header={
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Layers className="h-6 w-6" />
              Cluster Triage
            </h1>
            <p className="text-muted-foreground">
              Review grouped feedback clusters and promote them to work items
            </p>
          </div>
        }
        filters={
          <ClustersFilterBar
            filters={filters}
            onStatusesChange={handleStatusesChange}
            onShowResolvedChange={handleShowResolvedChange}
            onMinItemCountChange={handleMinItemCountChange}
            onSortChange={handleSortChange}
            onClearFilters={handleClearFilters}
          />
        }
      >
        <ClustersDataTable
          rows={rows}
          isLoading={clustersQuery.isLoading}
          onOpenDetail={handleOpenDetail}
          selectedIds={selectedIds}
          onToggleRow={toggleRow}
          onToggleAllVisible={toggleAllVisible}
          getIsSelectable={isSelectable}
          renderActions={(row) => (
            <ClusterActionsMenu
              cluster={row}
              onTransition={handleTransition(row.id, row.status)}
              isPending={
                transitionMutation.isPending ||
                abortInvestigationMutation.isPending
              }
            />
          )}
        />
      </ListPageShell>

      {selectedIds.size > 0 && (
        <ListSelectionActionBar
          selectedCount={selectedIds.size}
          onClearSelection={clearSelection}
        >
          <Button
            size="sm"
            onClick={handleBatchLaunch}
            disabled={batchLaunchMutation.isPending}
          >
            {batchLaunchMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <Search className="h-4 w-4 mr-1.5" />
            )}
            Lanzar investigación ({selectedIds.size})
          </Button>
        </ListSelectionActionBar>
      )}

      <PromoteClusterDialog
        open={promoteDialogOpen}
        onOpenChange={setPromoteDialogOpen}
        cluster={selectedCluster}
        boards={boards}
        selectedBoardId={selectedBoardId}
        selectedColumnId={selectedColumnId}
        formValues={formValues}
        isPending={promoteClusterMutation.isPending}
        onBoardChange={handleBoardChange}
        onColumnChange={handleColumnChange}
        onFieldChange={handleFieldChange}
        onSubmit={handlePromoteSubmit}
      />

      <ConfirmDialog
        isOpen={dismissDialog.isOpen}
        options={dismissDialog.options}
        onConfirm={dismissDialog.handleConfirm}
        onCancel={dismissDialog.handleCancel}
      />

      <ConfirmDialog
        isOpen={abortConfirm.isOpen}
        options={abortConfirm.options}
        onConfirm={abortConfirm.handleConfirm}
        onCancel={abortConfirm.handleCancel}
      />

      <DismissClusterDialogContainer
        open={dismissClusterOpen}
        onOpenChange={(next) => {
          setDismissClusterOpen(next);
          if (!next) setDismissClusterTarget(null);
        }}
        clusterId={dismissClusterTarget?.id ?? null}
        clusterTitle={dismissClusterTarget?.title ?? null}
      />

      <ClusterDetailModalContainer />
    </>
  );
};
