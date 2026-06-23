"use client";

import { useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { z } from "zod";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { useCreateSeed } from "@/domains/planning/application/hooks/use-seeds-manager";
import type { CreateSeedFormData } from "../../domain/types";

const createSeedSchema = (titleRequired: string) =>
  z.object({
    title: z.string().min(1, titleRequired),
    description: z.string(),
    source: z.enum(["manual", "feedback", "ai_generated", "import"]),
    priority: z.string(),
    projectId: z.string(),
    ownerUserId: z.string(),
  });

export const useCreateSeedForm = (
  defaultProjectId: string | null,
  defaultOwnerId: string | null,
  onSuccess?: () => void,
) => {
  const createSeed = useCreateSeed();
  const t = useTranslations("seeds.toasts");

  const schema = useMemo(() => createSeedSchema(t("titleRequired")), [t]);

  const form = useForm<CreateSeedFormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: "",
      description: "",
      source: "manual",
      priority: "",
      projectId: defaultProjectId ?? "",
      ownerUserId: defaultOwnerId ?? "",
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    createSeed.mutate(
      {
        title: values.title,
        description: values.description || null,
        source: values.source,
        priority:
          (values.priority as "low" | "medium" | "high" | "urgent") || null,
        projectId: values.projectId || null,
        ownerUserId: values.ownerUserId || null,
      },
      {
        onSuccess: () => {
          showToast.success(t("seedCreated"));
          form.reset({
            title: "",
            description: "",
            source: "manual",
            priority: "",
            projectId: defaultProjectId ?? "",
            ownerUserId: defaultOwnerId ?? "",
          });
          onSuccess?.();
        },
        onError: (error) =>
          showToast.error(
            error instanceof Error ? error.message : t("createError"),
          ),
      },
    );
  });

  return {
    form,
    onSubmit,
    isPending: createSeed.isPending,
  };
};
