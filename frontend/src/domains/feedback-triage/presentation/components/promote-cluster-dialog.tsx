import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import type { WorkItemType, Priority } from "@/domains/feedback/domain/types";
import type { BoardWithStats, BoardColumn } from "@/domains/boards/domain/types";
import type { TriageCluster } from "../../domain/types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface PromoteClusterFormValues {
  workItemType: WorkItemType;
  title: string;
  description: string;
  priority: Priority;
  boardId: string;
  boardColumnId: string;
  notes: string;
}

export interface PromoteClusterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cluster: TriageCluster | null;
  boards: BoardWithStats[];
  selectedBoardId: string;
  selectedColumnId: string;
  formValues: PromoteClusterFormValues;
  isPending: boolean;
  onBoardChange: (boardId: string) => void;
  onColumnChange: (columnId: string) => void;
  onFieldChange: <K extends keyof PromoteClusterFormValues>(
    field: K,
    value: PromoteClusterFormValues[K]
  ) => void;
  onSubmit: () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WORK_ITEM_TYPES: { value: WorkItemType; label: string }[] = [
  { value: "task", label: "Task" },
  { value: "story", label: "Story" },
  { value: "feature", label: "Feature" },
  { value: "epic", label: "Epic" },
];

const PRIORITIES: { value: Priority; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];

// ---------------------------------------------------------------------------
// Helper to get columns for selected board
// ---------------------------------------------------------------------------

const getColumnsForBoard = (
  boards: BoardWithStats[],
  boardId: string
): BoardColumn[] => {
  const board = boards.find((b) => b.id === boardId);
  return board?.columns ?? [];
};

// ---------------------------------------------------------------------------
// Component (Pure presentational - no hooks)
// ---------------------------------------------------------------------------

export const PromoteClusterDialog: React.FC<PromoteClusterDialogProps> = ({
  open,
  onOpenChange,
  cluster,
  boards,
  selectedBoardId,
  selectedColumnId,
  formValues,
  isPending,
  onBoardChange,
  onColumnChange,
  onFieldChange,
  onSubmit,
}) => {
  const columns = getColumnsForBoard(boards, selectedBoardId);
  const isFormValid =
    formValues.title.trim() &&
    formValues.workItemType &&
    selectedBoardId &&
    selectedColumnId;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Promote Cluster to Work Item</DialogTitle>
          <DialogDescription>
            Create a new work item from this cluster of {cluster?.itemCount ?? 0}{" "}
            feedback items. All items will be linked to the new work item.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Work Item Type */}
          <div className="space-y-1.5">
            <Label htmlFor="workItemType">Type</Label>
            <Select
              value={formValues.workItemType}
              onValueChange={(value) =>
                onFieldChange("workItemType", value as WorkItemType)
              }
            >
              <SelectTrigger id="workItemType">
                <SelectValue placeholder="Select type" />
              </SelectTrigger>
              <SelectContent>
                {WORK_ITEM_TYPES.map((type) => (
                  <SelectItem key={type.value} value={type.value}>
                    {type.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Title */}
          <div className="space-y-1.5">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              value={formValues.title}
              onChange={(e) => onFieldChange("title", e.target.value)}
              placeholder="Work item title"
            />
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label htmlFor="description">Description (optional)</Label>
            <Textarea
              id="description"
              value={formValues.description}
              onChange={(e) => onFieldChange("description", e.target.value)}
              placeholder="Describe the work item..."
              rows={3}
            />
          </div>

          {/* Priority */}
          <div className="space-y-1.5">
            <Label htmlFor="priority">Priority</Label>
            <Select
              value={formValues.priority}
              onValueChange={(value) =>
                onFieldChange("priority", value as Priority)
              }
            >
              <SelectTrigger id="priority">
                <SelectValue placeholder="Select priority" />
              </SelectTrigger>
              <SelectContent>
                {PRIORITIES.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Board */}
          <div className="space-y-1.5">
            <Label htmlFor="board">Board</Label>
            <Select value={selectedBoardId} onValueChange={onBoardChange}>
              <SelectTrigger id="board">
                <SelectValue placeholder="Select board" />
              </SelectTrigger>
              <SelectContent>
                {boards.map((board) => (
                  <SelectItem key={board.id} value={board.id}>
                    {board.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Column (only show if board is selected) */}
          {selectedBoardId && (
            <div className="space-y-1.5">
              <Label htmlFor="column">Column</Label>
              <Select value={selectedColumnId} onValueChange={onColumnChange}>
                <SelectTrigger id="column">
                  <SelectValue placeholder="Select column" />
                </SelectTrigger>
                <SelectContent>
                  {columns.map((col) => (
                    <SelectItem key={col.id} value={col.id}>
                      {col.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Notes */}
          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes (optional)</Label>
            <Textarea
              id="notes"
              value={formValues.notes}
              onChange={(e) => onFieldChange("notes", e.target.value)}
              placeholder="Internal notes about this promotion..."
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={!isFormValid || isPending}>
            {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Create Work Item
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
