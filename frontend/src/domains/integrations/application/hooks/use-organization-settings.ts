"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { organizationSettingsApi } from "@/lib/api/client";
import type {
  OrganizationSettings,
  UpdateOrganizationSettingsInput,
} from "../../domain/types";

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const orgSettingsKeys = {
  all: ["organization-settings"] as const,
  detail: (orgId: string) => [...orgSettingsKeys.all, orgId] as const,
};

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Reads settings for the active organization.
 * The backend resolves the organization from the authenticated session,
 * so no explicit orgId parameter is needed for typical usage.
 */
export const useOrganizationSettings = () => {
  return useQuery({
    queryKey: orgSettingsKeys.all,
    queryFn: () =>
      organizationSettingsApi.get() as Promise<OrganizationSettings>,
  });
};

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export const useUpdateOrganizationSettings = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: UpdateOrganizationSettingsInput) =>
      organizationSettingsApi.update(data) as Promise<OrganizationSettings>,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orgSettingsKeys.all });
    },
  });
};
