"use client";

import { useCallback, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { useCreateTeam, useUpdateTeam } from "./use-teams";
import type { Team } from "../../domain/types";

// ──────────────────────────────────────────────
// Schema
// ──────────────────────────────────────────────

const teamFormSchema = z.object({
  name: z
    .string()
    .min(2, "Team name must be at least 2 characters")
    .max(100, "Team name cannot exceed 100 characters"),
  slug: z.string().optional(),
});

export type TeamFormValues = z.infer<typeof teamFormSchema>;

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

const generateSlug = (name: string): string =>
  name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

// ──────────────────────────────────────────────
// Hook
// ──────────────────────────────────────────────

export const useTeamForm = (
  onSuccess?: () => void,
  initialData?: Team | null,
) => {
  const isEditMode = !!initialData;

  const form = useForm<TeamFormValues>({
    resolver: zodResolver(teamFormSchema),
    mode: "onChange",
    defaultValues: {
      name: initialData?.name ?? "",
      slug: initialData?.slug ?? "",
    },
  });

  const createTeam = useCreateTeam();
  const updateTeam = useUpdateTeam();

  const isPending = createTeam.isPending || updateTeam.isPending;

  const isFormValid = useMemo(() => {
    return form.formState.isValid && !isPending;
  }, [form.formState.isValid, isPending]);

  const onSubmit = useCallback(
    async (values: TeamFormValues) => {
      const slug = values.slug?.trim() || generateSlug(values.name);

      if (isEditMode) {
        updateTeam.mutate(
          {
            data: {
              name: values.name,
              slug,
            },
          },
          {
            onSuccess: () => {
              showToast.success("Team updated");
              form.reset();
              onSuccess?.();
            },
            onError: (error) => {
              showToast.error(error.message);
            },
          },
        );
      } else {
        createTeam.mutate(
          {
            name: values.name,
            slug,
          },
          {
            onSuccess: () => {
              showToast.success("Team created");
              form.reset();
              onSuccess?.();
            },
            onError: (error) => {
              showToast.error(error.message);
            },
          },
        );
      }
    },
    [isEditMode, createTeam, updateTeam, form, onSuccess],
  );

  return {
    form,
    isPending,
    isFormValid,
    isEditMode,
    onSubmit: form.handleSubmit(onSubmit),
    generateSlug,
  };
};
