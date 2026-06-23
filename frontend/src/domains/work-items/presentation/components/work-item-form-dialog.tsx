"use client";

import { Suspense, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useConfirmDialog } from "@/domains/shared/application/hooks/use-confirm-dialog";
import { ConfirmDialog } from "@/domains/shared/presentation/components/confirm-dialog";
import { TypeBadgeSelector } from "./type-badge-selector";
import { SlidingFormPanel } from "./sliding-form-panel";
import { WorkItemFormContent } from "./work-item-form-content";
import { FileDropZone } from "@/domains/shared/presentation/components/file-drop-zone";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChevronDown, ChevronUp, History, Square } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { AgentThreadContainer } from "@/domains/agents/presentation/containers/agent-thread-container";
import { WorkItemAiRunLogsContainer } from "@/domains/agents/presentation/containers/work-item-ai-run-logs-container";
import type {
  WorkItemFormDialogProps,
  WorkItemFormData,
  WorkItemType,
} from "../../domain/types";
import type { UseFormReturn } from "react-hook-form";

export const WorkItemFormDialog: React.FC<WorkItemFormDialogProps> = ({
  open,
  onOpenChange,
  form,
  onSubmit,
  isPending,
  mode,
  workItemId,
  allowedTypes,
  availableParents,
  availableProjects,
  isLoadingParents,
  currentUserName,
  onAssignToMe,
  onCreateParentOpen,
  onCreateParentOpenChange,
  children,
  // Parent form props
  parentForm,
  onParentSubmit,
  isParentPending,
  allowedParentTypes,
  onParentAssignToMe,
  // Watched values from parent form (passed from hook)
  parentWatchedTitle,
  parentWatchedType,
  // File drop support
  onFilesDropped,
  // Form validity
  isFormValid,
  // AI formatting
  onAiFormatDescription,
  isAiFormattingDescription,
  onAiFormatDefinitionOfDone,
  isAiFormattingDefinitionOfDone,
  // Copy as prompt
  onCopyPrompt,
  isCopyingPrompt,
  showCopySuccess,
  // Column/status change
  boardColumns,
  currentColumnId,
  onChangeColumn,
  // Tags (new)
  availableTags,
  isLoadingTags,
  onCreateTag,
  // Event history
  historyContent,
  // Image upload
  onImageUpload,
  // AI processing read-only mode
  isAiProcessing,
  onStopAi,
  // Assignee multi-select
  availableAssignees,
  hasActiveTeam,
  selectedAssigneeIds,
  onSelectAssignee,
  onRemoveAssignee,
}) => {
  const t = useTranslations("workItems");
  const tCommon = useTranslations("common");
  const tTimeline = useTranslations("workItems.timeline");
  const [historyOpen, setHistoryOpen] = useState(false);
  const { confirm, ...confirmDialogProps } = useConfirmDialog();

  const hasParentForm = parentForm && onParentSubmit && allowedParentTypes && allowedParentTypes.length > 0;

  const submitLabel =
    mode === "edit"
      ? isPending
        ? tCommon("saving")
        : tCommon("saveChanges")
      : isPending
        ? tCommon("creating")
        : t("createItem");

  // Watch main form values
  const watchedTitle = form.watch("title");
  const watchedType = form.watch("type");

  const handleBack = () => {
    onCreateParentOpenChange?.(false);
  };

  const handleOpenCreateParent = () => {
    onCreateParentOpenChange?.(true);
  };

  const handleTypeChange = (newType: WorkItemType) => {
    form.setValue("type", newType);
  };

  // Reset history view when dialog closes
  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      setHistoryOpen(false);
    }
    onOpenChange(isOpen);
  };

  // Main form content
  const mainFormContent = (
    <WorkItemFormContent
      form={form}
      onSubmit={onSubmit}
      isPending={isPending}
      submitLabel={submitLabel}
      onCancel={() => handleOpenChange(false)}
      availableParents={availableParents}
      availableProjects={availableProjects}
      isLoadingParents={isLoadingParents}
      currentUserName={currentUserName}
      onAssignToMe={onAssignToMe}
      showParentField={true}
      onCreateParent={hasParentForm ? handleOpenCreateParent : undefined}
      isFormValid={isFormValid}
      onAiFormatDescription={onAiFormatDescription}
      isAiFormattingDescription={isAiFormattingDescription}
      onAiFormatDefinitionOfDone={onAiFormatDefinitionOfDone}
      isAiFormattingDefinitionOfDone={isAiFormattingDefinitionOfDone}
      onCopyPrompt={onCopyPrompt}
      isCopyingPrompt={isCopyingPrompt}
      showCopySuccess={showCopySuccess}
      availableTags={availableTags}
      isLoadingTags={isLoadingTags}
      onCreateTag={onCreateTag}
      boardColumns={boardColumns}
      currentColumnId={currentColumnId}
      onChangeColumn={onChangeColumn}
      readOnly={isAiProcessing}
      onImageUpload={onImageUpload}
      availableAssignees={availableAssignees}
      hasActiveTeam={hasActiveTeam}
      selectedAssigneeIds={selectedAssigneeIds}
      onSelectAssignee={onSelectAssignee}
      onRemoveAssignee={onRemoveAssignee}
    >
      {children}
    </WorkItemFormContent>
  );

  // Parent form content - same form but with restricted types
  const parentFormContent = hasParentForm ? (
    <WorkItemFormContent
      form={parentForm as UseFormReturn<WorkItemFormData>}
      onSubmit={onParentSubmit}
      isPending={isParentPending ?? false}
      submitLabel={isParentPending ? tCommon("creating") : t("form.createParentLabel")}
      cancelLabel={tCommon("back")}
      onCancel={handleBack}
      availableParents={[]} // Parent of parent - could extend but keeping simple
      availableProjects={availableProjects}
      isLoadingParents={false}
      currentUserName={currentUserName}
      onAssignToMe={onParentAssignToMe}
      showParentField={false} // Don't show parent field for parent creation (simplify)
    />
  ) : (
    <div />
  );

  // Available types for the badge selector (board-level restriction if configured).
  const defaultTypes: WorkItemType[] = ["epic", "feature", "story", "task"];
  const baseTypes =
    Array.isArray(allowedTypes) && allowedTypes.length > 0
      ? allowedTypes
      : defaultTypes;

  const availableTypes =
    watchedType && !baseTypes.includes(watchedType)
      ? [...baseTypes, watchedType]
      : baseTypes;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[85vh] flex flex-col sm:max-w-[700px]">
        <FileDropZone onFilesDropped={onFilesDropped || (() => {})} disabled={!onFilesDropped}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 min-w-0 w-full pr-6">
              {/* Interactive type badge selector */}
              {onCreateParentOpen && parentWatchedType ? (
                <TypeBadgeSelector
                  value={parentWatchedType}
                  onChange={(newType) => parentForm?.setValue("type", newType)}
                  availableTypes={allowedParentTypes ?? availableTypes}
                />
              ) : watchedType ? (
                <TypeBadgeSelector
                  value={watchedType}
                  onChange={handleTypeChange}
                  availableTypes={availableTypes}
                />
              ) : null}
              {onCreateParentOpen ? (
                <input
                  type="text"
                  value={parentWatchedTitle ?? ""}
                  onChange={(e) => parentForm?.setValue("title", e.target.value)}
                  placeholder={t("form.newParent")}
                  autoFocus
                  className="flex-1 min-w-0 text-lg font-semibold bg-transparent border-none outline-none focus:ring-0 placeholder:text-muted-foreground/50"
                />
              ) : (
                <input
                  type="text"
                  value={watchedTitle}
                  onChange={(e) => form.setValue("title", e.target.value)}
                  placeholder={mode === "edit" ? t("form.editItemPlaceholder") : t("form.newItem")}
                  autoFocus
                  disabled={isAiProcessing}
                  className={cn(
                    "flex-1 min-w-0 text-lg font-semibold bg-transparent border-none outline-none focus:ring-0 placeholder:text-muted-foreground/50",
                    isAiProcessing && "opacity-60"
                  )}
                />
              )}

              {/* Stop AI button - only when AI is processing */}
              {isAiProcessing && onStopAi && (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  className="h-7 shrink-0 text-xs"
                  onClick={async () => {
                    const confirmed = await confirm({
                      title: "Stop AI processing",
                      description: "Are you sure you want to stop AI processing?",
                      confirmLabel: "Stop",
                      variant: "destructive",
                    });
                    if (confirmed) {
                      onStopAi();
                    }
                  }}
                >
                  <Square className="h-3 w-3 mr-1" />
                  Stop AI
                </Button>
              )}

              {/* History toggle button - only in edit mode */}
              {mode === "edit" && historyContent && (
              <Button
                type="button"
                variant={historyOpen ? "default" : "ghost"}
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={() => setHistoryOpen((prev) => !prev)}
                title={t("form.viewHistory")}
                aria-label={t("form.viewHistory")}
              >
                <History className="h-3.5 w-3.5" />
              </Button>
              )}
            </DialogTitle>
          </DialogHeader>

          <div className="mt-2 overflow-y-auto min-h-0">
            {hasParentForm ? (
              <SlidingFormPanel
                activePanel={onCreateParentOpen ? "parent" : "main"}
                mainContent={mainFormContent}
                parentContent={parentFormContent}
              />
            ) : (
              mainFormContent
            )}

            {/* Inline, collapsible history section (detail view) */}
            {mode === "edit" && !onCreateParentOpen && historyContent && (
              <div className="mt-4 border-t pt-3">
                <button
                  type="button"
                  className="w-full flex items-center justify-between gap-2 text-sm font-medium"
                  onClick={() => setHistoryOpen((prev) => !prev)}
                >
                  <span className="flex items-center gap-2">
                    <History className="h-4 w-4 text-muted-foreground" />
                    {tTimeline("title")}
                  </span>
                  {historyOpen ? (
                    <ChevronUp className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  )}
                </button>

                {historyOpen && (
                  <ScrollArea className="max-h-[400px] overflow-y-auto pr-3 mt-3">
                    {historyContent}
                  </ScrollArea>
                )}
              </div>
            )}

            {/* Agent Thread - only in edit mode when workItemId is available */}
            {mode === "edit" && workItemId && !onCreateParentOpen && (
              <Suspense
                fallback={
                  <div className="py-4 text-center text-sm text-muted-foreground">
                    Loading thread...
                  </div>
                }
              >
                <AgentThreadContainer workItemId={workItemId} />
              </Suspense>
            )}

            {mode === "edit" && workItemId && !onCreateParentOpen && (
              <WorkItemAiRunLogsContainer workItemId={workItemId} />
            )}
          </div>
        </FileDropZone>
      </DialogContent>

      <ConfirmDialog
        isOpen={confirmDialogProps.isOpen}
        options={confirmDialogProps.options}
        onConfirm={confirmDialogProps.handleConfirm}
        onCancel={confirmDialogProps.handleCancel}
      />
    </Dialog>
  );
};
