"use client";

import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useProjectsPage, colorOptions } from "../../application/hooks/use-projects-page";
import { useCreateProjectForm } from "../../application/hooks/use-create-project-form";
import { usePrefetchProjectDetail } from "../../application/hooks/use-prefetch-project-detail";
import { CreateProjectDialog } from "../components/create-project-dialog";
import { ProjectsFilterBar } from "../components/projects-filter-bar";
import { ProjectsGrid } from "../components/projects-grid";

export const ProjectsPageContainer: React.FC = () => {
  const {
    search,
    setSearch,
    statusFilter,
    setStatusFilter,
    dialogOpen,
    setDialogOpen,
    projects,
    isLoading,
  } = useProjectsPage();

  const t = useTranslations("projects");

  const { prefetchProject, cancelPrefetch } = usePrefetchProjectDetail();

  const {
    form,
    isPending,
    onSubmit,
    addTech,
    removeTech,
    githubInstallations,
    hasGithubApp,
  } = useCreateProjectForm(() => setDialogOpen(false));

  const handleDialogChange = (open: boolean) => {
    setDialogOpen(open);
    if (!open) form.reset();
  };

  return (
    <div className="mx-auto w-full max-w-[1200px] space-y-5 px-4 py-5 sm:space-y-6 sm:p-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <h1 className="text-balance text-2xl font-bold tracking-tight sm:text-3xl">{t("title")}</h1>
          <p className="text-sm text-muted-foreground sm:text-base">{t("subtitle")}</p>
        </div>
        <div className="grid w-full grid-cols-1 gap-2 sm:w-auto sm:grid-cols-2">
          <Button asChild className="w-full sm:w-auto">
            <Link href="/projects/new">
              <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
              Setup Wizard
            </Link>
          </Button>
          <Button variant="outline" className="w-full sm:w-auto" onClick={() => setDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
            {t("createProject")}
          </Button>
        </div>
      </div>

      {/* Filters */}
      <ProjectsFilterBar
        search={search}
        onSearchChange={setSearch}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
      />

      {/* Projects Grid */}
      <ProjectsGrid
        projects={projects}
        isLoading={isLoading}
        onCreateClick={() => setDialogOpen(true)}
        onProjectHover={prefetchProject}
        onProjectHoverEnd={cancelPrefetch}
      />

      <CreateProjectDialog
        open={dialogOpen}
        onOpenChange={handleDialogChange}
        form={form}
        onSubmit={onSubmit}
        isPending={isPending}
        colorOptions={colorOptions}
        addTech={addTech}
        removeTech={removeTech}
        githubInstallations={githubInstallations}
        hasGithubApp={hasGithubApp}
      />
    </div>
  );
};
