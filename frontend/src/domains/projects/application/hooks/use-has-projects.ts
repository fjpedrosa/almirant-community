"use client";

import { useProjects } from "./use-projects";

// Hook to check if the current user/organization has any projects.
// Returns { hasProjects, isLoading } for conditional rendering of onboarding CTAs.
//
// Usage:
// const { hasProjects, isLoading } = useHasProjects();
// if (!isLoading && !hasProjects) {
//   return <CreateProjectCta />;
// }

export const useHasProjects = () => {
  const { data: projects, isLoading } = useProjects();

  return {
    hasProjects: (projects?.length ?? 0) > 0,
    isLoading,
  };
};
