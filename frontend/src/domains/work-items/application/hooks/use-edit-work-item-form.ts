"use client";

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { useWorkItem, useUpdateWorkItem } from "./use-work-items";
import { useWorkItemsByBoard, useMoveWorkItem } from "./use-work-item-board";
import { useParentCandidates } from "./use-parent-candidates";
import { useTags } from "@/domains/tags/application/hooks/use-tags";
import { useAttachments, useUploadAttachment, useDeleteAttachment } from "./use-attachments";
import { useProjects } from "@/domains/projects/application/hooks/use-projects";
import { useCreateTag } from "@/domains/tags/application/hooks/use-tags";
import { useAiFormatText } from "./use-ai-format-text";
import { useAssigneeSelect } from "./use-assignee-select";
import type { WorkItemFormData, WorkItemType, AiFieldContext } from "../../domain/types";

const workItemFormSchema = z.object({
  title: z.string().min(1, "Title is required").max(500, "Max 500 chars"),
  type: z.enum(["epic", "feature", "story", "task", "idea"]),
  priority: z.enum(["low", "medium", "high", "urgent"]),
  description: z.string(),
  assignee: z.string(),
  dueDate: z.date().optional(),
  estimatedHours: z.number().min(0).optional(),
  parentId: z.string().optional(),
  tagIds: z.array(z.string()),
  definitionOfDone: z.string(),
  projectId: z.string().optional(),
  isBug: z.boolean().default(false),
});

const PARENT_HIERARCHY_RULES: Record<WorkItemType, WorkItemType[]> = {
  task: ["story", "feature", "epic"],
  story: ["epic", "feature"],
  feature: ["epic"],
  epic: [],
  idea: [],
};

export const useEditWorkItemForm = (boardId: string) => {
  const [editSheetOpen, setEditSheetOpen] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);

  const { data: workItem, isLoading: isLoadingItem } = useWorkItem(editingItemId || "");
  const updateWorkItem = useUpdateWorkItem();
  const { data: boardColumns, isLoading: isLoadingBoardColumns } = useWorkItemsByBoard(boardId);
  const { data: tags, isLoading: isLoadingTags } = useTags();

  // Attachment hooks
  const { data: attachments, isLoading: isLoadingAttachments } = useAttachments(editingItemId || "");
  const uploadAttachment = useUploadAttachment(editingItemId || "");
  const deleteAttachment = useDeleteAttachment(editingItemId || "");

  const { data: projects } = useProjects();
  const createTag = useCreateTag();
  const aiFormat = useAiFormatText();
  const moveWorkItem = useMoveWorkItem(boardId);

  const form = useForm<WorkItemFormData>({
    resolver: zodResolver(workItemFormSchema),
    mode: "onChange",
    defaultValues: {
      title: "",
      type: "task",
      priority: "medium",
      description: "",
      assignee: "",
      dueDate: undefined,
      estimatedHours: undefined,
      parentId: undefined,
      tagIds: [],
      definitionOfDone: "",
      projectId: undefined,
      isBug: false,
    },
  });

  // Assignee multi-select (team mode)
  const {
    availableAssignees,
    hasActiveTeam,
    selectedAssigneeIds,
    onSelectAssignee,
    onRemoveAssignee,
    handleAssignToMe,
    resetAssignees,
    initFromAssigneeName,
    currentUserName,
  } = useAssigneeSelect(form);
  const lastHydratedWorkItemKeyRef = useRef<string | null>(null);

  // When the work item loads, populate the form
  useEffect(() => {
    if (workItem && editSheetOpen) {
      const hydratedKey = `${workItem.id}:${String(workItem.updatedAt)}`;
      if (lastHydratedWorkItemKeyRef.current === hydratedKey) return;
      lastHydratedWorkItemKeyRef.current = hydratedKey;
      form.reset({
        title: workItem.title,
        type: workItem.type,
        priority: workItem.priority,
        description: workItem.description || "",
        assignee: workItem.assignee || "",
        dueDate: workItem.dueDate ? new Date(workItem.dueDate) : undefined,
        estimatedHours: workItem.estimatedHours ?? undefined,
        parentId: workItem.parentId ?? undefined,
        tagIds: workItem.tags?.map((t) => t.id) || [],
        definitionOfDone: (workItem.metadata?.definitionOfDone as string) || "",
        projectId: workItem.projectId || undefined,
        isBug: (workItem.metadata?.isBug as boolean) || false,
      });
      // Initialize assignee multi-select from existing assignee name
      initFromAssigneeName(workItem.assignee);
    }
  }, [workItem, editSheetOpen, form, initFromAssigneeName]);

  // eslint-disable-next-line react-hooks/incompatible-library -- React Hook Form watch() is intentional here.
  const watchedType = form.watch("type");
  const watchedProjectId = form.watch("projectId");
  const effectiveProjectId = watchedProjectId || (workItem?.projectId ?? undefined);
  const { parents: projectParents, isLoading: isLoadingParentsByProject } =
    useParentCandidates(effectiveProjectId);

  const availableParents = useMemo(() => {
    const allowedTypes = PARENT_HIERARCHY_RULES[watchedType];
    // When using projectParents, completed parents are already filtered out by useParentCandidates.
    // When using boardColumns, we filter out items that sit in a Done column.
    const sourceItems = effectiveProjectId
      ? projectParents
      : (boardColumns?.flatMap((col) =>
          col.items
            .filter(() => !col.column.isDone)
            .map((item) => ({
              id: item.id,
              title: item.title,
              type: item.type,
            }))
        ) ?? []);

    return sourceItems
      .filter((item) => allowedTypes.includes(item.type) && item.id !== editingItemId)
      .map((item) => ({ id: item.id, title: item.title, type: item.type }));
  }, [boardColumns, watchedType, editingItemId, effectiveProjectId, projectParents]);

  const isLoadingParents = effectiveProjectId ? isLoadingParentsByProject : isLoadingBoardColumns;

  const buildToastLabel = (args: { taskId?: string | null; title?: string | null }) => {
    const taskId = args.taskId?.trim();
    const title = args.title?.trim();
    if (taskId && title) return `${taskId}: ${title}`;
    return taskId || title || null;
  };

  const availableTags = useMemo(() => {
    if (!tags) return [];
    return tags.map((tag) => ({ id: tag.id, name: tag.name, color: tag.color }));
  }, [tags]);

  const availableProjects = useMemo(() => {
    if (!projects) return [];
    return projects.map((p) => ({ id: p.id, name: p.name }));
  }, [projects]);

  const boardColumnsList = useMemo(() => {
    if (!boardColumns) return [];
    return boardColumns.map((col) => col.column);
  }, [boardColumns]);

  const currentColumnId = useMemo(() => {
    if (!editingItemId || !boardColumns) return null;
    for (const col of boardColumns) {
      if (col.items.some((item) => item.id === editingItemId)) {
        return col.column.id;
      }
    }
    return workItem?.boardColumnId ?? null;
  }, [editingItemId, boardColumns, workItem]);

  const handleChangeColumn = useCallback(
    (columnId: string) => {
      if (!editingItemId || columnId === currentColumnId) return;
      moveWorkItem.mutate(
        { id: editingItemId, boardColumnId: columnId, position: 0 },
        {
          onSuccess: () => {
            const label = buildToastLabel({ taskId: workItem?.taskId ?? null, title: workItem?.title ?? null });
            showToast.success(label ? `Status updated: ${label}` : "Status updated");
          },
          onError: () => showToast.error("Failed to change status"),
        }
      );
    },
    [editingItemId, currentColumnId, moveWorkItem, workItem]
  );

  const handleCreateTag = useCallback(async (name: string, color: string): Promise<string> => {
    const result = await createTag.mutateAsync({ name, color });
    return (result as { id: string }).id;
  }, [createTag]);

  const [createParentOpen, setCreateParentOpen] = useState(false);

  const handleParentCreated = useCallback((parentId: string) => {
    form.setValue("parentId", parentId);
    setCreateParentOpen(false);
  }, [form]);

  const handleAiFormat = useCallback(
    (fieldContext: AiFieldContext) => {
      const fieldName = fieldContext === "description" ? "description" : "definitionOfDone";
      const text = form.getValues(fieldName);
      if (!text.trim()) return;

      aiFormat.mutate(
        { text, fieldContext },
        {
          onSuccess: (data) => {
            form.setValue(fieldName, data.formattedText, { shouldDirty: true });
          },
        }
      );
    },
    [form, aiFormat]
  );

  const handleAiFormatDescription = useCallback(
    () => handleAiFormat("description"),
    [handleAiFormat]
  );

  const handleAiFormatDefinitionOfDone = useCallback(
    () => handleAiFormat("definitionOfDone"),
    [handleAiFormat]
  );

  const openEditSheet = useCallback((itemId: string) => {
    setEditingItemId(itemId);
    setEditSheetOpen(true);
  }, []);

  const closeEditSheet = useCallback(() => {
    setEditSheetOpen(false);
    setEditingItemId(null);
    setCreateParentOpen(false);
    lastHydratedWorkItemKeyRef.current = null;
    resetAssignees();
  }, [resetAssignees]);

  const handleEditSubmit = async () => {
    const isValid = await form.trigger();
    if (!isValid || !editingItemId) return;

    const data = form.getValues();

    try {
      await updateWorkItem.mutateAsync({
        id: editingItemId,
        data: {
          title: data.title,
          type: data.type,
          priority: data.priority,
          description: data.description || null,
          assignee: data.assignee || null,
          dueDate: data.dueDate ? data.dueDate.toISOString() : null,
          estimatedHours: data.estimatedHours ?? null,
          parentId: data.parentId || null,
          tagIds: data.tagIds,
          projectId: data.projectId || null,
          metadata: {
            ...(data.definitionOfDone ? { definitionOfDone: data.definitionOfDone } : {}),
            isBug: !!data.isBug,
          },
        },
      });
      {
        const label = buildToastLabel({ taskId: workItem?.taskId ?? null, title: data.title });
        showToast.success(label ? `Item updated: ${label}` : "Item updated");
      }
      closeEditSheet();
    } catch {
      // Error toast handled by useUpdateWorkItem onError
    }
  };

  const handleSheetOpenChange = useCallback((open: boolean) => {
    if (!open) closeEditSheet();
    else setEditSheetOpen(true);
  }, [closeEditSheet]);

  const handleUploadAttachment = useCallback(
    (file: File) => uploadAttachment.mutate(file),
    [uploadAttachment]
  );

  const handleDeleteAttachmentCb = useCallback(
    (attachmentId: string) => deleteAttachment.mutate(attachmentId),
    [deleteAttachment]
  );

  const stableAttachments = useMemo(() => attachments || [], [attachments]);

  return {
    editForm: form,
    editSheetOpen,
    setEditSheetOpen: handleSheetOpenChange,
    editingItemId,
    openEditSheet,
    closeEditSheet,
    handleEditSubmit,
    isEditing: updateWorkItem.isPending,
    isLoadingItem,
    availableParents,
    availableTags,
    availableProjects,
    isLoadingParents,
    isLoadingTags,
    currentUserName,
    handleAssignToMe,
    handleCreateTag,
    createParentOpen,
    setCreateParentOpen,
    handleParentCreated,
    // Attachments
    attachments: stableAttachments,
    isLoadingAttachments,
    handleUploadAttachment,
    handleDeleteAttachment: handleDeleteAttachmentCb,
    isUploading: uploadAttachment.isPending,
    handleAiFormatDescription,
    handleAiFormatDefinitionOfDone,
    isAiFormattingDescription: aiFormat.isPending && aiFormat.variables?.fieldContext === "description",
    isAiFormattingDefinitionOfDone: aiFormat.isPending && aiFormat.variables?.fieldContext === "definitionOfDone",
    // Column/status change
    boardColumnsList,
    currentColumnId,
    handleChangeColumn,
    isMoving: moveWorkItem.isPending,
    watchedType,
    // Assignee multi-select (team mode)
    availableAssignees,
    hasActiveTeam,
    selectedAssigneeIds,
    onSelectAssignee,
    onRemoveAssignee,
  };
};
