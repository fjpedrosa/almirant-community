"use client";

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { skillsApi } from "@/lib/api/client";
import { useOrgScopedKey } from "@/lib/query-keys";
import type { Skill, SkillSelectorItem } from "../../domain/types";

export const skillKeys = {
  all: ["skills"] as const,
  lists: () => [...skillKeys.all, "list"] as const,
  list: (filters: string) => [...skillKeys.lists(), filters] as const,
  details: () => [...skillKeys.all, "detail"] as const,
  detail: (id: string) => [...skillKeys.details(), id] as const,
  selector: (projectId?: string) =>
    [...skillKeys.all, "selector", projectId ?? "all"] as const,
};

export const useSkills = (params?: URLSearchParams) => {
  const scopedKey = useOrgScopedKey(skillKeys.list(params?.toString() ?? ""));
  return useQuery({
    queryKey: scopedKey,
    queryFn: () => skillsApi.list(params) as Promise<Skill[]>,
    placeholderData: keepPreviousData,
  });
};

export const useSkill = (id: string | null) => {
  const scopedKey = useOrgScopedKey(skillKeys.detail(id ?? ""));
  return useQuery({
    queryKey: scopedKey,
    queryFn: () => skillsApi.get(id!) as Promise<Skill>,
    enabled: !!id,
  });
};

export const useSkillsForSelector = (projectId?: string) => {
  const scopedKey = useOrgScopedKey(skillKeys.selector(projectId));
  return useQuery({
    queryKey: scopedKey,
    queryFn: () => skillsApi.selector(projectId) as Promise<SkillSelectorItem[]>,
  });
};
