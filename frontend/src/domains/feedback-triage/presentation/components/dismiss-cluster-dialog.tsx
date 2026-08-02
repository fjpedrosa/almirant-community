"use client";

import { Loader2, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export const DISMISS_CLUSTER_REASON_MAX_LENGTH = 2000;

export interface DismissClusterDialogProps {
  /** Controls visibility — container owns the open state. */
  open: boolean;
  onOpenChange: (open: boolean) => void;

  /**
   * Title of the cluster being dismissed. Rendered inside the description
   * so the user confirms the correct one before the destructive action.
   */
  clusterTitle: string | null;

  /**
   * Reason text bound to the textarea. Parent is responsible for state so
   * the component can stay purely presentational (no `useState`).
   */
  reason: string;
  onReasonChange: (value: string) => void;

  onConfirm: () => void;
  onCancel: () => void;

  /** Disables the confirm button and shows the spinner while the mutation runs. */
  isPending: boolean;
}

/**
 * Destructive confirmation dialog for dismissing a feedback cluster.
 *
 * Presentational only — the parent container wires it to `useDismissCluster`
 * and manages the open/reason state. The dialog:
 *
 *   - Clearly labels itself "Descartar cluster" with a destructive intent.
 *   - Names the cluster in the description so the user can sanity-check.
 *   - Offers an optional free-text `reason` (max 2000 chars) that the backend
 *     persists in `cluster_status_history.reason`.
 *   - Shows a loading spinner while the mutation is in flight and disables
 *     the confirm button so the action cannot be double-submitted.
 */
export const DismissClusterDialog: React.FC<DismissClusterDialogProps> = ({
  open,
  onOpenChange,
  clusterTitle,
  reason,
  onReasonChange,
  onConfirm,
  onCancel,
  isPending,
}) => {
  const remaining = DISMISS_CLUSTER_REASON_MAX_LENGTH - reason.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <XCircle className="h-5 w-5 text-destructive" aria-hidden="true" />
            Descartar cluster
          </DialogTitle>
          <DialogDescription>
            {clusterTitle ? (
              <>
                Esta acción descartará el cluster{" "}
                <span className="font-medium text-foreground">
                  &ldquo;{clusterTitle}&rdquo;
                </span>{" "}
                y cancelará todos sus tickets no-terminales. No se puede
                revertir desde la UI.
              </>
            ) : (
              <>
                Esta acción descartará el cluster y cancelará todos sus tickets
                no-terminales. No se puede revertir desde la UI.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="dismiss-cluster-reason">
            Motivo{" "}
            <span className="text-muted-foreground font-normal">
              (opcional)
            </span>
          </Label>
          <Textarea
            id="dismiss-cluster-reason"
            value={reason}
            onChange={(event) => onReasonChange(event.target.value)}
            maxLength={DISMISS_CLUSTER_REASON_MAX_LENGTH}
            rows={4}
            placeholder="Ej: ruido, duplicado, fuera de alcance…"
            disabled={isPending}
          />
          <p
            className="text-right text-xs text-muted-foreground"
            aria-live="polite"
          >
            {remaining} caracteres restantes
          </p>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={isPending}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={onConfirm}
            disabled={isPending}
            aria-label="Confirmar descartar cluster"
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <XCircle className="h-4 w-4" aria-hidden="true" />
            )}
            Descartar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
