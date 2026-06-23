"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { documentsApi } from "@/lib/api/client";
import { useOrgScopedKey } from "@/lib/query-keys";
import { documentKeys } from "./use-documents";
import type { FavoriteDocument } from "../../domain/types";

export const favoriteKeys = {
  all: [...documentKeys.all, "favorites"] as const,
  ids: () => [...favoriteKeys.all, "ids"] as const,
  list: () => [...favoriteKeys.all, "list"] as const,
};

/**
 * Fetches the set of document IDs that the current user has favorited.
 */
export const useFavoriteDocumentIds = () => {
  const scopedKey = useOrgScopedKey(favoriteKeys.ids());
  return useQuery({
    queryKey: scopedKey,
    queryFn: async (): Promise<Set<string>> => {
      const data = await documentsApi.getFavorites();
      // The API returns an array of favorite objects; extract document IDs
      const ids = (data as Array<{ documentId?: string; id?: string }>).map(
        (item) => item.documentId ?? item.id ?? ""
      );
      return new Set(ids.filter(Boolean));
    },
    staleTime: 30_000,
  });
};

/**
 * Fetches the full list of favorite documents with metadata (title, project, category, etc.).
 * Used to render the Favorites section in the sidebar.
 */
export const useFavoriteDocuments = () => {
  const scopedKey = useOrgScopedKey(favoriteKeys.list());
  return useQuery({
    queryKey: scopedKey,
    queryFn: async (): Promise<FavoriteDocument[]> => {
      const data = await documentsApi.getFavorites();
      return data as FavoriteDocument[];
    },
    staleTime: 30_000,
  });
};

/**
 * Mutation to toggle a document's favorite status.
 * Uses optimistic updates on the favorite IDs set for instant UI feedback.
 */
export const useToggleFavorite = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (documentId: string) => documentsApi.toggleFavorite(documentId),

    onMutate: async (documentId: string) => {
      // Cancel outgoing refetches so they don't overwrite optimistic update
      await queryClient.cancelQueries({ queryKey: favoriteKeys.ids() });

      // Snapshot previous value
      const previousIds = queryClient.getQueryData<Set<string>>(favoriteKeys.ids());

      // Optimistically toggle the ID in the set
      queryClient.setQueryData<Set<string>>(favoriteKeys.ids(), (old) => {
        const next = new Set(old);
        if (next.has(documentId)) {
          next.delete(documentId);
        } else {
          next.add(documentId);
        }
        return next;
      });

      return { previousIds };
    },

    onError: (_err, _documentId, context) => {
      // Roll back to the previous value on error
      if (context?.previousIds) {
        queryClient.setQueryData(favoriteKeys.ids(), context.previousIds);
      }
    },

    onSettled: () => {
      // Always refetch after mutation to ensure server state consistency
      queryClient.invalidateQueries({ queryKey: favoriteKeys.ids() });
      queryClient.invalidateQueries({ queryKey: favoriteKeys.list() });
    },
  });
};

/**
 * Convenience hook that returns a stable callback for toggling favorites.
 */
export const useToggleFavoriteHandler = () => {
  const toggleFavorite = useToggleFavorite();

  const handleToggleFavorite = useCallback(
    (documentId: string) => {
      toggleFavorite.mutate(documentId);
    },
    [toggleFavorite]
  );

  return handleToggleFavorite;
};
