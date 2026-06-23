"use client";

import { useState, useCallback, useMemo } from "react";
import { useSkills } from "./use-skills";
import {
  useCreateSkill,
  useUpdateSkill,
  useDeleteSkill,
} from "./use-skill-mutations";
import { useDetailPanelUrl } from "@/domains/shared/application/hooks/use-detail-panel-url";
import type {
  Skill,
  CreateSkillRequest,
  UpdateSkillRequest,
} from "../../domain/types";

export const useSkillsPage = () => {
  // UI state
  const [isCreateDrawerOpen, setIsCreateDrawerOpen] = useState(false);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);
  const [deletingSkill, setDeletingSkill] = useState<Skill | null>(null);

  // URL-synced detail panel
  const {
    selectedItemId: selectedSkillId,
    isOpen: isDetailOpen,
    open: openDetailById,
    onOpenChange: handleDetailOpenChange,
  } = useDetailPanelUrl("skillId");

  // Data queries
  const { data: skills = [], isLoading } = useSkills();

  // Derive the full skill object from the URL-selected ID
  const detailSkill = useMemo(
    () => (selectedSkillId ? skills.find((s) => s.id === selectedSkillId) ?? null : null),
    [selectedSkillId, skills],
  );

  // Mutations
  const createMutation = useCreateSkill();
  const updateMutation = useUpdateSkill();
  const deleteMutation = useDeleteSkill();

  // Handlers
  const handleOpenCreate = useCallback(() => {
    setIsCreateDrawerOpen(true);
  }, []);

  const handleCreateDrawerOpenChange = useCallback((open: boolean) => {
    setIsCreateDrawerOpen(open);
  }, []);

  const handleSkillCreated = useCallback((_skillId: string) => {
    setIsCreateDrawerOpen(false);
  }, []);

  const handleEdit = useCallback((skill: Skill) => {
    setEditingSkill(skill);
    setIsFormOpen(true);
  }, []);

  const handleDelete = useCallback((skill: Skill) => {
    setDeletingSkill(skill);
  }, []);

  const handleViewDetail = useCallback(
    (skill: Skill) => {
      openDetailById(skill.id);
    },
    [openDetailById],
  );

  const handleConfirmDelete = useCallback(() => {
    if (deletingSkill) {
      deleteMutation.mutate(deletingSkill.id, {
        onSuccess: () => setDeletingSkill(null),
      });
    }
  }, [deletingSkill, deleteMutation]);

  const handleCancelDelete = useCallback(() => {
    setDeletingSkill(null);
  }, []);

  const handleFormSubmit = useCallback(
    (data: CreateSkillRequest | UpdateSkillRequest) => {
      if (editingSkill) {
        updateMutation.mutate(
          { id: editingSkill.id, data: data as UpdateSkillRequest },
          {
            onSuccess: () => {
              setIsFormOpen(false);
              setEditingSkill(null);
            },
          }
        );
      } else {
        createMutation.mutate(data as CreateSkillRequest, {
          onSuccess: () => {
            setIsFormOpen(false);
          },
        });
      }
    },
    [editingSkill, createMutation, updateMutation]
  );

  const handleFormOpenChange = useCallback((open: boolean) => {
    setIsFormOpen(open);
    if (!open) {
      setEditingSkill(null);
    }
  }, []);

  const isFormPending = createMutation.isPending || updateMutation.isPending;
  const isDeletePending = deleteMutation.isPending;

  return {
    // Data
    skills,
    isLoading,

    // Create drawer state
    isCreateDrawerOpen,
    handleOpenCreate,
    handleCreateDrawerOpenChange,
    handleSkillCreated,

    // Edit form dialog state
    isFormOpen,
    editingSkill,
    isFormPending,
    handleEdit,
    handleFormSubmit,
    handleFormOpenChange,

    // Delete confirmation state
    deletingSkill,
    isDeletePending,
    handleDelete,
    handleConfirmDelete,
    handleCancelDelete,

    // Detail panel state
    detailSkill,
    isDetailOpen,
    handleViewDetail,
    handleDetailOpenChange,
  };
};
