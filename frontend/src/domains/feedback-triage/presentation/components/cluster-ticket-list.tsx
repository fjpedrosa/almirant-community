import { ScrollArea } from "@/components/ui/scroll-area";
import { ChevronRight } from "lucide-react";
import { ClusterTicketListItem } from "./cluster-ticket-list-item";
import type { ClusterTicketListItemVariant } from "./cluster-ticket-list-item";
import type { ClusterTicketItem } from "../../domain/types";
import { groupClusterTickets } from "../../domain/cluster-ticket-classification";

export interface ClusterTicketListProps {
  tickets: ClusterTicketItem[];
  selectedTicketId: string | null;
  onSelectTicket: (id: string) => void;
}

interface ClusterTicketGroupProps {
  heading: string;
  tickets: ClusterTicketItem[];
  selectedTicketId: string | null;
  onSelectTicket: (id: string) => void;
  variant: ClusterTicketListItemVariant;
  /** When true, renders inside a collapsible <details> (for the historical bucket). */
  collapsible?: boolean;
  /** Initial open state when collapsible. */
  defaultOpen?: boolean;
  /** Optional extra classes for the heading text. */
  headingClassName?: string;
}

/**
 * Renders one evidence group inside the ticket list.
 *
 * Hidden entirely when there are no tickets so the UI never shows
 * "Histórico (0)" empty headers.
 */
const ClusterTicketGroup: React.FC<ClusterTicketGroupProps> = ({
  heading,
  tickets,
  selectedTicketId,
  onSelectTicket,
  variant,
  collapsible = false,
  defaultOpen = true,
  headingClassName,
}) => {
  if (tickets.length === 0) {
    return null;
  }

  const items = (
    <div className="flex flex-col gap-2 p-1">
      {tickets.map((ticket) => (
        <ClusterTicketListItem
          key={ticket.id}
          ticket={ticket}
          isSelected={selectedTicketId === ticket.id}
          onSelect={() => onSelectTicket(ticket.id)}
          variant={variant}
        />
      ))}
    </div>
  );

  if (collapsible) {
    return (
      <details open={defaultOpen} className="group/historical">
        <summary
          className={`flex cursor-pointer list-none items-center gap-1 px-1 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground select-none [&::-webkit-details-marker]:hidden ${headingClassName ?? ""}`}
        >
          <ChevronRight
            aria-hidden="true"
            className="h-3 w-3 transition-transform group-open/historical:rotate-90"
          />
          <span>
            {heading} ({tickets.length})
          </span>
        </summary>
        <div className="mt-1">{items}</div>
      </details>
    );
  }

  return (
    <div>
      <h4
        className={`px-1 pb-1 text-xs font-semibold uppercase tracking-wide text-foreground/80 ${headingClassName ?? ""}`}
      >
        {heading} ({tickets.length})
      </h4>
      {items}
    </div>
  );
};

/**
 * Scrollable list of tickets within a cluster, partitioned into two evidence
 * groups so the user can immediately tell which tickets justify present
 * action and which only contribute historical context (A-1878).
 *
 * The classification rule lives in
 * `domain/cluster-ticket-classification.ts` — keep it there, not inline.
 *
 * Selection still works seamlessly across both groups using the same
 * `selectedTicketId` / `onSelectTicket` props.
 *
 * Usage:
 * <ClusterTicketList
 *   tickets={cluster.tickets}
 *   selectedTicketId={selectedId}
 *   onSelectTicket={handleSelectTicket}
 * />
 */
export const ClusterTicketList: React.FC<ClusterTicketListProps> = ({
  tickets,
  selectedTicketId,
  onSelectTicket,
}) => {
  if (tickets.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
        No tickets in this cluster
      </div>
    );
  }

  const { currentEvidence, historicalReference } = groupClusterTickets(tickets);

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-4 p-1">
        <ClusterTicketGroup
          heading="Evidencia actual"
          tickets={currentEvidence}
          selectedTicketId={selectedTicketId}
          onSelectTicket={onSelectTicket}
          variant="default"
        />
        <ClusterTicketGroup
          heading="Histórico y referencia"
          tickets={historicalReference}
          selectedTicketId={selectedTicketId}
          onSelectTicket={onSelectTicket}
          variant="muted"
          collapsible
          defaultOpen={currentEvidence.length === 0}
        />
      </div>
    </ScrollArea>
  );
};
