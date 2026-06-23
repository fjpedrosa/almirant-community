"use client";

import { useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { useArchiveProject } from "./use-projects";

export const useProjectArchive = (projectId: string, projectName: string) => {
  const router = useRouter();
  const archiveProject = useArchiveProject();

  const [confirmationText, setConfirmationText] = useState("");

  const isConfirmationValid = useMemo(
    () => confirmationText === projectName,
    [confirmationText, projectName]
  );

  const handleArchive = useCallback(async () => {
    try {
      await archiveProject.mutateAsync(projectId);
      router.push("/projects");
      showToast.success("Proyecto archivado");
    } catch {
      showToast.error("Error al archivar el proyecto");
    }
  }, [archiveProject, projectId, router]);

  return {
    confirmationText,
    setConfirmationText,
    isConfirmationValid,
    handleArchive,
    isArchiving: archiveProject.isPending,
  };
};
