"use client";

import { useCallback, useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useActiveTeam } from "@/domains/teams/application/hooks/use-active-team";
import { useCreateProject } from "./use-projects";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { format } from "date-fns";
import { repositoriesApi } from "@/lib/api/client";
import { useGithubStatus } from "@/domains/github/application/hooks/use-github-status";
import { useCreateGithubRepo } from "@/domains/github/application/hooks/use-create-github-repo";

export const createProjectFormSchema = z.object({
  name: z.string().min(1, "El nombre es requerido"),
  description: z.string(),
  color: z.string(),
  status: z.enum(["active", "on_hold"]),
  clientName: z.string(),
  productionUrl: z.string(),
  stagingUrl: z.string(),
  techStack: z.array(z.string()),
  startDate: z.date().optional(),
  targetDate: z.date().optional(),
  createGithubRepo: z.boolean(),
  githubInstallationId: z.number().optional(),
  githubRepoName: z.string(),
  githubRepoIsPrivate: z.boolean(),
});

export type CreateProjectFormData = z.infer<typeof createProjectFormSchema>;

const slugifyForRepo = (value: string): string => {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
};

export const useCreateProjectForm = (onSuccess?: () => void) => {
  const createProject = useCreateProject();
  const { confirmedActiveTeamId: activeOrganizationId } = useActiveTeam();
  const { data: githubStatus } = useGithubStatus();

  const installations = useMemo(
    () => githubStatus?.installations ?? [],
    [githubStatus],
  );
  const hasGithubApp = installations.length > 0;
  const defaultInstallationId = installations[0]?.installationId ?? undefined;

  const form = useForm<CreateProjectFormData>({
    resolver: zodResolver(createProjectFormSchema),
    defaultValues: {
      name: "",
      description: "",
      color: "#6366f1",
      status: "active",
      clientName: "",
      productionUrl: "",
      stagingUrl: "",
      techStack: [],
      startDate: undefined,
      targetDate: undefined,
      createGithubRepo: false,
      githubInstallationId: undefined,
      githubRepoName: "",
      githubRepoIsPrivate: true,
    },
    mode: "onChange",
  });

  // Sync GitHub defaults once installations are known and the user hasn't
  // touched these fields yet. Avoid clobbering manual edits.
  const watchedName = form.watch("name");
  const watchedRepoName = form.watch("githubRepoName");
  const watchedCreateRepo = form.watch("createGithubRepo");
  const watchedInstallationId = form.watch("githubInstallationId");

  useEffect(() => {
    if (!hasGithubApp) return;
    if (watchedInstallationId === undefined && defaultInstallationId !== undefined) {
      form.setValue("githubInstallationId", defaultInstallationId);
    }
    if (!form.getFieldState("createGithubRepo").isDirty) {
      form.setValue("createGithubRepo", true);
    }
  }, [hasGithubApp, defaultInstallationId, watchedInstallationId, form]);

  useEffect(() => {
    if (!hasGithubApp) return;
    if (form.getFieldState("githubRepoName").isDirty) return;
    const slug = slugifyForRepo(watchedName ?? "");
    if (slug !== watchedRepoName) {
      form.setValue("githubRepoName", slug);
    }
  }, [watchedName, watchedRepoName, hasGithubApp, form]);

  const installationId = (watchedInstallationId ?? defaultInstallationId ?? 0) as number;
  const createGithubRepoMutation = useCreateGithubRepo(installationId);

  const onSubmit = useCallback(
    async (data: CreateProjectFormData) => {
      let createdProjectId: string | null = null;
      try {
        const created = (await createProject.mutateAsync({
          name: data.name,
          description: data.description || undefined,
          color: data.color,
          status: data.status,
          clientName: data.clientName || undefined,
          productionUrl: data.productionUrl || undefined,
          stagingUrl: data.stagingUrl || undefined,
          startDate: data.startDate
            ? format(data.startDate, "yyyy-MM-dd")
            : undefined,
          targetDate: data.targetDate
            ? format(data.targetDate, "yyyy-MM-dd")
            : undefined,
          techStack:
            data.techStack.length > 0 ? data.techStack : undefined,
          organizationId: activeOrganizationId,
        })) as { id: string };
        createdProjectId = created.id;
        showToast.success("Proyecto creado correctamente");
      } catch {
        showToast.error("Error al crear el proyecto");
        return;
      }

      const shouldCreateRepo =
        data.createGithubRepo &&
        hasGithubApp &&
        installationId > 0 &&
        data.githubRepoName.trim().length > 0;

      if (shouldCreateRepo && createdProjectId) {
        try {
          const repo = await createGithubRepoMutation.mutateAsync({
            name: data.githubRepoName.trim(),
            isPrivate: data.githubRepoIsPrivate,
            autoInit: true,
          });
          await repositoriesApi.create(createdProjectId, {
            name: repo.full_name.split("/").pop() ?? repo.full_name,
            url: repo.html_url,
            provider: "github",
            isMonorepo: false,
          });
          showToast.success("Repositorio de GitHub creado y vinculado");
        } catch {
          showToast.error(
            "Proyecto creado, pero no se pudo crear o vincular el repositorio de GitHub",
          );
        }
      }

      form.reset();
      onSuccess?.();
    },
    [
      activeOrganizationId,
      createGithubRepoMutation,
      createProject,
      form,
      hasGithubApp,
      installationId,
      onSuccess,
    ],
  );

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
    isPending: createProject.isPending || createGithubRepoMutation.isPending,
    onSubmit,
    addTech,
    removeTech,
    githubInstallations: installations,
    hasGithubApp,
  };
};
