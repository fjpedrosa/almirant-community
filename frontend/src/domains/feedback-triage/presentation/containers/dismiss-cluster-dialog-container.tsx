"use client";

import { useCallback, useState } from "react";

import { useDismissCluster } from "../../application/hooks/use-dismiss-cluster";
import { DismissClusterDialog } from "../components/dismiss-cluster-dialog";

export interface DismissClusterDialogContainerProps {
  /** Whether the dialog is visible. Parent drives the open state. */
  open: boolean;
  /** Called both by X/cancel and after a successful dismiss. */
  onOpenChange: (open: boolean) => void;

  /** Cluster to dismiss. When null the dialog renders nothing actionable. */
  clusterId: string | null;
  clusterTitle: string | null;

  /** Optional hook for parents that want to react to a successful dismiss. */
  onDismissed?: () => void;
}

/**
 * Container for the dismiss-cluster dialog.
 *
 * Owns:
 *   - the optional `reason` textarea state
 *   - the submit → `useDismissCluster` mutation wiring
 *   - auto-close + reset on success
 *
 * Toasts (success and all error branches) are emitted by `useDismissCluster`,
 * so this container only needs to care about the dialog lifecycle.
 */
export const DismissClusterDialogContainer: React.FC<
  DismissClusterDialogContainerProps
> = ({ open, onOpenChange, clusterId, clusterTitle, onDismissed }) => {
  const [reason, setReason] = useState("");

  const mutation = useDismissCluster({
    onSuccess: () => {
      setReason("");
      onOpenChange(false);
      onDismissed?.();
    },
  });

  const handleCancel = useCallback(() => {
    if (mutation.isPending) return;
    setReason("");
    onOpenChange(false);
  }, [mutation.isPending, onOpenChange]);

  const handleConfirm = useCallback(() => {
    if (!clusterId) return;
    const trimmed = reason.trim();
    mutation.mutate({
      clusterId,
      reason: trimmed.length > 0 ? trimmed : undefined,
    });
  }, [clusterId, reason, mutation]);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (mutation.isPending && !next) return;
      if (!next) setReason("");
      onOpenChange(next);
    },
    [mutation.isPending, onOpenChange]
  );

  return (
    <DismissClusterDialog
      open={open}
      onOpenChange={handleOpenChange}
      clusterTitle={clusterTitle}
      reason={reason}
      onReasonChange={setReason}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
      isPending={mutation.isPending}
    />
  );
};
