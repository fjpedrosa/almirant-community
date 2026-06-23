"use client";

import { Suspense, useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import useFormattedDate from "@/domains/shared/application/hooks/use-formatted-date";
import {
  useSessionHistory,
  useSessionHistoryFilters,
  useDeleteSession,
} from "../../application/hooks/use-session-history";
import { SessionHistoryList } from "../components/session-history-list";
import { SessionHistoryFilters } from "../components/session-history-filters";
import { SessionHistoryPagination } from "../components/session-history-pagination";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const formatDuration = (ms: number | null): string => {
  if (!ms) return "";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) {
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
};

const SessionHistoryContainerInner: React.FC = () => {
  const router = useRouter();
  const { formatRelative } = useFormattedDate();

  const {
    filters,
    setStatus,
    setPage,
    clearFilters,
    buildSearchParams,
    hasActiveFilters,
  } = useSessionHistoryFilters();

  const searchParams = buildSearchParams();
  const { sessions, meta, isLoading } = useSessionHistory(searchParams);
  const deleteSession = useDeleteSession();

  const [deleteDialogId, setDeleteDialogId] = useState<string | null>(null);

  const handleSessionClick = useCallback(
    (id: string) => {
      router.push(`/plan/history/${id}`);
    },
    [router]
  );

  const handleDeleteConfirm = useCallback(() => {
    if (deleteDialogId) {
      deleteSession.mutate(deleteDialogId);
      setDeleteDialogId(null);
    }
  }, [deleteDialogId, deleteSession]);

  return (
    <div className="flex h-full flex-col">
      {/* Page header */}
      <div className="flex items-center justify-between border-b px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold">Session History</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Browse and replay past planning sessions
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="border-b px-6 py-3">
        <SessionHistoryFilters
          status={filters.status}
          hasActiveFilters={hasActiveFilters}
          onStatusChange={setStatus}
          onClearFilters={clearFilters}
        />
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <SessionHistoryList
          sessions={sessions}
          isLoading={isLoading}
          formatDate={formatRelative}
          formatDuration={formatDuration}
          onSessionClick={handleSessionClick}
          onDelete={setDeleteDialogId}
        />
      </div>

      {/* Pagination */}
      {meta && meta.total > 0 && (
        <div className="border-t px-6">
          <SessionHistoryPagination meta={meta} onPageChange={setPage} />
        </div>
      )}

      {/* Delete confirmation dialog */}
      <AlertDialog
        open={!!deleteDialogId}
        onOpenChange={(open: boolean) => {
          if (!open) setDeleteDialogId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete session</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The session and all its messages will
              be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={handleDeleteConfirm}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export const SessionHistoryContainer: React.FC = () => {
  return (
    <Suspense
      fallback={
        <div className="flex flex-col gap-4 p-6">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-10 w-64" />
          <div className="flex flex-col gap-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-lg" />
            ))}
          </div>
        </div>
      }
    >
      <SessionHistoryContainerInner />
    </Suspense>
  );
};
