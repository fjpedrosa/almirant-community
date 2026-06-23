"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { useCreateWorkItem } from "./use-work-items";
import { useWorkItemsByBoard } from "./use-work-item-board";
import { useParentCandidates } from "./use-parent-candidates";
import { useTags } from "@/domains/tags/application/hooks/use-tags";
import { useProjects } from "@/domains/projects/application/hooks/use-projects";
import { useCreateTag } from "@/domains/tags/application/hooks/use-tags";
import { attachmentsApi } from "@/lib/api/client";
import { useAiFormatText } from "./use-ai-format-text";
import { useAssigneeSelect } from "./use-assignee-select";
import type { WorkItemFormData, WorkItemType, AiFieldContext } from "../../domain/types";
import { isParentType } from "../../domain/types";
import type { BoardWithStats } from "@/domains/boards/domain/types";

const workItemFormSchema = z.object({
  title: z
    .string()
    .min(1, "Title is required")
    .max(500, "Title cannot exceed 500 characters"),
  type: z.enum(["epic", "feature", "story", "task", "idea"]),
  priority: z.enum(["low", "medium", "high", "urgent"]),
  description: z.string(),
  assignee: z.string(),
  dueDate: z.date().optional(),
  estimatedHours: z.number().min(0, "Estimated hours must be 0 or more").optional(),
  parentId: z.string().optional(),
  tagIds: z.array(z.string()),
  definitionOfDone: z.string(),
  projectId: z.string().optional(),
  isBug: z.boolean().default(false),
});

const WORK_ITEM_FORM_DEFAULTS: WorkItemFormData = {
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
};

export const PARENT_HIERARCHY_RULES: Record<WorkItemType, WorkItemType[]> = {
  task: ["story", "feature", "epic"],
  story: ["epic", "feature"],
  feature: ["epic"],
  epic: [],
  idea: [],
};

export const useCreateWorkItemForm = (
  activeBoardId: string,
  activeBoard: BoardWithStats | undefined,
  defaultValues?: Partial<WorkItemFormData>
) => {
  const [createSheetOpen, setCreateSheetOpen] = useState(false);
  const [createColumnId, setCreateColumnId] = useState("");
  const [createParentOpen, setCreateParentOpen] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);

  const createWorkItem = useCreateWorkItem();
  const { data: boardColumns, isLoading: isLoadingParentsByBoard } = useWorkItemsByBoard(activeBoardId);
  const { data: tags, isLoading: isLoadingTags } = useTags();
  const { data: projects } = useProjects();
  const createTag = useCreateTag();
  const aiFormat = useAiFormatText();

  const form = useForm<WorkItemFormData>({
    resolver: zodResolver(workItemFormSchema),
    mode: "onChange",
    defaultValues: {
      ...WORK_ITEM_FORM_DEFAULTS,
      ...defaultValues,
    },
  });

  // Assignee multi-select (team mode)
  const assigneeSelect = useAssigneeSelect(form);

  const watchedType = form.watch("type");
  const watchedProjectId = form.watch("projectId");
  const effectiveProjectId = watchedProjectId || undefined;
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
      .filter((item) => allowedTypes.includes(item.type))
      .map((item) => ({
        id: item.id,
        title: item.title,
        type: item.type,
      }));
  }, [boardColumns, watchedType, effectiveProjectId, projectParents]);

  const isLoadingParents = effectiveProjectId ? isLoadingParentsByProject : isLoadingParentsByBoard;

  // Clear parentId when type changes to one that doesn't support the current parent
  useEffect(() => {
    const currentParentId = form.getValues("parentId");
    if (!currentParentId) return;

    if (watchedType === "epic") {
      form.setValue("parentId", undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchedType]);

  const availableTags = useMemo(() => {
    if (!tags) return [];

    return tags.map((tag) => ({
      id: tag.id,
      name: tag.name,
      color: tag.color,
    }));
  }, [tags]);

  const availableProjects = useMemo(() => {
    if (!projects) return [];
    return projects.map((p) => ({ id: p.id, name: p.name }));
  }, [projects]);

  const handleCreateTag = useCallback(async (name: string, color: string): Promise<string> => {
    const result = await createTag.mutateAsync({ name, color });
    return (result as { id: string }).id;
  }, [createTag]);

  const handleParentCreated = useCallback((parentId: string) => {
    form.setValue("parentId", parentId);
    setCreateParentOpen(false);
  }, [form]);

  const handleAddPendingFiles = useCallback((files: File[]) => {
    setPendingFiles((prev) => [...prev, ...files]);
  }, []);

  const handleRemovePendingFile = useCallback((index: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

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

  const resetForm = () => {
    form.reset({
      ...WORK_ITEM_FORM_DEFAULTS,
      ...defaultValues,
    });
    setPendingFiles([]);
  };

  const handleCreateItem = async () => {
    const isValid = await form.trigger();
    if (!isValid) return;
    if (!activeBoard) {
      showToast.error("Could not determine the active board. Please try again.");
      return;
    }

    const data = form.getValues();

    try {
      const itemId = crypto.randomUUID();
      await createWorkItem.mutateAsync({
        id: itemId,
        projectId: data.projectId || null,
        boardId: activeBoardId,
        boardColumnId: isParentType(data.type) ? null : createColumnId,
        type: data.type,
        title: data.title,
        priority: data.priority,
        description: data.description || undefined,
        assignee: data.assignee || undefined,
        dueDate: data.dueDate ? data.dueDate.toISOString() : undefined,
        estimatedHours: data.estimatedHours ?? undefined,
        parentId: data.parentId || undefined,
        tagIds: data.tagIds.length > 0 ? data.tagIds : undefined,
        metadata: (data.definitionOfDone || data.isBug) ? {
          ...(data.definitionOfDone ? { definitionOfDone: data.definitionOfDone } : {}),
          isBug: !!data.isBug,
        } : undefined,
      });

      // Upload pending files if any
      if (pendingFiles.length > 0) {
        await Promise.allSettled(
          pendingFiles.map((file) => attachmentsApi.upload(itemId, file))
        );
      }

      resetForm();
      setCreateSheetOpen(false);
      showToast.success("Item created");
    } catch {
      showToast.error("Failed to create item");
    }
  };

  const handleSheetOpenChange = useCallback((open: boolean) => {
    setCreateSheetOpen(open);
    if (open) {
      form.reset({
        ...WORK_ITEM_FORM_DEFAULTS,
        ...defaultValues,
      });
      setPendingFiles([]);
      assigneeSelect.resetAssignees();
    } else {
      form.reset({
        ...WORK_ITEM_FORM_DEFAULTS,
        ...defaultValues,
      });
      setPendingFiles([]);
      setCreateParentOpen(false);
      assigneeSelect.resetAssignees();
    }
  }, [form, defaultValues, assigneeSelect]);

  return {
    form,
    createSheetOpen,
    setCreateSheetOpen: handleSheetOpenChange,
    createColumnId,
    setCreateColumnId,
    handleCreateItem,
    isCreating: createWorkItem.isPending,
    isFormValid: form.formState.isValid,
    availableParents,
    availableTags,
    availableProjects,
    currentUserName: assigneeSelect.currentUserName,
    handleAssignToMe: assigneeSelect.handleAssignToMe,
    handleCreateTag,
    createParentOpen,
    setCreateParentOpen,
    handleParentCreated,
    isLoadingParents,
    isLoadingTags,
    resetForm,
    pendingFiles,
    handleAddPendingFiles,
    handleRemovePendingFile,
    handleAiFormatDescription,
    handleAiFormatDefinitionOfDone,
    isAiFormattingDescription: aiFormat.isPending && aiFormat.variables?.fieldContext === "description",
    isAiFormattingDefinitionOfDone: aiFormat.isPending && aiFormat.variables?.fieldContext === "definitionOfDone",
    watchedType,
    // Assignee multi-select (team mode)
    availableAssignees: assigneeSelect.availableAssignees,
    hasActiveTeam: assigneeSelect.hasActiveTeam,
    selectedAssigneeIds: assigneeSelect.selectedAssigneeIds,
    onSelectAssignee: assigneeSelect.onSelectAssignee,
    onRemoveAssignee: assigneeSelect.onRemoveAssignee,
  };
};
