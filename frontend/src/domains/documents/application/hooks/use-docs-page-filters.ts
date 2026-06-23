"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { DocsPageFilters } from "../../domain/types";

export const useDocsPageFilters = () => {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const filters = useMemo(
    (): DocsPageFilters => ({
      projectId: searchParams.get("projectId"),
      docId: searchParams.get("docId"),
      search: searchParams.get("search") ?? "",
    }),
    [searchParams]
  );

  const setFilters = useCallback(
    (newFilters: Partial<DocsPageFilters>) => {
      const params = new URLSearchParams(searchParams.toString());
      const currentProjectId = searchParams.get("projectId");

      if ("projectId" in newFilters) {
        const nextProjectId = newFilters.projectId || null;
        if (nextProjectId !== currentProjectId) {
          params.delete("docId");
        }
      }

      if ("projectId" in newFilters) {
        const projectId = newFilters.projectId;
        if (!projectId) {
          params.delete("projectId");
        } else {
          params.set("projectId", projectId);
        }
      }

      if ("docId" in newFilters) {
        const docId = newFilters.docId;
        if (!docId) {
          params.delete("docId");
        } else {
          params.set("docId", docId);
        }
      }

      if ("search" in newFilters) {
        const search = newFilters.search;
        if (!search) {
          params.delete("search");
        } else {
          params.set("search", search);
        }
      }

      const queryString = params.toString();
      router.push(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false });
    },
    [searchParams, router, pathname]
  );

  const setProjectId = useCallback(
    (projectId: string | null) => {
      setFilters({ projectId });
    },
    [setFilters]
  );

  const setDocId = useCallback(
    (docId: string | null) => {
      setFilters({ docId });
    },
    [setFilters]
  );

  const setSearch = useCallback(
    (search: string) => {
      setFilters({ search });
    },
    [setFilters]
  );

  const clearFilters = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("projectId");
    params.delete("docId");
    params.delete("search");

    const queryString = params.toString();
    router.push(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false });
  }, [searchParams, router, pathname]);

  return {
    filters,
    setFilters,
    setProjectId,
    setDocId,
    setSearch,
    clearFilters,
  };
};
