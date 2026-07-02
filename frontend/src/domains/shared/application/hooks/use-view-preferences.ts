"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { viewPreferencesApi } from "@/lib/api/client";
import { useActiveTeam } from "@/domains/teams/application/hooks/use-active-team";

const DEBOUNCE_MS = 500;

const viewPreferenceKeys = {
  byPage: (pageKey: string, workspaceId?: string | null) =>
    ["viewPreferences", pageKey, `org:${workspaceId ?? "none"}`] as const,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const useViewPreferences = <T extends Record<string, any>>(
  pageKey: string,
  defaults: T
) => {
  const { confirmedActiveTeamId } = useActiveTeam();
  const queryClient = useQueryClient();
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track local overrides that haven't been persisted to the query cache yet
  const localOverridesRef = useRef<Partial<T>>({});

  // Fetch preferences from backend
  const { data, isFetched, isError } = useQuery({
    queryKey: viewPreferenceKeys.byPage(pageKey, confirmedActiveTeamId),
    queryFn: () => viewPreferencesApi.get(pageKey),
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: 1,
    enabled: !!confirmedActiveTeamId,
  });

  // Derive preferences: defaults < fetched data < local overrides
  const preferences = useMemo<T>(() => {
    const fetched = (isFetched && data && !isError ? data : {}) as Partial<T>;
    return { ...defaults, ...fetched, ...localOverridesRef.current };
  }, [defaults, data, isFetched, isError]);

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: (config: Record<string, unknown>) =>
      viewPreferencesApi.save(pageKey, config),
    onSuccess: (_result, variables) => {
      // Update query cache with the saved config
      queryClient.setQueryData(
        viewPreferenceKeys.byPage(pageKey, confirmedActiveTeamId),
        variables
      );
      // Clear local overrides since they're now in the cache
      localOverridesRef.current = {};
    },
  });

  // Debounced save to backend
  const debouncedSave = useCallback(
    (nextPreferences: T) => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(() => {
        saveMutation.mutate(nextPreferences);
        debounceTimerRef.current = null;
      }, DEBOUNCE_MS);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pageKey]
  );

  // Update a single preference key
  const updatePreference = useCallback(
    <K extends keyof T>(key: K, value: T[K]) => {
      // Apply local override immediately
      localOverridesRef.current = { ...localOverridesRef.current, [key]: value };

      // Build the full next preferences for saving
      const fetched = (data ?? {}) as Partial<T>;
      const next = { ...defaults, ...fetched, ...localOverridesRef.current } as T;

      // Optimistically update the query cache for immediate UI reflection
      queryClient.setQueryData(
        viewPreferenceKeys.byPage(pageKey, confirmedActiveTeamId),
        next
      );

      // Debounce the save to backend
      debouncedSave(next);
    },
    [data, defaults, pageKey, queryClient, debouncedSave, confirmedActiveTeamId]
  );

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  // isLoaded is true when the initial query has resolved
  const isLoaded = isFetched || isError;

  return {
    preferences,
    isLoaded,
    updatePreference,
  };
};
