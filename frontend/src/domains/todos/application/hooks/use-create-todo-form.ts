"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { todosApi } from "@/lib/api/client";
import type { CreateTodoFormData } from "../../domain/types";
import { todoKeys } from "./use-todos";

export const createTodoSchema = z.object({
  title: z.string().min(1, "El titulo es obligatorio"),
  description: z.string(),
  priority: z.enum(["low", "medium", "high", "urgent"]),
  projectId: z.string(),
  ownerUserId: z.string(),
  dueDate: z.string(),
});

export const useCreateTodoForm = (
  defaultProjectId: string | null,
  onSuccess?: () => void,
) => {
  const queryClient = useQueryClient();

  const form = useForm<CreateTodoFormData>({
    resolver: zodResolver(createTodoSchema),
    defaultValues: {
      title: "",
      description: "",
      priority: "medium",
      projectId: defaultProjectId ?? "",
      ownerUserId: "",
      dueDate: "",
    },
  });

  const mutation = useMutation({
    mutationFn: (data: CreateTodoFormData) =>
      todosApi.create({
        title: data.title,
        description: data.description || null,
        priority: data.priority,
        projectId: data.projectId || null,
        status: "pending",
        ownerUserId: data.ownerUserId || null,
        dueDate: data.dueDate || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: todoKeys.all });
      showToast.success("To-do creado");
      form.reset({
        title: "",
        description: "",
        priority: "medium",
        projectId: defaultProjectId ?? "",
        ownerUserId: "",
        dueDate: "",
      });
      onSuccess?.();
    },
    onError: (error) => {
      showToast.error(error instanceof Error ? error.message : "Error al crear to-do");
    },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    await mutation.mutateAsync(values);
  });

  return {
    form,
    onSubmit,
    isPending: mutation.isPending,
  };
};
