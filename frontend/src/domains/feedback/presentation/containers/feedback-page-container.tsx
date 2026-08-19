"use client";

import { useMemo, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Loader2, MessageSquare, Search, Wand2, X } from "lucide-react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/domains/auth/application/hooks/use-auth";
import { useListSelection } from "@/domains/shared/application/hooks/use-list-selection";
import { useUrlDynamicFilters } from "@/domains/shared/application/hooks/use-url-dynamic-filters";
import { DynamicFilters } from "@/domains/shared/presentation/components/filters/dynamic-filters";
import { ListPageShell } from "@/domains/shared/presentation/components/list-page-shell";
import { ListSelectionActionBar } from "@/domains/shared/presentation/components/list-selection-action-bar";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { useBatchTriage } from "../../application/hooks/use-batch-triage";
import {
  useFeedbackItems,
  useUpdateFeedbackStatus,
  useDeleteFeedbackItem,
  useTriageFeedbackItem,
} from "../../application/hooks/use-feedback-items";
import { useFeedbackDetail } from "../../application/hooks/use-feedback-detail";
import { useFeedbackSearch } from "../../application/hooks/use-feedback-search";
import {
  useIncidentBundle,
  useRefreshIncidentBundle,
  useReanalyzeIncidentBundle,
} from "../../application/hooks/use-incident-bundle";
import { extractDebugBundleMeta } from "../../domain/debug-analysis";
import { FeedbackItemsList } from "../components/feedback-items-list";
import { FeedbackPagination } from "../components/feedback-pagination";
import { FeedbackDetailPanel } from "../components/feedback-detail-panel";
import { createFeedbackFiltersConfig } from "../../domain/feedback-filters.config";
import type { FeedbackStatus } from "../../domain/types";
import type { FeedbackMentionMemberSource } from "../../application/mention-member-source";

const DEFAULT_LIMIT = 25;

interface FeedbackPageContainerProps {
  mentionMemberSource?: FeedbackMentionMemberSource;
}

export const FeedbackPageContainer: React.FC<FeedbackPageContainerProps> = ({
  mentionMemberSource,
}) => {
  const t = useTranslations("feedback");
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useAuth();

  // Dynamic filters config (memoized since it's static)
  const filtersConfig = useMemo(() => createFeedbackFiltersConfig(), []);
  const dynamicFilters = useUrlDynamicFilters(filtersConfig);

  // Search with debounce (separate from dynamic filters)
  const search = useFeedbackSearch();

  // Build search params for API call
  const apiParams = useMemo(() => {
    const params = new URLSearchParams();
    const filterParams = dynamicFilters.getFilterParams();

    // Add dynamic filter params
    Object.entries(filterParams).forEach(([key, value]) => {
      params.set(key, value);
    });

    // Add search from URL (not local value, to avoid re-fetching on every keystroke)
    const searchValue = searchParams.get("search");
    if (searchValue) params.set("search", searchValue);

    // Add pagination
    const page = searchParams.get("page") || "1";
    const limit = searchParams.get("limit") || String(DEFAULT_LIMIT);
    params.set("page", page);
    params.set("limit", limit);

    return params;
  }, [dynamicFilters, searchParams]);

  const { data, isLoading } = useFeedbackItems(apiParams);
  const updateStatus = useUpdateFeedbackStatus();
  const deleteItem = useDeleteFeedbackItem();
  const triageItem = useTriageFeedbackItem();
  const batchTriage = useBatchTriage();
  const selection = useListSelection<string>();

  const selectableItemIds = useMemo(
    () =>
      (data?.items ?? [])
        .filter((item) => item.status === "new")
        .map((item) => item.id),
    [data?.items],
  );

  const handleToggleSelect = useCallback(
    (id: string, modifiers?: { shiftKey?: boolean; metaKey?: boolean }) => {
      if (modifiers?.shiftKey) {
        selection.rangeSelect(id, selectableItemIds);
        return;
      }
      selection.toggleSelect(id);
    },
    [selection, selectableItemIds],
  );

  const handleBatchTriage = useCallback(() => {
    const ids = selection.selectedIdsArray;
    if (ids.length < 2 || ids.length > 50) {
      showToast.error(t("moderation.batchTriageInvalidCount"));
      return;
    }
    batchTriage.enqueueBatchAsync(ids).then(
      () => selection.clearSelection(),
      () => {},
    );
  }, [batchTriage, selection, t]);
  const {
    selectedItemId,
    selectedItem,
    isDetailOpen,
    onDetailOpenChange,
    handleItemClick,
  } = useFeedbackDetail();
  const debugBundleMeta = useMemo(
    () => (selectedItem ? extractDebugBundleMeta(selectedItem.metadata) : {}),
    [selectedItem]
  );
  const bundleQuery = useIncidentBundle(
    debugBundleMeta.bundleId ?? null,
    debugBundleMeta.status
  );
  const refreshBundle = useRefreshIncidentBundle(debugBundleMeta.bundleId ?? null);
  const reanalyzeBundle = useReanalyzeIncidentBundle(selectedItemId);

  const handleStatusChange = useCallback(
    (id: string, status: FeedbackStatus) => {
      updateStatus.mutate(
        { id, status },
        {
          onSuccess: () => showToast.success(t(`moderation.${status}Success`)),
          onError: () => showToast.error(t("moderation.error")),
        }
      );
    },
    [updateStatus, t]
  );

  const handleDelete = useCallback(
    (id: string) => {
      deleteItem.mutate(id, {
        onSuccess: () => showToast.success(t("moderation.deleteSuccess")),
        onError: () => showToast.error(t("moderation.error")),
      });
    },
    [deleteItem, t]
  );

  const handleTriage = useCallback(
    (id: string) => {
      triageItem.mutate(id, {
        onSuccess: (response) => {
          if (response.alreadyActive) {
            showToast.info(t("moderation.triageAlreadyActive"));
            return;
          }
          showToast.success(t("moderation.triageQueued"));
        },
        onError: () => showToast.error(t("moderation.triageError")),
      });
    },
    [triageItem, t]
  );

  const handlePageChange = useCallback(
    (page: number) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("page", String(page));
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [searchParams, router, pathname]
  );

  const handleRefreshBundle = useCallback(() => {
    if (!debugBundleMeta.bundleId) return;
    refreshBundle.mutate(undefined, {
      onSuccess: () => showToast.success(t("incidentBundle.refreshSuccess")),
      onError: () => showToast.error(t("incidentBundle.refreshError")),
    });
  }, [debugBundleMeta.bundleId, refreshBundle, t]);

  const handleReanalyzeBundle = useCallback(() => {
    if (!debugBundleMeta.bundleId) return;
    reanalyzeBundle.mutate(debugBundleMeta.bundleId, {
      onSuccess: (response) => {
        if (response.jobId) {
          showToast.success(t("incidentBundle.reanalyzeSuccess"));
          return;
        }
        showToast.warning(t("incidentBundle.reanalyzeSuccessNoJob"));
      },
      onError: () => showToast.error(t("incidentBundle.reanalyzeError")),
    });
  }, [debugBundleMeta.bundleId, reanalyzeBundle, t]);

  const incidentBundleProp = useMemo(() => {
    if (!selectedItem || selectedItem.category !== "bug") return null;
    if (!debugBundleMeta.bundleId) return null;
    return {
      bundleId: debugBundleMeta.bundleId,
      meta: debugBundleMeta,
      query: bundleQuery,
      onRefresh: handleRefreshBundle,
      onReanalyze: handleReanalyzeBundle,
      isRefreshing: refreshBundle.isPending,
      isReanalyzing: reanalyzeBundle.isPending,
    };
  }, [
    selectedItem,
    debugBundleMeta,
    bundleQuery,
    handleRefreshBundle,
    handleReanalyzeBundle,
    refreshBundle.isPending,
    reanalyzeBundle.isPending,
  ]);

  return (
    <>
      <ListPageShell
        contained={false}
        header={
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <MessageSquare className="h-6 w-6" />
              {t("title")}
            </h1>
            <p className="text-muted-foreground">{t("subtitle")}</p>
          </div>
        }
        filters={
          <DynamicFilters
            config={filtersConfig}
            appliedFilters={dynamicFilters.appliedFilters}
            onAddFilter={dynamicFilters.addFilter}
            onRemoveFilter={dynamicFilters.removeFilter}
            onUpdateFilter={dynamicFilters.updateFilter}
            onClearFilters={dynamicFilters.clearFilters}
            availableFilters={dynamicFilters.availableFilters}
            searchSlot={
              <div className="relative flex-1 min-w-[200px] max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={filtersConfig.searchPlaceholder}
                  value={search.value}
                  onChange={(e) => search.onChange(e.target.value)}
                  className="pl-9 pr-9"
                />
                {search.value && (
                  <button
                    onClick={search.onClear}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            }
          />
        }
        footer={
          data?.meta && data.meta.totalPages > 1 ? (
            <FeedbackPagination
              page={data.meta.page}
              totalPages={data.meta.totalPages}
              total={data.meta.total}
              limit={data.meta.limit}
              onPageChange={handlePageChange}
            />
          ) : undefined
        }
      >
        <FeedbackItemsList
          items={data?.items ?? []}
          isLoading={isLoading}
          onStatusChange={handleStatusChange}
          onTriage={handleTriage}
          onDelete={handleDelete}
          onItemClick={handleItemClick}
          isSelected={selection.isSelected}
          onToggleSelect={handleToggleSelect}
          onSelectAll={selection.selectAll}
          onClearSelection={selection.clearSelection}
          selectableItemIds={selectableItemIds}
        />
      </ListPageShell>

      {selection.isSelectionMode && (
        <ListSelectionActionBar
          selectedCount={selection.selectedCount}
          onClearSelection={selection.clearSelection}
        >
          <Button
            size="sm"
            variant="outline"
            onClick={handleBatchTriage}
            disabled={
              batchTriage.isPending ||
              selection.selectedCount < 2 ||
              selection.selectedCount > 50
            }
          >
            {batchTriage.isPending ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <Wand2 className="h-4 w-4 mr-1.5" />
            )}
            {t("moderation.batchTriage")}
          </Button>
        </ListSelectionActionBar>
      )}

      <FeedbackDetailPanel
        item={selectedItem}
        open={isDetailOpen}
        onOpenChange={onDetailOpenChange}
        currentUserId={user?.id ?? null}
        onStatusChange={handleStatusChange}
        incidentBundle={incidentBundleProp}
        mentionMemberSource={mentionMemberSource}
      />
    </>
  );
};
