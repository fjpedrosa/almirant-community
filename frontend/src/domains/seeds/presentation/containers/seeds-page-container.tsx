"use client";

import { Loader2, Plus, Search, Sprout, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConfirmDialog } from "@/domains/shared/presentation/components/confirm-dialog";
import { DynamicFilters } from "@/domains/shared/presentation/components/filters/dynamic-filters";
import { ListPageShell } from "@/domains/shared/presentation/components/list-page-shell";
import {
  SortDropdown,
  type SortOption,
} from "@/domains/shared/presentation/components/sort-dropdown";
import { useSeedsPage } from "../../application/hooks/use-seeds-page";
import { useCreateSeedForm } from "../../application/hooks/use-create-seed-form";
import { SeedsItemsList } from "../components/seeds-items-list";
import { SeedsPagination } from "../components/seeds-pagination";
import { SeedDetailSheet } from "../components/seed-detail-sheet";
import { CreateSeedDialog } from "../components/create-seed-dialog";
import { PromoteSeedDialog } from "../components/promote-seed-dialog";

const SEED_SORT_OPTIONS: SortOption[] = [
  { label: "Priority", value: "priority" },
  { label: "Created", value: "createdAt" },
  { label: "Updated", value: "updatedAt" },
];

export const SeedsPageContainer: React.FC = () => {
  const page = useSeedsPage();
  const t = useTranslations("seeds.tabs");
  const tPage = useTranslations("seeds.pageContainer");
  const { filtersState } = page;

  const createForm = useCreateSeedForm(
    page.projectOptions[0]?.id ?? null,
    page.currentUserId,
    () => page.setCreateDialogOpen(false),
  );

  return (
    <>
      <ListPageShell
        header={
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="flex items-center gap-2 text-2xl font-bold">
                  <Sprout className="h-6 w-6 text-emerald-500" />
                  Seeds
                </h1>
                <p className="text-muted-foreground">
                  {tPage("subtitle")}
                </p>
              </div>

              <Button onClick={() => page.setCreateDialogOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                {tPage("newSeed")}
              </Button>
            </div>

            <Tabs
              value={filtersState.activeTab}
              onValueChange={(v) =>
                filtersState.setTab(v as "active" | "finished")
              }
            >
              <TabsList>
                <TabsTrigger value="active">{t("active")}</TabsTrigger>
                <TabsTrigger value="finished">{t("finished")}</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        }
        loading={
          !filtersState.isPrefsLoaded ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : undefined
        }
        filters={
          <DynamicFilters
            config={filtersState.config}
            appliedFilters={filtersState.dynamicFilters.appliedFilters}
            onAddFilter={filtersState.dynamicFilters.addFilter}
            onRemoveFilter={filtersState.dynamicFilters.removeFilter}
            onUpdateFilter={filtersState.dynamicFilters.updateFilter}
            onClearFilters={filtersState.dynamicFilters.clearFilters}
            availableFilters={filtersState.dynamicFilters.availableFilters}
            searchSlot={
              <div className="flex items-center gap-2 flex-1">
                <div className="relative flex-1 max-w-sm">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    value={filtersState.search}
                    onChange={(e) => filtersState.setSearch(e.target.value)}
                    placeholder={filtersState.config.searchPlaceholder}
                    className="h-8 pl-8 pr-8 text-sm"
                  />
                  {filtersState.search && (
                    <button
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      onClick={() => filtersState.setSearch("")}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <SortDropdown
                  options={SEED_SORT_OPTIONS}
                  sortBy={filtersState.sortBy}
                  sortDirection={filtersState.sortDirection}
                  onSortChange={filtersState.setSort}
                  defaultSortBy="createdAt"
                  defaultSortDirection="desc"
                  ariaLabel="Sort seeds"
                />
              </div>
            }
          />
        }
        footer={
          page.paginationMeta ? (
            <SeedsPagination
              page={page.paginationMeta.page}
              totalPages={page.paginationMeta.totalPages}
              total={page.paginationMeta.total}
              limit={page.paginationMeta.limit}
              onPageChange={filtersState.setPage}
            />
          ) : undefined
        }
      >
        <SeedsItemsList
          items={page.items}
          isLoading={page.isLoading}
          members={page.members}
          onOpenItem={page.openDetail}
          onDelete={page.handleDelete}
          onStatusChange={page.handleStatusChange}
          onOwnerChange={page.handleOwnerChange}
        />
      </ListPageShell>

      <CreateSeedDialog
        open={page.createDialogOpen}
        onOpenChange={page.setCreateDialogOpen}
        form={createForm.form}
        projects={page.projectOptions}
        owners={page.ownerOptions}
        isPending={createForm.isPending}
        onSubmit={createForm.onSubmit}
      />

      <PromoteSeedDialog
        open={page.promoteOpen}
        onOpenChange={page.setPromoteOpen}
        form={page.promoteForm}
        item={page.selectedPromoteItem}
        projects={page.projectOptions}
        boards={page.boardOptions}
        columns={page.columnOptions}
        isPending={page.promoteMutation.isPending}
        onSubmit={page.handlePromoteSubmit}
      />

      <SeedDetailSheet
        open={page.detailOpen}
        onOpenChange={page.setDetailOpen}
        item={page.detailPanel.item ?? null}
        isLoading={page.detailPanel.isLoading}
        projects={page.projectOptions}
        members={page.members}
        availableTags={page.tagOptions}
        commentsProps={page.detailPanel.commentsProps}
        historyProps={{
          events: page.detailPanel.history ?? [],
          isLoading: page.detailPanel.isHistoryLoading,
          members: page.members,
          projects: page.projectOptions,
        }}
        traceabilityProps={{
          feedbackLinks:
            page.detailPanel.traceability?.feedbackLinks ?? [],
          workItemLinks:
            page.detailPanel.traceability?.workItemLinks ?? [],
          isLoading: page.detailPanel.isTraceabilityLoading,
        }}
        savingField={page.detailPanel.savingField}
        onPromote={page.handlePromote}
        onStatusChange={page.detailPanel.handleStatusChange}
        onOwnerChange={page.detailPanel.handleOwnerChange}
        onPriorityChange={page.detailPanel.handlePriorityChange}
        onTitleChange={page.detailPanel.handleTitleChange}
        onDescriptionChange={page.detailPanel.handleDescriptionChange}
        onProjectChange={page.detailPanel.handleProjectChange}
        onAddTag={
          page.detailPanel.item
            ? (data) => page.handleAddTag(page.detailPanel.item!.id, data)
            : undefined
        }
        onRemoveTag={
          page.detailPanel.item
            ? (tagId) =>
                page.handleRemoveTag(page.detailPanel.item!.id, tagId)
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
