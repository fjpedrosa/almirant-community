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
import { Textarea } from "@/components/ui/textarea";
import type { CreateClusterInput } from "../../domain/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CreateClusterDialogProps {
  /** Whether the dialog is open */
  open: boolean;
  /** Callback when the dialog open state changes */
  onOpenChange: (open: boolean) => void;
  /** Callback to confirm cluster creation */
  onConfirm: (input: CreateClusterInput) => void;
  /** Whether a create action is in progress */
  isPending: boolean;
  /** Current title input (controlled) */
  title: string;
  /** Callback when title changes */
  onTitleChange: (title: string) => void;
  /** Current summary input (controlled) */
  summary: string;
  /** Callback when summary changes */
  onSummaryChange: (summary: string) => void;
  /** ID of the feedback item being added to the cluster */
  feedbackItemId: string | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Dialog for creating a new cluster and assigning the current item to it.
 * Includes title and optional summary fields.
 *
 * Purely presentational - no hooks or state management.
 * All state is lifted to the container.
 *
 * @example
 * <CreateClusterDialog
 *   open={isCreateClusterDialogOpen}
 *   onOpenChange={setCreateClusterDialogOpen}
 *   onConfirm={handleCreateCluster}
 *   isPending={createClusterMutation.isPending}
 *   title={newClusterTitle}
 *   onTitleChange={setNewClusterTitle}
 *   summary={newClusterSummary}
 *   onSummaryChange={setNewClusterSummary}
 *   feedbackItemId={selectedItemId}
 * />
 */
export function CreateClusterDialog({
  open,
  onOpenChange,
  onConfirm,
  isPending,
  title,
  onTitleChange,
  summary,
  onSummaryChange,
  feedbackItemId,
}: CreateClusterDialogProps) {
  const handleConfirm = () => {
    if (title.trim()) {
      onConfirm({
        title: title.trim(),
        summary: summary.trim() || undefined,
        feedbackItemIds: feedbackItemId ? [feedbackItemId] : undefined,
      });
    }
  };

  const isValid = title.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create New Cluster</DialogTitle>
          <DialogDescription>
            Create a new cluster and assign this feedback item to it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="cluster-title">Title</Label>
            <Input
              id="cluster-title"
              placeholder="e.g., Login issues, Dashboard performance..."
              value={title}
              onChange={(e) => onTitleChange(e.target.value)}
              disabled={isPending}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="cluster-summary">Summary (optional)</Label>
            <Textarea
              id="cluster-summary"
              placeholder="Brief description of the cluster..."
              value={summary}
              onChange={(e) => onSummaryChange(e.target.value)}
              disabled={isPending}
              rows={3}
            />
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
                Creating...
              </span>
            ) : (
              "Create Cluster"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
