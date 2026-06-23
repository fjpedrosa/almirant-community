"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useProjects } from "@/domains/projects/application/hooks/use-projects";
import type { MilestoneWithProgress } from "../../domain/types";
import { useMilestone, useMilestones } from "./use-milestones";

export const useGoalsPage = () => {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryProjectId = searchParams.get("projectId");

  const { data: projects = [], isLoading: isLoadingProjects } = useProjects();
  const selectedProjectId = queryProjectId ?? projects[0]?.id ?? null;

  useEffect(() => {
    if (!projects[0]?.id) return;

    const hasValidProjectInQuery = queryProjectId
      ? projects.some((project) => project.id === queryProjectId)
      : false;

    if (hasValidProjectInQuery) return;

    const params = new URLSearchParams(searchParams.toString());
    params.set("projectId", projects[0].id);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [pathname, projects, queryProjectId, router, searchParams]);

  const handleProjectChange = useCallback(
    (projectId: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("projectId", projectId);
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  const {
    data: milestones = [],
    isLoading: isLoadingMilestones,
  } = useMilestones(selectedProjectId);

  const [userSelectedMilestoneId, setUserSelectedMilestoneId] = useState<string | null>(null);
  const selectedMilestoneId = useMemo(() => {
    if (milestones.length === 0) return null;

    const exists = milestones.some(
      (milestone) => milestone.id === userSelectedMilestoneId
    );

    if (exists) {
      return userSelectedMilestoneId;
    }

    return milestones[0].id;
  }, [milestones, userSelectedMilestoneId]);

  const detailQuery = useMilestone(selectedMilestoneId);
  const selectedMilestone = useMemo(() => {
    if (!selectedMilestoneId) return null;

    const fallback = milestones.find((milestone) => milestone.id === selectedMilestoneId) ?? null;
    return (detailQuery.data as MilestoneWithProgress | undefined) ?? fallback;
  }, [detailQuery.data, milestones, selectedMilestoneId]);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingMilestone, setEditingMilestone] = useState<MilestoneWithProgress | null>(null);

  const handleOpenCreateMilestone = useCallback(() => {
    setEditingMilestone(null);
    setIsFormOpen(true);
  }, []);

  const handleOpenEditMilestone = useCallback((milestone: MilestoneWithProgress) => {
    setEditingMilestone(milestone);
    setIsFormOpen(true);
  }, []);

  const handleCloseForm = useCallback(() => {
    setIsFormOpen(false);
    setEditingMilestone(null);
  }, []);

  return {
    projects: projects.map((project) => ({
      id: project.id,
      name: project.name,
      color: project.color,
    })),
    selectedProjectId,
    milestones,
    selectedMilestoneId,
    selectedMilestone,
    isLoadingProjects,
    isLoadingMilestones,
    isLoadingMilestoneDetail: detailQuery.isLoading,
    isFormOpen,
    editingMilestone,
    setSelectedMilestoneId: setUserSelectedMilestoneId,
    handleProjectChange,
    handleOpenCreateMilestone,
    handleOpenEditMilestone,
    handleCloseForm,
  };
};
