"use client";

import { useState, useCallback, useMemo } from "react";
import { useParentDetailPanel } from "./use-parent-detail-panel";
import { useUpdateWorkItem } from "./use-work-items";
import { useWorkItemsByBoard, useMoveWorkItem } from "./use-work-item-board";
import { useParentCandidates } from "./use-parent-candidates";
import { useTags, useCreateTag } from "@/domains/tags/application/hooks/use-tags";
import { useTeamMembersSelect } from "@/domains/teams/application/hooks/use-team-members-select";
import { useAiFormatText } from "./use-ai-format-text";
import type { WorkItemMetadata, WorkItemType, Priority } from "../../domain/types";

export const useWorkItemDetailPanel = () => {
  const panel = useParentDetailPanel();
  const updateWorkItem = useUpdateWorkItem();
  const aiFormat = useAiFormatText();

  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editDefinitionOfDone, setEditDefinitionOfDone] = useState("");

  // Metadata data sources
  const { data: tagsData, isLoading: isLoadingTags } = useTags();
  const createTag = useCreateTag();
  const parentProjectId = panel.parentItem?.projectId ?? undefined;
  const { parents: parentCandidates, isLoading: isLoadingParents } = useParentCandidates(parentProjectId);
  const parentBoardId = panel.parentItem?.boardId ?? "";
  const { data: boardColumnsData } = useWorkItemsByBoard(parentBoardId);
  const moveWorkItem = useMoveWorkItem(parentBoardId);
  const { members, hasActiveTeam } = useTeamMembersSelect();

  // Derive board columns from board data
  const boardColumns = useMemo(
    () => boardColumnsData?.map((col) => col.column) ?? [],
    [boardColumnsData]
  );

  // Derive available assignees from team members
  const availableAssignees = useMemo(
    () =>
      members.map((m) => ({
        id: m.id,
        name: m.name,
        email: m.email,
        image: m.image ?? null,
      })),
    [members]
  );

  // Derive selected assignee IDs from the current item's assignees
  const selectedAssigneeIds = useMemo(
    () => panel.parentItem?.assignees?.map((a) => a.userId) ?? [],
    [panel.parentItem?.assignees]
  );

  // Available tags
  const availableTags = useMemo(
    () => tagsData?.map((t) => ({ id: t.id, name: t.name, color: t.color })) ?? [],
    [tagsData]
  );

  // Current tag IDs
  const tagIds = useMemo(
    () => panel.parentItem?.tags?.map((t) => t.id) ?? [],
    [panel.parentItem?.tags]
  );

  const enterEditMode = useCallback(() => {
    if (!panel.parentItem) return;
    const metadata = panel.parentItem.metadata as WorkItemMetadata | undefined;
    setEditTitle(panel.parentItem.title);
    setEditDescription(panel.parentItem.description ?? "");
    setEditDefinitionOfDone(metadata?.definitionOfDone ?? "");
    setIsEditing(true);
  }, [panel.parentItem]);

  const handleCancel = useCallback(() => {
    setIsEditing(false);
    setEditTitle("");
    setEditDescription("");
    setEditDefinitionOfDone("");
  }, []);

  const toggleEdit = useCallback(() => {
    if (isEditing) {
      handleCancel();
    } else {
      enterEditMode();
    }
  }, [isEditing, handleCancel, enterEditMode]);

  const handleSave = useCallback(async () => {
    if (!panel.parentItem) return;
    const metadata = panel.parentItem.metadata as WorkItemMetadata | undefined;
    await updateWorkItem.mutateAsync({
      id: panel.parentItem.id,
      data: {
        title: editTitle,
        description: editDescription,
        metadata: {
          ...metadata,
          definitionOfDone: editDefinitionOfDone,
        },
      },
    });
    setIsEditing(false);
  }, [
    panel.parentItem,
    editTitle,
    editDescription,
    editDefinitionOfDone,
    updateWorkItem,
  ]);

  // --- Immediate-save metadata handlers ---

  const handleTypeChange = useCallback(
    (type: WorkItemType) => {
      if (!panel.parentItem) return;
      updateWorkItem.mutate({
        id: panel.parentItem.id,
        data: { type },
      });
    },
    [panel.parentItem, updateWorkItem]
  );

  const handlePriorityChange = useCallback(
    (priority: Priority) => {
      if (!panel.parentItem) return;
      updateWorkItem.mutate({
        id: panel.parentItem.id,
        data: { priority },
      });
    },
    [panel.parentItem, updateWorkItem]
  );

  const handleColumnChange = useCallback(
    (columnId: string) => {
      if (!panel.parentItem) return;
      moveWorkItem.mutate({
        id: panel.parentItem.id,
        boardColumnId: columnId,
        position: 0,
      });
    },
    [panel.parentItem, moveWorkItem]
  );

  const handleSelectAssignee = useCallback(
    (userId: string) => {
      if (!panel.parentItem) return;
      const user = availableAssignees.find((u) => u.id === userId);
      if (!user) return;
      updateWorkItem.mutate({
        id: panel.parentItem.id,
        data: { assignee: user.name },
      });
    },
    [panel.parentItem, updateWorkItem, availableAssignees]
  );

  const handleRemoveAssignee = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    (_userId: string) => {
      if (!panel.parentItem) return;
      updateWorkItem.mutate({
        id: panel.parentItem.id,
        data: { assignee: null },
      });
    },
    [panel.parentItem, updateWorkItem]
  );

  const handleDueDateChange = useCallback(
    (date: Date | null) => {
      if (!panel.parentItem) return;
      updateWorkItem.mutate({
        id: panel.parentItem.id,
        data: { dueDate: date ? date.toISOString() : null },
      });
    },
    [panel.parentItem, updateWorkItem]
  );

  const handleEstimatedHoursChange = useCallback(
    (hours: number | null) => {
      if (!panel.parentItem) return;
      updateWorkItem.mutate({
        id: panel.parentItem.id,
        data: { estimatedHours: hours },
      });
    },
    [panel.parentItem, updateWorkItem]
  );

  const handleParentChange = useCallback(
    (parentId: string | undefined) => {
      if (!panel.parentItem) return;
      updateWorkItem.mutate({
        id: panel.parentItem.id,
        data: { parentId: parentId ?? null },
      });
    },
    [panel.parentItem, updateWorkItem]
  );

  const handleTagsChange = useCallback(
    (newTagIds: string[]) => {
      if (!panel.parentItem) return;
      updateWorkItem.mutate({
        id: panel.parentItem.id,
        data: { tagIds: newTagIds },
      });
    },
    [panel.parentItem, updateWorkItem]
  );

  const handleBugToggle = useCallback(
    (isBug: boolean) => {
      if (!panel.parentItem) return;
      const metadata = panel.parentItem.metadata as WorkItemMetadata | undefined;
      updateWorkItem.mutate({
        id: panel.parentItem.id,
        data: {
          metadata: {
            ...metadata,
            isBug,
          },
        },
      });
    },
    [panel.parentItem, updateWorkItem]
  );

  const handleCreateTag = useCallback(
    async (name: string, color: string): Promise<string> => {
      const result = await createTag.mutateAsync({ name, color });
      return (result as { id: string }).id;
    },
    [createTag]
  );

  // AI formatting
  const handleAiFormatDescription = useCallback(() => {
    if (!editDescription.trim()) return;
    aiFormat.mutate(
      { text: editDescription, fieldContext: "description" as const },
      {
        onSuccess: (data) => {
          setEditDescription(data.formattedText);
        },
      }
    );
  }, [editDescription, aiFormat]);

  const handleAiFormatDefinitionOfDone = useCallback(() => {
    if (!editDefinitionOfDone.trim()) return;
    aiFormat.mutate(
      { text: editDefinitionOfDone, fieldContext: "definitionOfDone" as const },
      {
        onSuccess: (data) => {
          setEditDefinitionOfDone(data.formattedText);
        },
      }
    );
  }, [editDefinitionOfDone, aiFormat]);

  return useMemo(
    () => ({
      ...panel,
      // Edit mode state
      isEditing,
      toggleEdit,
      editTitle,
      setEditTitle,
      editDescription,
      setEditDescription,
      editDefinitionOfDone,
      setEditDefinitionOfDone,
      handleSave,
      handleCancel,
      isSaving: updateWorkItem.isPending,
      // AI formatting
      handleAiFormatDescription,
      isAiFormattingDescription:
        aiFormat.isPending &&
        aiFormat.variables?.fieldContext === "description",
      handleAiFormatDefinitionOfDone,
      isAiFormattingDefinitionOfDone:
        aiFormat.isPending &&
        aiFormat.variables?.fieldContext === "definitionOfDone",
      // Metadata editors
      handleTypeChange,
      handlePriorityChange,
      boardColumns,
      currentColumnId: panel.parentItem?.boardColumnId ?? null,
      handleColumnChange,
      availableAssignees,
      hasActiveTeam,
      selectedAssigneeIds,
      handleSelectAssignee,
      handleRemoveAssignee,
      dueDate: panel.parentItem?.dueDate ?? null,
      handleDueDateChange,
      estimatedHours: panel.parentItem?.estimatedHours ?? null,
      handleEstimatedHoursChange,
      availableParents: parentCandidates,
      isLoadingParents,
      handleParentChange,
      availableTags,
      isLoadingTags,
      tagIds,
      handleTagsChange,
      handleCreateTag,
      isBug: (panel.parentItem?.metadata as WorkItemMetadata | undefined)?.isBug ?? false,
      handleBugToggle,
    }),
    [
      panel,
      isEditing,
      toggleEdit,
      editTitle,
      setEditTitle,
      editDescription,
      setEditDescription,
      editDefinitionOfDone,
      setEditDefinitionOfDone,
      handleSave,
      handleCancel,
      updateWorkItem.isPending,
      handleAiFormatDescription,
      handleAiFormatDefinitionOfDone,
      aiFormat.isPending,
      aiFormat.variables?.fieldContext,
      handleTypeChange,
      handlePriorityChange,
      boardColumns,
      handleColumnChange,
      availableAssignees,
      hasActiveTeam,
      selectedAssigneeIds,
      handleSelectAssignee,
      handleRemoveAssignee,
      handleDueDateChange,
      handleEstimatedHoursChange,
      parentCandidates,
      isLoadingParents,
      handleParentChange,
      availableTags,
      isLoadingTags,
      tagIds,
      handleTagsChange,
      handleCreateTag,
      handleBugToggle,
    ]
  );
};
