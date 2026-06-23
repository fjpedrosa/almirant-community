"use client";

import { Eye, EyeOff, Lightbulb, Loader2, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/domains/shared/presentation/components/confirm-dialog";
import { ListPageShell } from "@/domains/shared/presentation/components/list-page-shell";
import {
  SortDropdown,
  type SortOption,
} from "@/domains/shared/presentation/components/sort-dropdown";
import { useIdeasPage } from "../../application/hooks/use-ideas-page";
import { IdeaDetailPanel } from "../components/idea-detail-panel";
import { IdeasFilterBar } from "../components/ideas-filter-bar";
import { IdeasItemsList } from "../components/ideas-items-list";
import { IdeasPagination } from "../components/ideas-pagination";
import { PromoteIdeaItemDialog } from "../components/promote-idea-item-dialog";
import { QuickCaptureDialog } from "../components/quick-capture-dialog";

const IDEA_SORT_OPTIONS: SortOption[] = [
  { label: "Created", value: "createdAt" },
  { label: "Updated", value: "updatedAt" },
  { label: "Due date", value: "dueDate" },
];

export const IdeasPageContainer: React.FC = () => {
  const t = useTranslations("ideas");
  const page = useIdeasPage();

  return (
    <>
      <ListPageShell
        header={
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="flex items-center gap-2 text-2xl font-bold">
                <Lightbulb className="h-6 w-6 text-amber-500" />
                {t("pageContainer.title")}
              </h1>
              <p className="text-muted-foreground">
                {t("pageContainer.subtitle")}
              </p>
            </div>

            <Button onClick={() => page.setQuickCaptureOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              {t("pageContainer.quickCapture")}
            </Button>
          </div>
        }
        loading={
          !page.isPrefsLoaded ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : undefined
        }
        filters={
          <div className="space-y-3">
            <IdeasFilterBar
              filters={page.filters}
              hasActiveFilters={page.hasActiveFilters}
              activeFilters={page.activeFilters}
              owners={page.ownerOptions}
              projects={page.projectOptions}
              tags={page.tagOptions}
              hideTypeFilter
              onSearchChange={page.setSearch}
              onTypeChange={page.setType}
              onStatusChange={page.setStatus}
              onOwnerChange={page.setOwnerUserId}
              onProjectChange={page.setProjectId}
              onDueDateChange={page.setDueDate}
              onDiscussedChange={page.setDiscussed}
              onMentionedChange={(value) => {
                if (value === "me" && page.currentUserId) {
                  page.setMentionedUserId(page.currentUserId);
                } else {
                  page.setMentionedUserId(undefined);
                }
              }}
              onTagChange={page.setTagIds}
              onClearFilters={page.clearFilters}
              onRemoveFilter={page.removeFilter}
            />
            <div className="flex items-center gap-2">
              <SortDropdown
                options={IDEA_SORT_OPTIONS}
                sortBy={page.filters.sortBy ?? "createdAt"}
                sortDirection={page.filters.sortDirection ?? "desc"}
                onSortChange={page.setSort}
                defaultSortBy="createdAt"
                defaultSortDirection="desc"
                ariaLabel="Sort ideas"
              />
            </div>
          </div>
        }
        footer={
          page.paginationMeta ? (
            <IdeasPagination
              page={page.paginationMeta.page}
              totalPages={page.paginationMeta.totalPages}
              total={page.paginationMeta.total}
              limit={page.paginationMeta.limit}
              onPageChange={page.setPage}
            />
          ) : undefined
        }
      >
        <IdeasItemsList
          items={page.items}
          isLoading={page.isLoading}
          members={page.members}
          onOpenItem={page.openDetail}
          onDelete={page.handleDelete}
          onStatusChange={page.handleStatusChange}
          onDiscussedToggle={page.handleDiscussedToggle}
          onOwnerChange={page.handleOwnerChange}
        />

        <div className="flex items-center justify-end">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() =>
              page.setShowAllDone(page.filters.showAllDone ? undefined : true)
            }
          >
            {page.filters.showAllDone ? (
              <EyeOff className="mr-1.5 h-4 w-4" />
            ) : (
              <Eye className="mr-1.5 h-4 w-4" />
            )}
            {page.filters.showAllDone
              ? t("pageContainer.hideCompleted")
              : t("pageContainer.showAllCompleted")}
          </Button>
        </div>
      </ListPageShell>

      <QuickCaptureDialog
        open={page.quickCaptureOpen}
        onOpenChange={page.setQuickCaptureOpen}
        form={page.quickCapture.form}
        projects={page.projectOptions}
        owners={page.ownerOptions}
        isPending={page.quickCapture.isPending}
        onSubmit={page.quickCapture.onSubmit}
      />

      <PromoteIdeaItemDialog
        open={page.promoteOpen}
        onOpenChange={page.setPromoteOpen}
        form={page.promoteForm}
        item={page.selectedPromoteItem}
        projects={page.projectOptions}
        boards={page.boardOptions}
        columns={page.columnOptions}
        isPending={page.promoteIdea.isPending}
        onSubmit={page.handlePromoteSubmit}
      />

      <IdeaDetailPanel
        open={page.detailOpen}
        onOpenChange={page.setDetailOpen}
        item={page.detailPanel.item ?? null}
        traceability={page.detailPanel.traceability}
        history={page.detailPanel.history}
        isLoading={page.detailPanel.isLoading}
        isTraceabilityLoading={page.detailPanel.isTraceabilityLoading}
        isHistoryLoading={page.detailPanel.isHistoryLoading}
        projects={page.projectOptions}
        members={page.members}
        availableTags={page.tagOptions}
        commentsProps={page.detailPanel.commentsProps}
        savingField={page.detailPanel.savingField}
        onPromote={page.handlePromote}
        onStatusChange={page.detailPanel.handleStatusChange}
        onOwnerChange={page.detailPanel.handleOwnerChange}
        onDueDateChange={page.detailPanel.handleDueDateChange}
        onTitleChange={page.detailPanel.handleTitleChange}
        onDescriptionChange={page.detailPanel.handleDescriptionChange}
        onProjectChange={page.detailPanel.handleProjectChange}
        onDiscussedToggle={page.handleDiscussedToggle}
        onAddTag={
          page.detailPanel.item
            ? (data) => page.handleAddTag(page.detailPanel.item!.id, data)
            : undefined
        }
        onRemoveTag={
          page.detailPanel.item
            ? (tagId) => page.handleRemoveTag(page.detailPanel.item!.id, tagId)
            : undefined
        }
      />

      <ConfirmDialog
        isOpen={page.confirmDialogProps.isOpen}
        options={page.confirmDialogProps.options}
        onConfirm={page.confirmDialogProps.handleConfirm}
        onCancel={page.confirmDialogProps.handleCancel}
      />
    </>
  );
};
