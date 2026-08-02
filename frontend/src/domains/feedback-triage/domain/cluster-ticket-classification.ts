import type { ClusterTicketItem, FeedbackItemStatus } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Cluster Ticket Evidence Classification (A-1878, updated in A-1953)
// ─────────────────────────────────────────────────────────────────────────────
//
// Within the cluster detail UX we want to surface, at a glance, which tickets
// still drive present action versus which only contribute historical context.
//
// The classification rule is intentionally centralised here so:
//   - The contract is discoverable from a single file.
//   - TypeScript exhaustiveness on `FeedbackItemStatus` catches missing cases
//     the moment the enum grows.
//   - Presentational components stay dumb: they do not know about the rule.
//
// `ClusterTicketItem.status` is a `FeedbackItemStatus`
// (`new | triaged | in_progress | pending_validation | implementing |
//   deployed | verified | cancelled`). The mapping is:
//
//   - `current_evidence`     → `new`
//       The feedback item has not been triaged yet, so it still justifies
//       action from the triage perspective.
//
//   - `historical_reference` → every other status
//       Once the item has been triaged or has moved further down the
//       lifecycle (in progress, pending validation, deployed, etc.) the
//       cluster lifecycle — `open`, `investigating`, `fix_ready`,
//       `resolved`, `regression`, `dismissed`, `promoted` — drives the
//       action. Keeping these tickets in the historical bucket prevents the
//       ticket-status column from competing with the cluster lifecycle,
//       which is the failure mode described in the A-1878 DoD.
// ─────────────────────────────────────────────────────────────────────────────

export type ClusterTicketEvidenceGroup =
  | "current_evidence"
  | "historical_reference";

export const classifyClusterTicket = (
  ticket: ClusterTicketItem,
): ClusterTicketEvidenceGroup => {
  const status: FeedbackItemStatus = ticket.status;
  switch (status) {
    case "new":
      return "current_evidence";
    case "triaged":
    case "in_progress":
    case "pending_validation":
    case "implementing":
    case "deployed":
    case "verified":
    case "cancelled":
      return "historical_reference";
    default: {
      // Exhaustiveness check — if `FeedbackItemStatus` grows, this line will
      // fail to compile. Update the switch above when that happens.
      const _exhaustive: never = status;
      void _exhaustive;
      return "historical_reference";
    }
  }
};

export interface ClusterTicketGroupedView {
  currentEvidence: ClusterTicketItem[];
  historicalReference: ClusterTicketItem[];
}

/**
 * Pure helper that partitions a ticket list into the two evidence buckets
 * while preserving the input order within each bucket.
 *
 * Usage:
 *   const { currentEvidence, historicalReference } = groupClusterTickets(tickets);
 */
export const groupClusterTickets = (
  tickets: ClusterTicketItem[],
): ClusterTicketGroupedView => {
  const currentEvidence: ClusterTicketItem[] = [];
  const historicalReference: ClusterTicketItem[] = [];
  for (const ticket of tickets) {
    if (classifyClusterTicket(ticket) === "current_evidence") {
      currentEvidence.push(ticket);
    } else {
      historicalReference.push(ticket);
    }
  }
  return { currentEvidence, historicalReference };
};
