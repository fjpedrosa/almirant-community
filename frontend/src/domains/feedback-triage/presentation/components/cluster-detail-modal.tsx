"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as VisuallyHidden from "@radix-ui/react-visually-hidden";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { ClusterDetailHero } from "./cluster-detail-hero";
import { ClusterDetailTicketsPane } from "./cluster-detail-tickets-pane";
import { ClusterTicketDetailPane } from "./cluster-ticket-detail-pane";
import { ClusterLiveStatusPane } from "./cluster-live-status-pane";
import type { TriageClusterDetail } from "../../domain/types";
import type { ClusterSummaryStats } from "../../domain/cluster-summary";

export interface ClusterDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  detail: TriageClusterDetail | null;
  summaryStats: ClusterSummaryStats;
  isLoading: boolean;
  selectedTicketId: string | null;
  onSelectTicket: (ticketId: string) => void;
  onLaunchInvestigation: () => void;
  isLaunching: boolean;
  canLaunch: boolean;
  onOpenAgentRun?: (jobId: string) => void;
  /** Opens the destructive dismiss-cluster dialog. */
  onDismiss?: () => void;
  /** Whether the current cluster status allows a `dismissed` transition. */
  canDismiss?: boolean;
  /** Aborts the active investigation (A-1934). */
  onAbort?: () => void;
  /**
   * Whether the cluster is in `investigating` AND has an active attempt.
   * Gates visibility of the destructive abort CTA in the live-status pane.
   */
  canAbort?: boolean;
  isAborting?: boolean;
}

/**
 * Fullscreen modal for cluster details.
 * Layout: hero on top (full width) + 3-column grid below on desktop
 * (Tickets | Ticket Detail | Live status). Mobile uses tabs.
 *
 * Animation: slides in from top on open.
 */
export const ClusterDetailModal: React.FC<ClusterDetailModalProps> = ({
  isOpen,
  onClose,
  detail,
  summaryStats,
  isLoading,
  selectedTicketId,
  onSelectTicket,
  onLaunchInvestigation,
  isLaunching,
  canLaunch,
  onOpenAgentRun,
  onDismiss,
  canDismiss,
  onAbort,
  canAbort,
  isAborting,
}) => {
  const tickets = detail?.tickets ?? [];
  const selectedTicket = tickets.find((t) => t.id === selectedTicketId) ?? null;
  const attempts = detail?.bugFixAttempts ?? [];
  const activeAttempt = detail?.activeAttempt ?? null;

  return (
    <DialogPrimitive.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />

        <DialogPrimitive.Content
          className="bg-background fixed inset-0 z-50 flex flex-col outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:slide-in-from-top-0 data-[state=closed]:slide-out-to-top-0 data-[state=open]:duration-300 data-[state=closed]:duration-200"
          aria-describedby={undefined}
        >
          <VisuallyHidden.Root>
            <DialogPrimitive.Title>
              {detail?.cluster.title ?? "Cluster detail"}
            </DialogPrimitive.Title>
          </VisuallyHidden.Root>

          {/* Loading state */}
          {isLoading && (
            <>
              <div className="border-b px-6 py-5">
                <Skeleton className="h-7 w-64" />
                <Skeleton className="mt-3 h-4 w-96" />
                <Skeleton className="mt-3 h-4 w-80" />
              </div>
              <div className="flex flex-1 items-center justify-center">
                <div className="space-y-4 text-center">
                  <Skeleton className="mx-auto h-8 w-48" />
                  <Skeleton className="mx-auto h-4 w-32" />
                </div>
              </div>
            </>
          )}

          {/* Loaded */}
          {!isLoading && detail && (
            <>
              <ClusterDetailHero
                cluster={{
                  title: detail.cluster.title,
                  summary: detail.cluster.summary,
                  suggestedType: detail.cluster.suggestedType,
                  suggestedPriority: detail.cluster.suggestedPriority,
                  itemCount: detail.cluster.itemCount,
                }}
                summary={detail.summary}
                stats={summaryStats}
                onLaunchInvestigation={onLaunchInvestigation}
                onClose={onClose}
                canLaunch={canLaunch}
                isLaunching={isLaunching}
                onDismiss={onDismiss}
                canDismiss={canDismiss}
                timelineEvents={detail.timelineEvents}
                prUrl={
                  detail.activeAttempt?.fixPrUrl ??
                  detail.bugFixAttempts.find((a) => a.pr?.state === "merged")
                    ?.fixPrUrl ??
                  null
                }
              />

              {/* Desktop: 3-column grid */}
              <div className="hidden min-h-0 flex-1 lg:grid grid-cols-[minmax(280px,28%)_minmax(0,1fr)_minmax(320px,32%)] overflow-hidden">
                <div className="overflow-hidden border-r p-4">
                  <ClusterDetailTicketsPane
                    tickets={tickets}
                    selectedTicketId={selectedTicketId}
                    onSelectTicket={onSelectTicket}
                  />
                </div>

                <div className="overflow-hidden border-r p-4">
                  <ClusterTicketDetailPane
                    ticket={selectedTicket}
                    attempts={attempts}
                  />
                </div>

                <div className="flex min-h-0 flex-col overflow-hidden p-4">
                  <ClusterLiveStatusPane
                    attempts={attempts}
                    activeAttempt={activeAttempt}
                    onLaunchInvestigation={onLaunchInvestigation}
                    canLaunch={canLaunch}
                    isLaunching={isLaunching}
                    onOpenAgentRun={onOpenAgentRun}
                    onAbort={onAbort}
                    canAbort={canAbort}
                    isAborting={isAborting}
                  />
                </div>
              </div>

              {/* Mobile: tabs */}
              <div className="flex flex-1 flex-col overflow-hidden lg:hidden">
                <Tabs defaultValue="tickets" className="flex flex-1 flex-col overflow-hidden">
                  <TabsList className="mx-4 mt-4 w-auto shrink-0">
                    <TabsTrigger value="tickets">
                      Tickets ({tickets.length})
                    </TabsTrigger>
                    <TabsTrigger value="detail">
                      Ticket
                      {selectedTicket && (
                        <span className="ml-1 h-2 w-2 rounded-full bg-primary" />
                      )}
                    </TabsTrigger>
                    <TabsTrigger value="status">Estado</TabsTrigger>
                  </TabsList>

                  <TabsContent value="tickets" className="flex-1 overflow-hidden p-4">
                    <ClusterDetailTicketsPane
                      tickets={tickets}
                      selectedTicketId={selectedTicketId}
                      onSelectTicket={onSelectTicket}
                    />
                  </TabsContent>

                  <TabsContent value="detail" className="flex-1 overflow-hidden p-4">
                    <ClusterTicketDetailPane
                      ticket={selectedTicket}
                      attempts={attempts}
                    />
                  </TabsContent>

                  <TabsContent value="status" className="flex-1 overflow-hidden p-4">
                    <ClusterLiveStatusPane
                      attempts={attempts}
                      activeAttempt={activeAttempt}
                      onLaunchInvestigation={onLaunchInvestigation}
                      canLaunch={canLaunch}
                      isLaunching={isLaunching}
                      onAbort={onAbort}
                      canAbort={canAbort}
                      isAborting={isAborting}
                    />
                  </TabsContent>
                </Tabs>
              </div>
            </>
          )}

          {/* Empty */}
          {!isLoading && !detail && (
            <div className="flex flex-1 items-center justify-center text-muted-foreground">
              No cluster selected
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};
