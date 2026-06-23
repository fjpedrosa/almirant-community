"use client";

import { useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { z } from "zod";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { ideasApi } from "@/lib/api/client";
import type { QuickCaptureFormData } from "../../domain/types";
import { ideaKeys } from "./use-ideas";

/** Factory function to create quickCaptureSchema with translated messages */
const createQuickCaptureSchema = (t: (key: string) => string) =>
  z.object({
    title: z.string().min(1, t("titleRequired")),
    description: z.string(),
    type: z.literal("idea"),
    projectId: z.string().min(1, t("projectRequired")),
    ownerUserId: z.string(),
    dueDate: z.string(),
  });

export const useQuickCaptureForm = (
  defaultProjectId: string | null,
  currentUserId: string | null,
  onSuccess?: () => void
) => {
  const t = useTranslations("ideas.toasts");
  const tv = useTranslations("ideas.validation");
  const queryClient = useQueryClient();

  const schema = useMemo(() => createQuickCaptureSchema(tv), [tv]);

  const form = useForm<QuickCaptureFormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: "",
      description: "",
      type: "idea",
      projectId: defaultProjectId ?? "",
      ownerUserId: "",
      dueDate: "",
    },
  });

  const mutation = useMutation({
    mutationFn: (data: QuickCaptureFormData) =>
      ideasApi.create({
        title: data.title,
        description: data.description || null,
        type: data.type,
        projectId: data.projectId || null,
        status: "active",
        ownerUserId: data.ownerUserId || currentUserId,
        dueDate: data.dueDate || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ideaKeys.all });
      showToast.success(t("itemCreated"));
      form.reset({
        title: "",
        description: "",
        type: "idea",
        projectId: defaultProjectId ?? "",
        ownerUserId: "",
        dueDate: "",
      });
      onSuccess?.();
    },
    onError: (error) => {
      showToast.error(error instanceof Error ? error.message : t("createError"));
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
