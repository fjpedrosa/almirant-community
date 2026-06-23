"use client";

import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";
import { useUpdateProject } from "./use-projects";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { format } from "date-fns";
import type { ProjectWithRelations } from "../../domain/types";

export const editProjectFormSchema = z.object({
  name: z.string().min(1, "El nombre es requerido"),
  description: z.string(),
  color: z.string(),
  status: z.enum(["active", "on_hold"]),
  clientName: z.string(),
  organizationId: z.string(),
  productionUrl: z.string(),
  stagingUrl: z.string(),
  techStack: z.array(z.string()),
  startDate: z.date().optional(),
  targetDate: z.date().optional(),
});

export type EditProjectFormData = z.infer<typeof editProjectFormSchema>;

export const useEditProjectForm = (
  project: ProjectWithRelations | undefined,
  onSuccess?: () => void
) => {
  const router = useRouter();
  const updateProject = useUpdateProject();
  const [pendingSubmitData, setPendingSubmitData] =
    useState<EditProjectFormData | null>(null);

  const form = useForm<EditProjectFormData>({
    resolver: zodResolver(editProjectFormSchema),
    defaultValues: {
      name: "",
      description: "",
      color: "#6366f1",
      status: "active",
      clientName: "",
      organizationId: "",
      productionUrl: "",
      stagingUrl: "",
      techStack: [],
      startDate: undefined,
      targetDate: undefined,
    },
    mode: "onChange",
  });

  useEffect(() => {
    if (project) {
      form.reset({
        name: project.name,
        description: project.description || "",
        color: project.color,
        status: project.status as "active" | "on_hold",
        clientName: project.clientName || "",
        organizationId: project.organizationId || "",
        productionUrl: project.productionUrl || "",
        stagingUrl: project.stagingUrl || "",
        techStack: project.techStack || [],
        startDate: project.startDate ? new Date(project.startDate) : undefined,
        targetDate: project.targetDate
          ? new Date(project.targetDate)
          : undefined,
      });
    }
  }, [project, form]);

  const executeUpdate = useCallback(
    async (data: EditProjectFormData) => {
      if (!project) return;
      const previousOrganizationId = project.organizationId;
      try {
        await updateProject.mutateAsync({
          id: project.id,
          data: {
            name: data.name,
            description: data.description || null,
            color: data.color,
            status: data.status,
            clientName: data.clientName || null,
            organizationId: data.organizationId || null,
            productionUrl: data.productionUrl || null,
            stagingUrl: data.stagingUrl || null,
            startDate: data.startDate
              ? format(data.startDate, "yyyy-MM-dd")
              : null,
            targetDate: data.targetDate
              ? format(data.targetDate, "yyyy-MM-dd")
              : null,
            techStack:
              data.techStack.length > 0 ? data.techStack : null,
          },
        });
        showToast.success("Proyecto actualizado correctamente");
        if (data.organizationId !== (previousOrganizationId ?? "")) {
          router.push("/projects");
        }
        onSuccess?.();
      } catch {
        showToast.error("Error al actualizar el proyecto");
      }
    },
    [updateProject, project, onSuccess, router]
  );

  const onSubmit = useCallback(
    async (data: EditProjectFormData) => {
      if (!project) return;
      const isTransfer =
        data.organizationId !== (project.organizationId ?? "");
      if (isTransfer) {
        setPendingSubmitData(data);
        return;
      }
      await executeUpdate(data);
    },
    [project, executeUpdate]
  );

  const onConfirmTransfer = useCallback(async () => {
    if (!pendingSubmitData) return;
    const dataToSubmit = pendingSubmitData;
    setPendingSubmitData(null);
    await executeUpdate(dataToSubmit);
  }, [pendingSubmitData, executeUpdate]);

  const onCancelTransfer = useCallback(() => {
    setPendingSubmitData(null);
  }, []);

  const addTech = useCallback(
    (tech: string) => {
      const current = form.getValues("techStack") || [];
      if (tech.trim() && !current.includes(tech.trim())) {
        form.setValue("techStack", [...current, tech.trim()]);
      }
    },
    [form]
  );

  const removeTech = useCallback(
    (tech: string) => {
      const current = form.getValues("techStack") || [];
      form.setValue(
        "techStack",
        current.filter((t) => t !== tech)
      );
    },
    [form]
  );

  return {
    form,
    isPending: updateProject.isPending,
    onSubmit,
    onConfirmTransfer,
    onCancelTransfer,
    pendingTransferOrgId: pendingSubmitData?.organizationId ?? null,
    addTech,
    removeTech,
  };
};
