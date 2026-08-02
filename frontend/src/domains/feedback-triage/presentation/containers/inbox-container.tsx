"use client";

import { Suspense, useState, useCallback, useMemo } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import {
  useInboxQuery,
  useConfirmFeedbackItem,
  useDismissFeedbackItem,
  useReassignCluster,
  useCreateCluster,
  feedbackTriageKeys,
} from "../../application/hooks";
import type { TriageInboxItem, CreateClusterInput, PaginatedInboxResponse } from "../../domain/types";
import { InboxHeader } from "../components/inbox-header";
import { InboxList } from "../components/inbox-list";
import { InboxDetailPanel } from "../components/inbox-detail-panel";
import { DismissDialog } from "../components/dismiss-dialog";
import { ReassignClusterDialog } from "../components/reassign-cluster-dialog";
import { CreateClusterDialog } from "../components/create-cluster-dialog";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_LIMIT = 20;

// ---------------------------------------------------------------------------
// Inner container (uses hooks that require Suspense)
// ---------------------------------------------------------------------------

const InboxContainerInner: React.FC = () => {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  // Dialog states
  const [isDismissDialogOpen, setDismissDialogOpen] = useState(false);
  const [isReassignDialogOpen, setReassignDialogOpen] = useState(false);
  const [isCreateClusterDialogOpen, setCreateClusterDialogOpen] = useState(false);

  // Dialog form values
  const [dismissReason, setDismissReason] = useState("");
  const [reassignClusterId, setReassignClusterId] = useState("");
  const [newClusterTitle, setNewClusterTitle] = useState("");
  const [newClusterSummary, setNewClusterSummary] = useState("");

  // ---------------------------------------------------------------------------
  // API params from URL
  // ---------------------------------------------------------------------------

  const apiParams = useMemo(() => {
    const params = new URLSearchParams();
    params.set("status", "pending");

    const page = searchParams.get("page") || "1";
    const limit = searchParams.get("limit") || String(DEFAULT_LIMIT);
    params.set("page", page);
    params.set("limit", limit);

    return params;
  }, [searchParams]);

  // ---------------------------------------------------------------------------
  // Data queries
  // ---------------------------------------------------------------------------

  const { data, isLoading } = useInboxQuery(apiParams);

  const selectedItem = useMemo<TriageInboxItem | null>(() => {
    if (!selectedItemId || !data?.items) return null;
    return data.items.find((item) => item.id === selectedItemId) ?? null;
  }, [selectedItemId, data]);

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  const confirmMutation = useConfirmFeedbackItem({
    onSuccess: () => {
      showToast.success("Item confirmed", {
        description: "The AI suggestion has been accepted.",
      });
      handleItemRemoved();
    },
    onError: () => {
      showToast.error("Failed to confirm item");
    },
  });

  const dismissMutation = useDismissFeedbackItem({
    onSuccess: () => {
      showToast.success("Item dismissed");
      setDismissDialogOpen(false);
      setDismissReason("");
      handleItemRemoved();
    },
    onError: () => {
      showToast.error("Failed to dismiss item");
    },
  });

  const reassignMutation = useReassignCluster({
    onSuccess: () => {
      showToast.success("Item reassigned", {
        description: "The item has been moved to the new cluster.",
      });
      setReassignDialogOpen(false);
      setReassignClusterId("");
      handleItemRemoved();
    },
    onError: () => {
      showToast.error("Failed to reassign item");
    },
  });

  const createClusterMutation = useCreateCluster({
    onSuccess: (newCluster) => {
      showToast.success("Cluster created", {
        description: `Created cluster "${newCluster.title}"`,
      });
      setCreateClusterDialogOpen(false);
      setNewClusterTitle("");
      setNewClusterSummary("");
      handleItemRemoved();
    },
    onError: () => {
      showToast.error("Failed to create cluster");
    },
  });

  // ---------------------------------------------------------------------------
  // Optimistic update helper
  // ---------------------------------------------------------------------------

  const handleItemRemoved = useCallback(() => {
    if (!selectedItemId || !data) return;

    // Optimistically remove the item from the cache
    queryClient.setQueryData<PaginatedInboxResponse>(
      queryClient.getQueryCache().findAll({
        queryKey: feedbackTriageKeys.inbox(),
        exact: false,
      })[0]?.queryKey,
      (oldData) => {
        if (!oldData) return oldData;
        return {
          ...oldData,
          items: oldData.items.filter((item) => item.id !== selectedItemId),
          meta: {
            ...oldData.meta,
            total: Math.max(0, oldData.meta.total - 1),
          },
        };
      }
    );

    // Select the next item or clear selection
    const currentIndex = data.items.findIndex((item) => item.id === selectedItemId);
    const nextItem = data.items[currentIndex + 1] ?? data.items[currentIndex - 1];
    setSelectedItemId(nextItem?.id ?? null);
  }, [selectedItemId, data, queryClient]);

  // ---------------------------------------------------------------------------
  // Action handlers
  // ---------------------------------------------------------------------------

  const handleConfirm = useCallback(() => {
    if (!selectedItemId) return;
    confirmMutation.mutate(selectedItemId);
  }, [selectedItemId, confirmMutation]);

  const handleOpenDismissDialog = useCallback(() => {
    setDismissDialogOpen(true);
  }, []);

  const handleDismissConfirm = useCallback(
    (reason: string) => {
      if (!selectedItemId) return;
      dismissMutation.mutate({ itemId: selectedItemId, reason: reason || undefined });
    },
    [selectedItemId, dismissMutation]
  );

  const handleOpenReassignDialog = useCallback(() => {
    setReassignDialogOpen(true);
  }, []);

  const handleReassignConfirm = useCallback(
    (clusterId: string) => {
      if (!selectedItemId) return;
      reassignMutation.mutate({ itemId: selectedItemId, clusterId });
    },
    [selectedItemId, reassignMutation]
  );

  const handleOpenCreateClusterDialog = useCallback(() => {
    setCreateClusterDialogOpen(true);
  }, []);

  const handleCreateClusterConfirm = useCallback(
    (input: CreateClusterInput) => {
      createClusterMutation.mutate(input);
    },
    [createClusterMutation]
  );

  const handlePageChange = useCallback(
    (page: number) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("page", String(page));
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [searchParams, router, pathname]
  );

  // ---------------------------------------------------------------------------
  // Auto-select first item when list loads
  // ---------------------------------------------------------------------------

  // Select first item if nothing is selected and we have items
  const shouldAutoSelect = !selectedItemId && data?.items && data.items.length > 0;
  if (shouldAutoSelect) {
    setSelectedItemId(data.items[0].id);
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="shrink-0 px-6 pt-6">
        <InboxHeader
          totalItems={data?.meta.total ?? 0}
          isLoading={isLoading}
        />
      </div>

      {/* Main content: List + Detail panel */}
      <div className="flex-1 min-h-0 px-6 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 h-full min-h-0">
          {/* List panel */}
          <Card className="lg:col-span-2 overflow-hidden flex flex-col min-h-0">
            <div className="flex-1 min-h-0 overflow-hidden">
              <InboxList
                items={data?.items ?? []}
                selectedId={selectedItemId}
                onSelect={setSelectedItemId}
                isLoading={isLoading}
              />
            </div>

            {/* Pagination footer */}
            {data?.meta && data.meta.totalPages > 1 && (
              <div className="shrink-0 border-t px-4 py-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    Page {data.meta.page} of {data.meta.totalPages}
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => handlePageChange(data.meta.page - 1)}
                      disabled={data.meta.page <= 1}
                      className="px-3 py-1.5 text-sm font-medium rounded-md border hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      onClick={() => handlePageChange(data.meta.page + 1)}
                      disabled={data.meta.page >= data.meta.totalPages}
                      className="px-3 py-1.5 text-sm font-medium rounded-md border hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Next
                    </button>
                  </div>
                </div>
              </div>
            )}
          </Card>

          {/* Detail panel */}
          <Card className="lg:col-span-3 overflow-hidden min-h-0">
            <InboxDetailPanel
              item={selectedItem}
              onConfirm={handleConfirm}
              onDismiss={handleOpenDismissDialog}
              onReassign={handleOpenReassignDialog}
              onCreateCluster={handleOpenCreateClusterDialog}
              isConfirming={confirmMutation.isPending}
              isDismissing={dismissMutation.isPending}
              isReassigning={reassignMutation.isPending}
              isCreatingCluster={createClusterMutation.isPending}
            />
          </Card>
        </div>
      </div>

      {/* Dialogs */}
      <DismissDialog
        open={isDismissDialogOpen}
        onOpenChange={setDismissDialogOpen}
        onConfirm={handleDismissConfirm}
        isPending={dismissMutation.isPending}
        reason={dismissReason}
        onReasonChange={setDismissReason}
      />

      <ReassignClusterDialog
        open={isReassignDialogOpen}
        onOpenChange={setReassignDialogOpen}
        onConfirm={handleReassignConfirm}
        isPending={reassignMutation.isPending}
        clusterId={reassignClusterId}
        onClusterIdChange={setReassignClusterId}
      />

      <CreateClusterDialog
        open={isCreateClusterDialogOpen}
        onOpenChange={setCreateClusterDialogOpen}
        onConfirm={handleCreateClusterConfirm}
        isPending={createClusterMutation.isPending}
        title={newClusterTitle}
        onTitleChange={setNewClusterTitle}
        summary={newClusterSummary}
        onSummaryChange={setNewClusterSummary}
        feedbackItemId={selectedItemId}
      />
    </div>
  );
};

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

const ContainerSkeleton: React.FC = () => (
  <div className="flex flex-col h-full min-h-0">
    <div className="shrink-0 px-6 pt-6 space-y-2">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-4 w-96" />
    </div>

    <div className="flex-1 min-h-0 px-6 py-6">
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 h-full min-h-0">
        <div className="lg:col-span-2 rounded-lg border">
          <div className="p-4 space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            ))}
          </div>
        </div>

        <div className="lg:col-span-3 rounded-lg border">
          <div className="p-6 space-y-6">
            <div className="space-y-2">
              <Skeleton className="h-6 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </div>
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-32 w-full" />
            <div className="flex gap-2">
              <Skeleton className="h-10 w-24" />
              <Skeleton className="h-10 w-24" />
              <Skeleton className="h-10 w-24" />
              <Skeleton className="h-10 w-24" />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * InboxContainer - Main container for the feedback triage inbox view.
 *
 * Features:
 * - List + detail panel layout (inbox-style UX)
 * - 4 actions: Confirm, Reassign, Create Cluster, Dismiss
 * - Optimistic updates (items disappear immediately on action)
 * - URL-synced pagination
 * - Toast notifications on success/error
 *
 * @example
 * // In page.tsx
 * export default function InboxPage() {
 *   return <InboxContainer />;
 * }
 */
export const InboxContainer: React.FC = () => {
  return (
    <Suspense fallback={<ContainerSkeleton />}>
      <InboxContainerInner />
    </Suspense>
  );
};
