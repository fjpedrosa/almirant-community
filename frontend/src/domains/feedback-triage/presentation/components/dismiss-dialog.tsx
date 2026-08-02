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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DismissDialogProps {
  /** Whether the dialog is open */
  open: boolean;
  /** Callback when the dialog open state changes */
  onOpenChange: (open: boolean) => void;
  /** Callback to confirm dismissal with optional reason */
  onConfirm: (reason: string) => void;
  /** Whether a dismiss action is in progress */
  isPending: boolean;
  /** Current reason text (controlled) */
  reason: string;
  /** Callback when reason text changes */
  onReasonChange: (reason: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Confirmation dialog for dismissing a feedback item.
 * Includes an optional reason text field.
 *
 * Purely presentational - no hooks or state management.
 * The reason state is lifted to the container.
 *
 * @example
 * <DismissDialog
 *   open={isDismissDialogOpen}
 *   onOpenChange={setDismissDialogOpen}
 *   onConfirm={(reason) => handleDismiss(itemId, reason)}
 *   isPending={dismissMutation.isPending}
 *   reason={dismissReason}
 *   onReasonChange={setDismissReason}
 * />
 */
export function DismissDialog({
  open,
  onOpenChange,
  onConfirm,
  isPending,
  reason,
  onReasonChange,
}: DismissDialogProps) {
  const handleConfirm = () => {
    onConfirm(reason);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Dismiss Item</DialogTitle>
          <DialogDescription>
            This item will be removed from the triage inbox. You can optionally
            provide a reason for dismissal.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="dismiss-reason">Reason (optional)</Label>
            <Textarea
              id="dismiss-reason"
              placeholder="e.g., Duplicate, Not actionable, Spam..."
              value={reason}
              onChange={(e) => onReasonChange(e.target.value)}
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
            variant="destructive"
            onClick={handleConfirm}
            disabled={isPending}
          >
            {isPending ? (
              <span className="flex items-center gap-2">
                <span className="animate-spin rounded-full h-4 w-4 border-2 border-current border-t-transparent" />
                Dismissing...
              </span>
            ) : (
              "Dismiss"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
