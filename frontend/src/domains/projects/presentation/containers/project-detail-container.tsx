"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Link from "next/link";
import { useProjectDetail } from "../../application/hooks/use-project-detail";
import { useEditProjectForm } from "../../application/hooks/use-edit-project-form";
import { colorOptions } from "../../application/hooks/use-projects-page";
import { ProjectDetailHeader } from "../components/project-detail-header";
import { ProjectScreenshotCard } from "../components/project-screenshot-card";
import { ProjectStatsGrid } from "../components/project-stats-grid";
import { ProjectOverviewTab } from "../components/project-overview-tab";
import { ProjectReposTab } from "../components/project-repos-tab";
import { ProjectNotesTab } from "../components/project-notes-tab";
import { EditProjectDialog } from "../components/edit-project-dialog";
import { ProjectSprintsContainer } from "./project-sprints-container";
import { ProjectSettingsContainer } from "./project-settings-container";
import { Eye, GitBranch, Zap, StickyNote, Settings } from "lucide-react";
import { useCurrentUserTeams } from "@/domains/teams/application/hooks/use-current-user-teams";

interface ProjectDetailContainerProps {
  projectId: string;
}

export const ProjectDetailContainer: React.FC<ProjectDetailContainerProps> = ({
  projectId,
}) => {
  const {
    project,
    isLoading,
    repositories,
    notes,
    selectedNote,
    selectedNoteId,
    noteContent,
    newRepoName,
    newRepoUrl,
    newRepoProvider,
    newRepoIsMonorepo,
    newNoteTitle,
    editDialogOpen,
    screenshot,
    setNewRepoName,
    setNewRepoUrl,
    setNewRepoProvider,
    setNewRepoIsMonorepo,
    setNewNoteTitle,
    setNoteContent,
    handleAddRepo,
    handleDeleteRepo,
    handleAddNote,
    handleSelectNote,
    handleSaveNote,
    handleDeleteNote,
    handleBack,
    handleOpenEdit,
    handleCloseEdit,
    handleEditDialogChange,
    isAddingRepo,
    isCreatingNote,
    isSavingNote,
    githubRepos,
    isLoadingGithubRepos,
    githubRepoSearchQuery,
    setGithubRepoSearchQuery,
    handleGithubRepoSelect,
    isGithubConnected,
  } = useProjectDetail(projectId);

  const t = useTranslations("projects");
  const { teams, isLoading: isLoadingWorkspaces } = useCurrentUserTeams();

  const editForm = useEditProjectForm(project, handleCloseEdit);

  const transferConfirmation =
    editForm.pendingTransferOrgId && project
      ? {
          projectName: project.name,
          fromWorkspaceName: project.workspaceName ?? "workspace actual",
          toWorkspaceName:
            teams.find((t) => t.id === editForm.pendingTransferOrgId)?.name ??
            editForm.pendingTransferOrgId ??
            "",
        }
      : null;

  if (isLoading) {
    return (
      <div className="mx-auto w-full max-w-[1200px] space-y-5 px-4 py-5 sm:space-y-6 sm:p-6">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  // Archived projects are intentionally accessible via direct URL (/projects/[id]).
  // The backend getProjectById does not filter by status, so archived projects
  // remain viewable. This is the desired behavior: users can still review an
  // archived project's details, boards, and history. The ProjectDetailHeader
  // renders an archived banner to clearly communicate the project's status.
  if (!project) {
    return (
      <div className="mx-auto w-full max-w-[1200px] px-4 py-5 text-center sm:p-6">
        <p className="text-muted-foreground">{t("notFound")}</p>
        <Link href="/projects">
          <Button variant="outline" className="mt-4">{t("backToProjects")}</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1200px] space-y-5 px-4 py-5 sm:space-y-6 sm:p-6">
      <ProjectDetailHeader
        name={project.name}
        color={project.color}
        description={project.description}
        status={project.status}
        githubRepoUrl={repositories.find((r) => r.provider === "github")?.url ?? null}
        onBack={handleBack}
        onEdit={handleOpenEdit}
      />

      <ProjectScreenshotCard
        name={project.name}
        color={project.color}
        productionUrl={project.productionUrl}
        status={project.status}
        screenshotUrl={screenshot.screenshotUrl}
        hostname={screenshot.hostname}
        imageError={screenshot.imageError}
        hasUrl={screenshot.hasUrl}
        githubRepoUrl={repositories.find((r) => r.provider === "github")?.url ?? null}
        githubRepoName={repositories.find((r) => r.provider === "github")?.name ?? null}
        onImageError={screenshot.handleImageError}
        onVisitSite={screenshot.handleVisitSite}
        onRefreshScreenshot={screenshot.handleRefreshScreenshot}
        isRefreshing={screenshot.isRefreshing}
      />

      <EditProjectDialog
        open={editDialogOpen}
        onOpenChange={handleEditDialogChange}
        form={editForm.form}
        onSubmit={editForm.onSubmit}
        isPending={editForm.isPending}
        colorOptions={colorOptions}
        workspaceOptions={teams}
        isLoadingWorkspaces={isLoadingWorkspaces}
        addTech={editForm.addTech}
        removeTech={editForm.removeTech}
        transferConfirmation={transferConfirmation}
        onConfirmTransfer={editForm.onConfirmTransfer}
        onCancelTransfer={editForm.onCancelTransfer}
      />

      <ProjectStatsGrid
        workItemsCount={project.workItemsCount}
        completedItemsCount={project.completedItemsCount}
        epicCount={project.epicCount}
        featureCount={project.featureCount}
        storyCount={project.storyCount}
        taskCount={project.taskCount}
        completedEpicCount={project.completedEpicCount}
        completedFeatureCount={project.completedFeatureCount}
        completedStoryCount={project.completedStoryCount}
        completedTaskCount={project.completedTaskCount}
      />

      <Tabs defaultValue="overview">
        <div className="-mx-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
          <TabsList className="w-max min-w-full justify-start sm:min-w-0">
          <TabsTrigger value="overview" className="flex items-center gap-1.5">
            <Eye className="h-4 w-4" />
            {t("tabs.overview")}
          </TabsTrigger>
          <TabsTrigger value="repos" className="flex items-center gap-1.5">
            <GitBranch className="h-4 w-4" />
            {t("tabs.repos")}
          </TabsTrigger>
          <TabsTrigger value="sprints" className="flex items-center gap-1.5">
            <Zap className="h-4 w-4" />
            {t("tabs.sprints")}
          </TabsTrigger>
          <TabsTrigger value="notes" className="flex items-center gap-1.5">
            <StickyNote className="h-4 w-4" />
            {t("tabs.notes")}
          </TabsTrigger>
          <TabsTrigger value="settings" className="flex items-center gap-1.5">
            <Settings className="h-4 w-4" />
            Settings
          </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="overview" className="space-y-4">
          <ProjectOverviewTab
            description={project.description}
            clientName={project.clientName}
            productionUrl={project.productionUrl}
            stagingUrl={project.stagingUrl}
            techStack={project.techStack}
            folderPath={project.folderPath}
            startDate={project.startDate}
            targetDate={project.targetDate}
            status={project.status}
          />
        </TabsContent>

        <TabsContent value="repos" className="space-y-4">
          <ProjectReposTab
            repositories={repositories}
            newRepoName={newRepoName}
            newRepoUrl={newRepoUrl}
            newRepoProvider={newRepoProvider}
            newRepoIsMonorepo={newRepoIsMonorepo}
            onNameChange={setNewRepoName}
            onUrlChange={setNewRepoUrl}
            onProviderChange={setNewRepoProvider}
            onMonorepoChange={setNewRepoIsMonorepo}
            onAddRepo={handleAddRepo}
            onDeleteRepo={handleDeleteRepo}
            isAdding={isAddingRepo}
            githubRepos={githubRepos}
            isLoadingGithubRepos={isLoadingGithubRepos}
            githubRepoSearchQuery={githubRepoSearchQuery}
            onGithubRepoSearchChange={setGithubRepoSearchQuery}
            onGithubRepoSelect={handleGithubRepoSelect}
            isGithubConnected={isGithubConnected}
          />
        </TabsContent>

        <TabsContent value="sprints" className="space-y-4">
          <ProjectSprintsContainer projectId={projectId} />
        </TabsContent>

        <TabsContent value="notes" className="space-y-4">
          <ProjectNotesTab
            notes={notes}
            selectedNoteId={selectedNoteId}
            noteContent={noteContent}
            newNoteTitle={newNoteTitle}
            selectedNote={selectedNote}
            onSelectNote={handleSelectNote}
            onNoteContentChange={setNoteContent}
            onNewNoteTitleChange={setNewNoteTitle}
            onAddNote={handleAddNote}
            onSaveNote={handleSaveNote}
            onDeleteNote={handleDeleteNote}
            isCreating={isCreatingNote}
            isSaving={isSavingNote}
          />
        </TabsContent>

        <TabsContent value="settings" className="mt-4">
          <ProjectSettingsContainer projectId={projectId} projectName={project.name} />
        </TabsContent>
      </Tabs>
    </div>
  );
};
