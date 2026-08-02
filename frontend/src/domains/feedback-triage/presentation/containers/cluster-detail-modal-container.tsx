"use client";

import { useCallback, useState } from "react";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { useClusterDetailModal } from "../../application/hooks";
import { parseLaunchInvestigationError } from "../../application/hooks/use-launch-investigation";
import { parseAbortInvestigationError } from "../../application/hooks/use-abort-investigation";
import { ClusterDetailModal } from "../components/cluster-detail-modal";
import { DismissClusterDialogContainer } from "./dismiss-cluster-dialog-container";
import { ClusterInvestigationAgentRunSlot } from "@/cloud/cluster-investigation-agent-run-slot";
import { ConfirmDialog } from "@/domains/shared/presentation/components/confirm-dialog";
import { useConfirmDialog } from "@/domains/shared/application/hooks/use-confirm-dialog";
import {
  CLUSTER_STATUS_TRANSITIONS,
  type ClusterStatus,
} from "../../domain/types";

/**
 * Statuses that allow launching an investigation.
 */
const LAUNCH_ALLOWED_STATUSES: ClusterStatus[] = ["open", "resolved", "regression"];

/**
 * Container for the cluster detail modal.
 * Wires the orchestrator hook (useClusterDetailModal) to the presentational modal.
 *
 * Responsibilities:
 * - Computes canLaunch based on cluster status. The backend derives the
 *   Almirant projectId server-side from `getAlmirantProjectId()`, so the
 *   frontend no longer needs to resolve or send a projectId.
 * - Handles launch investigation with toast feedback for success/errors (including 409).
 *
 * URL state:
 * - Modal open state is driven by ?clusterId in URL.
 * - Selected ticket is driven by ?ticketId in URL.
 * - Deep-link support: pasting URL with clusterId opens the modal.
 *
 * Usage:
 * Mount at the end of a page/container that uses clusters:
 * <ClusterDetailModalContainer />
 */
export const ClusterDetailModalContainer: React.FC = () => {
  const {
    isOpen,
    detail,
    summaryStats,
    isLoading,
    selectedTicket,
    isLaunching,
    closeModal,
    selectTicket,
    handleLaunch,
    handleAbort,
    isAborting,
    canAbort,
  } = useClusterDetailModal();

  const abortConfirm = useConfirmDialog();

  // Determine if launch is allowed based on cluster status. The backend
  // resolves the Almirant projectId itself, so no project lookup is needed.
  const canLaunchByStatus = detail?.cluster.status
    ? LAUNCH_ALLOWED_STATUSES.includes(detail.cluster.status)
    : false;

  const canLaunch = canLaunchByStatus;

  // Whether the current cluster status allows the `dismissed` transition.
  // Derived from the shared frontend mirror of the backend transition matrix
  // so the UI stays consistent with what the backend will actually accept.
  const canDismiss = detail?.cluster.status
    ? (CLUSTER_STATUS_TRANSITIONS[detail.cluster.status] ?? []).includes(
        "dismissed"
      )
    : false;

  const [dismissDialogOpen, setDismissDialogOpen] = useState(false);
  const handleOpenDismissDialog = useCallback(() => {
    setDismissDialogOpen(true);
  }, []);

  const [agentRunJobId, setAgentRunJobId] = useState<string | null>(null);
  const handleOpenAgentRun = useCallback((jobId: string) => {
    setAgentRunJobId(jobId);
  }, []);
  const handleAgentRunOpenChange = useCallback((open: boolean) => {
    if (!open) setAgentRunJobId(null);
  }, []);

  // Abort-investigation handler (A-1934). Gates the destructive action
  // behind a confirm dialog, then surfaces typed backend errors (INVALID_STATE)
  // as toasts so operators understand why the request was rejected.
  const onAbortInvestigation = useCallback(async () => {
    const ok = await abortConfirm.confirm({
      variant: "destructive",
      title: "Abortar investigación",
      description:
        'Se marcará el intento activo como failed y el cluster volverá a "open". Esta acción es irreversible pero podés relanzar la investigación después.',
      confirmLabel: "Abortar y resetear",
    });
    if (!ok) return;
    try {
      await handleAbort();
      showToast.success("Investigación abortada", {
        description: "El cluster volvió a estado open. Podés relanzar cuando quieras.",
      });
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
  }, [abortConfirm, handleAbort]);

  const onLaunchInvestigation = useCallback(async () => {
    try {
      await handleLaunch();
      showToast.success("Investigacion lanzada", {
        description: "El agente ha sido encolado para analizar este cluster.",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error desconocido";
      const payload = parseLaunchInvestigationError(err);
      switch (payload?.code) {
        case "ACTIVE_ATTEMPT_EXISTS":
          showToast.error("Ya hay una investigacion activa", {
            description: "Puedes ver el intento existente en la columna de fix timeline.",
          });
          break;
        case "MAX_ATTEMPTS_REACHED": {
          const budget = payload.budget;
          const descr = budget
            ? `Este cluster alcanzo ${budget.currentCount}/${budget.maxAttempts} intentos (anchor: ${budget.anchor}). Revisa el historial o ejecuta la auditoria de drift antes de reintentar.`
            : "El cluster alcanzo el maximo de intentos. Revisa el historial antes de reintentar.";
          showToast.error("Presupuesto de reintentos agotado", { description: descr });
          break;
        }
        case "INVALID_STATE":
          showToast.error("Estado del cluster no permite lanzar", {
            description: payload.currentStatus ? `Estado actual: ${payload.currentStatus}` : undefined,
          });
          break;
        case "CLUSTER_EMPTY":
          showToast.error("El cluster no tiene items para investigar", {});
          break;
        default:
          showToast.error("Error al lanzar investigacion", { description: msg });
      }
    }
  }, [handleLaunch]);

  return (
    <>
      <ClusterDetailModal
        isOpen={isOpen}
        onClose={closeModal}
        detail={detail}
        summaryStats={summaryStats}
        isLoading={isLoading}
        selectedTicketId={selectedTicket?.id ?? null}
        onSelectTicket={selectTicket}
        onLaunchInvestigation={onLaunchInvestigation}
        isLaunching={isLaunching}
        canLaunch={canLaunch}
        onOpenAgentRun={handleOpenAgentRun}
        onDismiss={handleOpenDismissDialog}
        canDismiss={canDismiss}
        onAbort={onAbortInvestigation}
        canAbort={canAbort}
        isAborting={isAborting}
      />
      <ConfirmDialog
        isOpen={abortConfirm.isOpen}
        options={abortConfirm.options}
        onConfirm={abortConfirm.handleConfirm}
        onCancel={abortConfirm.handleCancel}
      />
      <DismissClusterDialogContainer
        open={dismissDialogOpen}
        onOpenChange={setDismissDialogOpen}
        clusterId={detail?.cluster.id ?? null}
        clusterTitle={detail?.cluster.title ?? null}
        onDismissed={closeModal}
      />
      <ClusterInvestigationAgentRunSlot
        jobId={agentRunJobId}
        open={agentRunJobId !== null}
        onOpenChange={handleAgentRunOpenChange}
      />
    </>
  );
};
