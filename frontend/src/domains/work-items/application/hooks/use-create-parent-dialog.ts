"use client";

import { useCallback } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { useCreateWorkItem } from "./use-work-items";
import type { WorkItemType, Priority, WorkItemFormData } from "../../domain/types";

const PARENT_HIERARCHY_RULES: Record<WorkItemType, WorkItemType[]> = {
  task: ["story", "feature", "epic"],
  story: ["epic", "feature"],
  feature: ["epic"],
  epic: [],
  idea: [],
};

// Same schema as main form
const createParentSchema = z.object({
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
});

export const useCreateParentDialog = (
  childType: WorkItemType,
  boardId: string,
  projectId: string,
  boardColumnId: string,
  onParentCreated: (parentId: string, parentTitle: string) => void,
  currentUserName?: string
) => {
  const createWorkItem = useCreateWorkItem();

  const allowedParentTypes = childType ? PARENT_HIERARCHY_RULES[childType] : [];
  const defaultParentType = allowedParentTypes[0] || "feature";

  const form = useForm<WorkItemFormData>({
    resolver: zodResolver(createParentSchema),
    defaultValues: {
      title: "",
      type: defaultParentType as WorkItemType,
      priority: "medium" as Priority,
      description: "",
      assignee: "",
      dueDate: undefined,
      estimatedHours: undefined,
      parentId: undefined,
      tagIds: [],
      definitionOfDone: "",
      projectId: projectId || undefined,
    },
  });

  const handleAssignToMe = useCallback(() => {
    if (currentUserName) {
      form.setValue("assignee", currentUserName);
    }
  }, [currentUserName, form]);

  const handleSubmit = useCallback(async () => {
    const isValid = await form.trigger();
    if (!isValid) return;

    const data = form.getValues();

    try {
      const generatedId = crypto.randomUUID();
      await createWorkItem.mutateAsync({
        id: generatedId,
        projectId: data.projectId || projectId,
        boardId,
        boardColumnId,
        type: data.type,
        title: data.title,
        priority: data.priority,
        description: data.description || undefined,
        dueDate: data.dueDate ? data.dueDate.toISOString() : undefined,
        estimatedHours: data.estimatedHours ?? undefined,
        assignee: data.assignee || undefined,
        parentId: data.parentId || undefined,
        tagIds: data.tagIds.length > 0 ? data.tagIds : undefined,
        metadata: data.definitionOfDone ? { definitionOfDone: data.definitionOfDone } : undefined,
      });

      showToast.success("Parent created");
      form.reset({
        title: "",
        type: defaultParentType as WorkItemType,
        priority: "medium",
        description: "",
        assignee: "",
        dueDate: undefined,
        estimatedHours: undefined,
        parentId: undefined,
        tagIds: [],
        definitionOfDone: "",
        projectId: projectId || undefined,
      });
      onParentCreated(generatedId, data.title);
    } catch {
      showToast.error("Failed to create parent");
    }
  }, [form, createWorkItem, projectId, boardId, boardColumnId, defaultParentType, onParentCreated]);

  // Watch values in the hook where form is created (for proper reactivity)
  // eslint-disable-next-line react-hooks/incompatible-library
  const watchedTitle = form.watch("title");
  const watchedType = form.watch("type");

  return {
    form,
    handleSubmit,
    isPending: createWorkItem.isPending,
    allowedParentTypes,
    handleAssignToMe,
    currentUserName,
    // Expose watched values for parent components
    watchedTitle,
    watchedType,
  };
};
