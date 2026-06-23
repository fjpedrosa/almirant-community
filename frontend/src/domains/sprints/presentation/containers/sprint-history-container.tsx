"use client";

import { useSprintHistory } from "../../application/hooks/use-sprint-history";
import { SprintHistoryPanel } from "../components/sprint-history-panel";
import { CreateSprintDialog } from "../components/create-sprint-dialog";
import { CloseSprintDialog } from "../components/close-sprint-dialog";
import { SprintReportContainer } from "./sprint-report-container";
import type { SprintHistoryContainerProps } from "../../domain/types";

export const SprintHistoryContainer: React.FC<SprintHistoryContainerProps> = ({
  boardId,
  open,
  onOpenChange,
  area,
}) => {
  const {
    createDialogOpen,
    setCreateDialogOpen,
    closeDialogOpen,
    setCloseDialogOpen,
    activeSprint,
    closedSprints,
    isLoadingSprints,
    expandedSprintId,
    expandedSprintItems,
    isLoadingItems,
    donePreview,
    isLoadingPreview,
    hasActiveSprint,
    suggestedName,
    handleToggleExpand,
    handleCreateSprint,
    handleCloseSprint,
    handleCloseSprintByDateRange,
    isCreating,
    isClosing,
    // Date range
    dateRange,
    handleDateRangeChange,
    dateRangeDoneItems,
    isLoadingDateRangePreview,
    // Summary
    expandedSprintSummary,
    isLoadingSummary,
    // Report
    reportSprintId,
    reportDialogOpen,
    autoOpenShareOnReport,
    handleViewReport,
    handleCloseReport,
    shareBannerSprint,
    handleShareBannerDismiss,
    handleShareBannerAction,
  } = useSprintHistory(boardId, open);

  return (
    <>
      <SprintHistoryPanel
        open={open}
        onOpenChange={onOpenChange}
        activeSprint={activeSprint}
        closedSprints={closedSprints}
        isLoading={isLoadingSprints}
        expandedSprintId={expandedSprintId}
        onToggleExpand={handleToggleExpand}
        expandedSprintItems={expandedSprintItems}
        isLoadingItems={isLoadingItems}
        onCreateSprint={() => setCreateDialogOpen(true)}
        onCloseSprint={() => setCloseDialogOpen(true)}
        hasActiveSprint={hasActiveSprint}
        onViewReport={handleViewReport}
        expandedSprintSummary={expandedSprintSummary}
        isLoadingSummary={isLoadingSummary}
        area={area}
        shareBannerSprintName={shareBannerSprint?.name ?? null}
        onShareBannerAction={handleShareBannerAction}
        onShareBannerDismiss={handleShareBannerDismiss}
      />

      <CreateSprintDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onSubmit={handleCreateSprint}
        isPending={isCreating}
        suggestedName={suggestedName}
      />

      <CloseSprintDialog
        open={closeDialogOpen}
        onOpenChange={setCloseDialogOpen}
        onConfirm={handleCloseSprint}
        onConfirmByDateRange={handleCloseSprintByDateRange}
        isPending={isClosing}
        doneItems={donePreview}
        isLoadingPreview={isLoadingPreview}
        isAdHoc={!hasActiveSprint}
        suggestedName={suggestedName}
        activeSprintName={activeSprint?.name}
        dateRange={dateRange}
        onDateRangeChange={handleDateRangeChange}
        dateRangeDoneItems={dateRangeDoneItems}
        isLoadingDateRangePreview={isLoadingDateRangePreview}
      />

      <SprintReportContainer
        sprintId={reportSprintId}
        open={reportDialogOpen}
        autoOpenShareOnLoad={autoOpenShareOnReport}
        onOpenChange={(openState) => {
          if (!openState) handleCloseReport();
        }}
        area={area}
      />
    </>
  );
};
