"use client";

import { Plus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useSkillsPage } from "../../application/hooks/use-skills-page";
import { SkillsList } from "../components/skills-list";
import { SkillFormDialog } from "../components/skill-form-dialog";
import { SkillDetailPanel } from "../components/skill-detail-panel";
import { SkillCreateDrawerContainer } from "./skill-create-drawer-container";

export const SkillsContainer = () => {
  const {
    skills,
    isLoading,
    isCreateDrawerOpen,
    handleOpenCreate,
    handleCreateDrawerOpenChange,
    handleSkillCreated,
    isFormOpen,
    editingSkill,
    isFormPending,
    handleEdit,
    handleFormSubmit,
    handleFormOpenChange,
    deletingSkill,
    isDeletePending,
    handleDelete,
    handleConfirmDelete,
    handleCancelDelete,
    detailSkill,
    isDetailOpen,
    handleViewDetail,
    handleDetailOpenChange,
  } = useSkillsPage();

  return (
    <div className="p-6 space-y-6 max-w-[1200px] mx-auto w-full">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Sparkles className="h-6 w-6 text-primary" />
            Skills Catalog
          </h1>
          <p className="text-muted-foreground">
            Manage skill templates that can be used by AI agents
          </p>
        </div>
        <Button onClick={handleOpenCreate}>
          <Plus className="h-4 w-4 mr-2" />
          New Skill
        </Button>
      </div>

      <SkillsList
        skills={skills}
        isLoading={isLoading}
        onEdit={handleEdit}
        onDelete={handleDelete}
        onViewDetail={handleViewDetail}
      />

      <SkillCreateDrawerContainer
        open={isCreateDrawerOpen}
        onOpenChange={handleCreateDrawerOpenChange}
        onSkillCreated={handleSkillCreated}
      />

      <SkillFormDialog
        open={isFormOpen}
        onOpenChange={handleFormOpenChange}
        skill={editingSkill}
        isPending={isFormPending}
        onSubmit={handleFormSubmit}
      />

      <SkillDetailPanel
        skill={detailSkill}
        open={isDetailOpen}
        onOpenChange={handleDetailOpenChange}
      />

      <AlertDialog
        open={!!deletingSkill}
        onOpenChange={(open) => !open && handleCancelDelete()}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Skill</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{deletingSkill?.name}&quot;?
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletePending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              disabled={isDeletePending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeletePending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
