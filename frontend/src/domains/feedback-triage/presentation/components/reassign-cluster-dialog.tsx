import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ReassignClusterDialogProps {
  /** Whether the dialog is open */
  open: boolean;
  /** Callback when the dialog open state changes */
  onOpenChange: (open: boolean) => void;
  /** Callback to confirm reassignment */
  onConfirm: (clusterId: string) => void;
  /** Whether a reassign action is in progress */
  isPending: boolean;
  /** Current cluster ID input (controlled) */
  clusterId: string;
  /** Callback when cluster ID changes */
  onClusterIdChange: (clusterId: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Dialog for reassigning a feedback item to a different cluster.
 * Currently uses a simple text input for cluster ID.
 * A full combobox with cluster search can be added later.
 *
 * Purely presentational - no hooks or state management.
 * The clusterId state is lifted to the container.
 *
 * @example
 * <ReassignClusterDialog
 *   open={isReassignDialogOpen}
 *   onOpenChange={setReassignDialogOpen}
 *   onConfirm={(clusterId) => handleReassign(itemId, clusterId)}
 *   isPending={reassignMutation.isPending}
 *   clusterId={reassignClusterId}
 *   onClusterIdChange={setReassignClusterId}
 * />
 */
export function ReassignClusterDialog({
  open,
  onOpenChange,
  onConfirm,
  isPending,
  clusterId,
  onClusterIdChange,
}: ReassignClusterDialogProps) {
  const handleConfirm = () => {
    if (clusterId.trim()) {
      onConfirm(clusterId.trim());
    }
  };

  const isValid = clusterId.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reassign to Cluster</DialogTitle>
          <DialogDescription>
            Move this item to a different cluster. Enter the cluster ID below.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="cluster-id">Cluster ID</Label>
            <Input
              id="cluster-id"
              placeholder="Enter cluster UUID..."
              value={clusterId}
              onChange={(e) => onClusterIdChange(e.target.value)}
              disabled={isPending}
            />
            <p className="text-xs text-muted-foreground">
              You can find cluster IDs in the Clusters view.
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={isPending || !isValid}
          >
            {isPending ? (
              <span className="flex items-center gap-2">
                <span className="animate-spin rounded-full h-4 w-4 border-2 border-current border-t-transparent" />
                Reassigning...
              </span>
            ) : (
              "Reassign"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
