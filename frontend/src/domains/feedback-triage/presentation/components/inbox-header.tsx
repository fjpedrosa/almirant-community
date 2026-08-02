import { Badge } from "@/components/ui/badge";
import { Inbox } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface InboxHeaderProps {
  /** Total number of items in the inbox */
  totalItems: number;
  /** Whether the count is still loading */
  isLoading: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Header for the triage inbox page.
 * Shows title, description, and item count badge.
 *
 * Purely presentational - no hooks or state management.
 *
 * @example
 * <InboxHeader totalItems={data?.meta.total ?? 0} isLoading={isLoading} />
 */
export function InboxHeader({ totalItems, isLoading }: InboxHeaderProps) {
  return (
    <div>
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Inbox className="h-6 w-6" />
          Feedback Triage
        </h1>
        {!isLoading && (
          <Badge variant="secondary" className="text-sm">
            {totalItems} pending
          </Badge>
        )}
      </div>
      <p className="text-muted-foreground mt-1">
        Review and categorize uncertain feedback items. Confirm AI suggestions,
        reassign to clusters, or dismiss items.
      </p>
    </div>
  );
}
