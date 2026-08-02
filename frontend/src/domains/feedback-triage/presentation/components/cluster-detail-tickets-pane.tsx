import { ClusterTicketList } from "./cluster-ticket-list";
import type { ClusterTicketItem } from "../../domain/types";
import { groupClusterTickets } from "../../domain/cluster-ticket-classification";

export interface ClusterDetailTicketsPaneProps {
  tickets: ClusterTicketItem[];
  selectedTicketId: string | null;
  onSelectTicket: (id: string) => void;
}

/**
 * Left pane of the cluster detail modal. Shows the full list of tickets
 * grouped into "current evidence" and "historical reference". Selection
 * state is controlled via props.
 *
 * Cluster title / summary / stats / suggestions used to live in this pane;
 * they now render in `ClusterDetailHero` at the top of the modal.
 */
export const ClusterDetailTicketsPane: React.FC<ClusterDetailTicketsPaneProps> = ({
  tickets,
  selectedTicketId,
  onSelectTicket,
}) => {
  const { currentEvidence, historicalReference } = groupClusterTickets(tickets);

  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden">
      <div className="flex shrink-0 items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium text-muted-foreground">
          Tickets ({tickets.length})
        </h3>
        {tickets.length > 0 && (
          <p className="text-xs text-muted-foreground/80">
            {currentEvidence.length} evidencia actual ·{" "}
            {historicalReference.length} histórico
          </p>
        )}
      </div>
      <div className="min-h-0 flex-1">
        <ClusterTicketList
          tickets={tickets}
          selectedTicketId={selectedTicketId}
          onSelectTicket={onSelectTicket}
        />
      </div>
    </div>
  );
};
