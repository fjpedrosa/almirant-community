import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { InboxItemRow } from "./inbox-item-row";
import type { TriageInboxItem } from "../../domain/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface InboxListProps {
  /** List of inbox items to display */
  items: TriageInboxItem[];
  /** Currently selected item ID */
  selectedId: string | null;
  /** Callback when an item is selected */
  onSelect: (id: string) => void;
  /** Whether the list is loading */
  isLoading: boolean;
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function InboxListSkeleton() {
  return (
    <div className="space-y-0">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="px-4 py-3 border-b border-border">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
            <div className="flex gap-2">
              <Skeleton className="h-4 w-14" />
              <Skeleton className="h-4 w-10" />
            </div>
          </div>
          <div className="flex justify-between mt-2">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-3 w-12" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function InboxEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="rounded-full bg-muted p-3 mb-4">
        <svg
          className="h-6 w-6 text-muted-foreground"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      </div>
      <h3 className="font-medium text-sm">All caught up!</h3>
      <p className="text-muted-foreground text-xs mt-1">
        No items pending triage.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * List of inbox items with active selection highlighting.
 * Shows loading skeleton while fetching and empty state when no items.
 *
 * Purely presentational - no hooks or state management.
 *
 * @example
 * <InboxList
 *   items={data?.items ?? []}
 *   selectedId={selectedItemId}
 *   onSelect={setSelectedItemId}
 *   isLoading={isLoading}
 * />
 */
export function InboxList({
  items,
  selectedId,
  onSelect,
  isLoading,
}: InboxListProps) {
  if (isLoading) {
    return <InboxListSkeleton />;
  }

  if (items.length === 0) {
    return <InboxEmptyState />;
  }

  return (
    <ScrollArea className="h-full">
      <div className="divide-y-0">
        {items.map((item) => (
          <InboxItemRow
            key={item.id}
            item={item}
            isSelected={selectedId === item.id}
            onClick={() => onSelect(item.id)}
          />
        ))}
      </div>
    </ScrollArea>
  );
}
