import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { TriageInboxItem } from "../../domain/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface InboxItemRowProps {
  /** The inbox item to display */
  item: TriageInboxItem;
  /** Whether this row is currently selected */
  isSelected: boolean;
  /** Callback when the row is clicked */
  onClick: () => void;
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

function getConfidenceBadgeVariant(confidence: string | null): "default" | "secondary" | "outline" {
  if (!confidence) return "outline";
  const confidenceLower = confidence.toLowerCase();
  if (confidenceLower === "high") return "default";
  if (confidenceLower === "medium") return "secondary";
  return "outline";
}

function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Compact row displaying a single inbox item.
 * Shows title, AI category badge, confidence badge, and timestamp.
 *
 * Purely presentational - no hooks or state management.
 *
 * @example
 * <InboxItemRow
 *   item={triageItem}
 *   isSelected={selectedId === triageItem.id}
 *   onClick={() => setSelectedId(triageItem.id)}
 * />
 */
export function InboxItemRow({ item, isSelected, onClick }: InboxItemRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full text-left px-4 py-3 border-b border-border transition-colors",
        "hover:bg-muted/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        isSelected && "bg-muted"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-sm truncate">{item.title}</p>
          {item.authorName && (
            <p className="text-xs text-muted-foreground mt-0.5 truncate">
              {item.authorName}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {item.aiCategory && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
              {item.aiCategory}
            </Badge>
          )}
          {item.aiConfidence && (
            <Badge
              variant={getConfidenceBadgeVariant(item.aiConfidence)}
              className="text-[10px] px-1.5 py-0"
            >
              {item.aiConfidence}
            </Badge>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between mt-1.5">
        {item.suggestedClusterTitle ? (
          <p className="text-xs text-muted-foreground truncate max-w-[70%]">
            Cluster: {item.suggestedClusterTitle}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground/60 italic">No cluster</p>
        )}
        <span className="text-[10px] text-muted-foreground shrink-0">
          {formatTimeAgo(item.createdAt)}
        </span>
      </div>
    </button>
  );
}
