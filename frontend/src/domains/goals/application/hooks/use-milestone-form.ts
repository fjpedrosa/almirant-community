"use client";

import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { z } from "zod";
import { workItemsApi } from "@/lib/api/client";
import type { WorkItemWithRelations } from "@/domains/work-items/domain/types";
import type {
  MilestoneFormValues,
  MilestoneWithProgress,
  MilestoneWorkItemOption,
} from "../../domain/types";
import {
  useAddWorkItemsToMilestone,
  useCreateMilestone,
  useRemoveWorkItemFromMilestone,
  useUpdateMilestone,
} from "./use-milestones";

const milestoneFormSchema = z.object({
  title: z.string().min(1, "El título es obligatorio").max(255, "Máximo 255 caracteres"),
  description: z.string(),
  targetDate: z.string().min(1, "La fecha objetivo es obligatoria"),
  priority: z.enum(["low", "medium", "high", "urgent"]),
  workItemIds: z.array(z.string()),
});

const toDateInput = (value: string | null | undefined): string => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
};

const getDefaultValues = (milestone?: MilestoneWithProgress | null): MilestoneFormValues => ({
  title: milestone?.title ?? "",
  description: milestone?.description ?? "",
  targetDate: toDateInput(milestone?.targetDate),
  priority: milestone?.priority ?? "medium",
  workItemIds: milestone?.workItems?.map((item) => item.id) ?? [],
});

interface UseMilestoneFormOptions {
  projectId: string | null;
  milestone?: MilestoneWithProgress | null;
  onSuccess?: () => void;
}

export const useMilestoneForm = ({
  projectId,
  milestone,
  onSuccess,
}: UseMilestoneFormOptions) => {
  const createMilestone = useCreateMilestone();
  const updateMilestone = useUpdateMilestone();
  const addWorkItems = useAddWorkItemsToMilestone();
  const removeWorkItem = useRemoveWorkItemFromMilestone();

  const form = useForm<MilestoneFormValues>({
    resolver: zodResolver(milestoneFormSchema),
    mode: "onChange",
    defaultValues: getDefaultValues(milestone),
  });

  useEffect(() => {
    form.reset(getDefaultValues(milestone));
  }, [form, milestone]);

  const workItemsQuery = useQuery({
    queryKey: ["goals", "project-work-items", projectId ?? ""],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("projectId", projectId!);
      params.set("limit", "200");
      return workItemsApi.list(params) as Promise<WorkItemWithRelations[]>;
    },
    enabled: !!projectId,
  });

  const availableWorkItems = useMemo<MilestoneWorkItemOption[]>(
    () =>
      (workItemsQuery.data ?? []).map((item) => ({
        id: item.id,
        taskId: item.taskId,
        title: item.title,
        type: item.type,
        priority: item.priority,
      })),
    [workItemsQuery.data]
  );

  const onSubmit = form.handleSubmit(async (values) => {
    if (!projectId) {
      showToast.error("Selecciona un proyecto para continuar");
      return;
    }

    try {
      if (!milestone) {
        await createMilestone.mutateAsync({
          projectId,
          title: values.title,
          description: values.description || null,
          priority: values.priority,
          targetDate: values.targetDate,
          workItemIds: values.workItemIds,
        });
        showToast.success("Milestone creado");
      } else {
        await updateMilestone.mutateAsync({
          id: milestone.id,
          payload: {
            title: values.title,
            description: values.description || null,
            priority: values.priority,
            targetDate: values.targetDate,
          },
        });

        const previousWorkItemIds = new Set(
          milestone.workItems?.map((item) => item.id) ?? []
        );
        const nextWorkItemIds = new Set(values.workItemIds);

        const toAdd = values.workItemIds.filter((id) => !previousWorkItemIds.has(id));
        const toRemove = Array.from(previousWorkItemIds).filter((id) => !nextWorkItemIds.has(id));

        if (toAdd.length > 0) {
          await addWorkItems.mutateAsync({ id: milestone.id, workItemIds: toAdd });
        }

        if (toRemove.length > 0) {
          await Promise.all(
            toRemove.map((workItemId) =>
              removeWorkItem.mutateAsync({ id: milestone.id, workItemId })
            )
          );
        }

        showToast.success("Milestone actualizado");
      }

      onSuccess?.();
    } catch {
      showToast.error("No se pudo guardar el milestone");
    }
  });

  return {
    form,
    onSubmit,
    availableWorkItems,
    isLoadingWorkItems: workItemsQuery.isLoading,
    isPending:
      createMilestone.isPending
      || updateMilestone.isPending
      || addWorkItems.isPending
      || removeWorkItem.isPending,
  };
};
