import { cn } from "@/lib/utils";
import { FeedbackItemStatusBadge } from "./feedback-item-status-badge";
import type { ClusterTicketItem } from "../../domain/types";

export type ClusterTicketListItemVariant = "default" | "muted";

export interface ClusterTicketListItemProps {
  ticket: ClusterTicketItem;
  isSelected: boolean;
  onSelect: () => void;
  /**
   * Visual density of the row.
   *
   * - `default`: full prominence (used for "current evidence" tickets).
   * - `muted`: softened background and de-emphasised title weight (used for
   *   the "histórico / referencia" group so the ticket statuses do not
   *   compete with the cluster lifecycle).
   *
   * Selection always overrides the muted background so the user can still
   * tell which ticket is active.
   */
  variant?: ClusterTicketListItemVariant;
}

/**
 * Single ticket item in the cluster ticket list.
 * Purely presentational - displays ticket summary with selection state.
 *
 * Usage:
 * <ClusterTicketListItem
 *   ticket={ticket}
 *   isSelected={selectedId === ticket.id}
 *   onSelect={() => onSelectTicket(ticket.id)}
 *   variant="muted"
 * />
 */
export const ClusterTicketListItem: React.FC<ClusterTicketListItemProps> = ({
  ticket,
  isSelected,
  onSelect,
  variant = "default",
}) => {
  const isMuted = variant === "muted";

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "w-full rounded-md border p-3 text-left transition-colors",
        "hover:bg-accent/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        isSelected
          ? "border-primary bg-primary/5 dark:bg-primary/10"
          : isMuted
            ? "border-border/60 bg-muted/30"
            : "border-border bg-card",
      )}
      aria-pressed={isSelected}
    >
      <div className="flex items-start justify-between gap-2">
        <h4
          className={cn(
            "line-clamp-2 flex-1 text-sm",
            isMuted && !isSelected
              ? "font-normal text-muted-foreground"
              : "font-medium",
          )}
        >
          {ticket.title}
        </h4>
        <FeedbackItemStatusBadge status={ticket.status} />
      </div>

      {ticket.authorName && (
        <p className="mt-1 text-xs text-muted-foreground">
          By {ticket.authorName}
        </p>
      )}

      {ticket.aiCategory && (
        <p className="mt-1 text-xs text-muted-foreground">
          Category: {ticket.aiCategory}
        </p>
      )}

      <p className="mt-1 text-xs text-muted-foreground">
        {new Date(ticket.createdAt).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          year: "numeric",
        })}
      </p>
    </button>
  );
};
