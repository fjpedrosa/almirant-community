import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  CheckCircle,
  XCircle,
  GitBranch,
  FolderPlus,
  Sparkles,
  User,
  Calendar,
} from "lucide-react";
import type { TriageInboxItem } from "../../domain/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface InboxDetailPanelProps {
  /** The selected item to display, or null if none selected */
  item: TriageInboxItem | null;
  /** Callback to confirm the AI suggestion */
  onConfirm: () => void;
  /** Callback to open dismiss dialog */
  onDismiss: () => void;
  /** Callback to open reassign dialog */
  onReassign: () => void;
  /** Callback to open create cluster dialog */
  onCreateCluster: () => void;
  /** Whether a confirm action is in progress */
  isConfirming: boolean;
  /** Whether a dismiss action is in progress */
  isDismissing: boolean;
  /** Whether a reassign action is in progress */
  isReassigning: boolean;
  /** Whether a create cluster action is in progress */
  isCreatingCluster: boolean;
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getConfidenceColor(confidence: string | null): string {
  if (!confidence) return "text-muted-foreground";
  const confidenceLower = confidence.toLowerCase();
  if (confidenceLower === "high") return "text-emerald-600 dark:text-emerald-400";
  if (confidenceLower === "medium") return "text-amber-600 dark:text-amber-400";
  return "text-muted-foreground";
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function DetailEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-6">
      <div className="rounded-full bg-muted p-4 mb-4">
        <Sparkles className="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 className="font-medium">Select an item</h3>
      <p className="text-muted-foreground text-sm mt-1">
        Choose an item from the list to view details and take action.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Detail panel showing full information about a selected inbox item.
 * Displays title, content, AI suggestions, and action buttons.
 *
 * Purely presentational - no hooks or state management.
 *
 * @example
 * <InboxDetailPanel
 *   item={selectedItem}
 *   onConfirm={handleConfirm}
 *   onDismiss={handleDismiss}
 *   onReassign={handleReassign}
 *   onCreateCluster={handleCreateCluster}
 *   isConfirming={confirmMutation.isPending}
 *   isDismissing={dismissMutation.isPending}
 *   isReassigning={false}
 *   isCreatingCluster={false}
 * />
 */
export function InboxDetailPanel({
  item,
  onConfirm,
  onDismiss,
  onReassign,
  onCreateCluster,
  isConfirming,
  isDismissing,
  isReassigning,
  isCreatingCluster,
}: InboxDetailPanelProps) {
  if (!item) {
    return <DetailEmptyState />;
  }

  const isAnyActionPending = isConfirming || isDismissing || isReassigning || isCreatingCluster;

  return (
    <ScrollArea className="h-full">
      <div className="p-6 space-y-6">
        {/* Header: Title and metadata */}
        <div>
          <h2 className="text-lg font-semibold leading-tight">{item.title}</h2>
          <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
            {item.authorName && (
              <span className="flex items-center gap-1.5">
                <User className="h-3.5 w-3.5" />
                {item.authorName}
              </span>
            )}
            <span className="flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" />
              {formatDate(item.createdAt)}
            </span>
          </div>
        </div>

        {/* Content */}
        {item.content && (
          <Card>
            <CardHeader className="pb-2">
              <h3 className="text-sm font-medium">Content</h3>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                {item.content}
              </p>
            </CardContent>
          </Card>
        )}

        {/* AI Suggestions */}
        <Card>
          <CardHeader className="pb-2">
            <h3 className="text-sm font-medium flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-violet-500" />
              AI Analysis
            </h3>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Category</p>
                {item.aiCategory ? (
                  <Badge variant="secondary">{item.aiCategory}</Badge>
                ) : (
                  <span className="text-sm text-muted-foreground/60 italic">
                    Not categorized
                  </span>
                )}
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Confidence</p>
                {item.aiConfidence ? (
                  <span className={`text-sm font-medium ${getConfidenceColor(item.aiConfidence)}`}>
                    {item.aiConfidence}
                  </span>
                ) : (
                  <span className="text-sm text-muted-foreground/60 italic">
                    Unknown
                  </span>
                )}
              </div>
            </div>

            {item.aiReasoning && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Reasoning</p>
                <p className="text-sm text-muted-foreground bg-muted/50 rounded-md p-3">
                  {item.aiReasoning}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Suggested Cluster */}
        <Card>
          <CardHeader className="pb-2">
            <h3 className="text-sm font-medium flex items-center gap-2">
              <GitBranch className="h-4 w-4 text-blue-500" />
              Suggested Cluster
            </h3>
          </CardHeader>
          <CardContent>
            {item.suggestedClusterId ? (
              <div className="space-y-2">
                <p className="text-sm font-medium">{item.suggestedClusterTitle}</p>
                {item.suggestedTopicTitle && (
                  <p className="text-xs text-muted-foreground">
                    Topic: {item.suggestedTopicTitle}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground/60 italic">
                No cluster suggested. Consider creating a new cluster.
              </p>
            )}
          </CardContent>
        </Card>

        <Separator />

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={onConfirm}
            disabled={isAnyActionPending || !item.suggestedClusterId}
            className="flex-1 sm:flex-none"
          >
            {isConfirming ? (
              <span className="flex items-center gap-2">
                <span className="animate-spin rounded-full h-4 w-4 border-2 border-current border-t-transparent" />
                Confirming...
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4" />
                Confirm
              </span>
            )}
          </Button>

          <Button
            variant="outline"
            onClick={onReassign}
            disabled={isAnyActionPending}
            className="flex-1 sm:flex-none"
          >
            <GitBranch className="h-4 w-4 mr-2" />
            Reassign
          </Button>

          <Button
            variant="outline"
            onClick={onCreateCluster}
            disabled={isAnyActionPending}
            className="flex-1 sm:flex-none"
          >
            <FolderPlus className="h-4 w-4 mr-2" />
            New Cluster
          </Button>

          <Button
            variant="ghost"
            onClick={onDismiss}
            disabled={isAnyActionPending}
            className="flex-1 sm:flex-none text-destructive hover:text-destructive hover:bg-destructive/10"
          >
            {isDismissing ? (
              <span className="flex items-center gap-2">
                <span className="animate-spin rounded-full h-4 w-4 border-2 border-current border-t-transparent" />
                Dismissing...
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <XCircle className="h-4 w-4" />
                Dismiss
              </span>
            )}
          </Button>
        </div>
      </div>
    </ScrollArea>
  );
}
