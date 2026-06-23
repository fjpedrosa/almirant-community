"use client";

import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SeedWithRelations } from "@/domains/planning/domain/types";

export const useSeedEnrichment = () => {
  const [detailSeed, setDetailSeed] = useState<SeedWithRelations | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);

  const openDetail = useCallback((seed: SeedWithRelations) => {
    setDetailSeed(seed);
    setIsDetailOpen(true);
  }, []);

  const closeDetail = useCallback(() => {
    setIsDetailOpen(false);
    setTimeout(() => setDetailSeed(null), 300);
  }, []);

  // Lazy-load comments only when detail is open
  const { data: comments = [], isLoading: isLoadingComments } = useQuery({
    queryKey: ["seed-comments", detailSeed?.id],
    queryFn: async () => {
      if (!detailSeed?.id) return [];
      const { seedsApi } = await import(
        "@/domains/planning/infrastructure/api/planning-api"
      );
      return seedsApi.listComments(detailSeed.id);
    },
    enabled: isDetailOpen && !!detailSeed?.id,
    staleTime: 30_000,
  });

  return {
    detailSeed,
    isDetailOpen,
    openDetail,
    closeDetail,
    comments,
    isLoadingComments,
  };
};
