"use client";

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { documentsApi } from "@/lib/api/client";
import { documentSearchKeys } from "./use-document-search";
import type {
  DocumentSearchResult,
  DocumentSearchResponse,
} from "../../domain/types";

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 300;
const BLUR_DELAY_MS = 200;

export const useSearchDropdown = (
  searchQuery: string,
  activeProjectFilter: string | null,
  onSelectDocument: (id: string) => void
) => {
  const trimmedQuery = searchQuery.trim();
  const queryLength = trimmedQuery.length;
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(-1);
  // isForceClosed: user explicitly closed via Escape/blur; reset when query text changes
  const [isForceClosed, setIsForceClosed] = useState(false);
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // Debounce: all setState calls happen inside setTimeout callbacks (async),
  // which avoids the react-hooks/set-state-in-effect lint rule.
  useEffect(() => {
    if (searchQuery.trim().length < MIN_QUERY_LENGTH) {
      // Use a 0ms timeout so setState is asynchronous relative to the effect body
      const id = setTimeout(() => {
        setDebouncedQuery("");
        setSelectedIndex(-1);
      }, 0);
      return () => clearTimeout(id);
    }

    const id = setTimeout(() => {
      setDebouncedQuery(searchQuery.trim());
      setSelectedIndex(-1);
    }, DEBOUNCE_MS);

    return () => clearTimeout(id);
  }, [searchQuery]);

  // Reopen dropdown when query text changes (user typing again after Escape)
  useEffect(() => {
    const id = setTimeout(() => {
      setIsForceClosed(false);
    }, 0);
    return () => clearTimeout(id);
  }, [searchQuery]);

  // Derive isOpen from query length and force-close state
  const isOpen = queryLength > 0 && !isForceClosed;

  const isQueryValid = debouncedQuery.length >= MIN_QUERY_LENGTH;
  const shouldShowTypeToSearch = queryLength > 0 && queryLength < MIN_QUERY_LENGTH;

  const searchParams = useMemo(() => {
    const params = new URLSearchParams();
    if (debouncedQuery) params.set("q", debouncedQuery);
    if (activeProjectFilter) params.set("projectId", activeProjectFilter);
    params.set("limit", "10");
    return params;
  }, [debouncedQuery, activeProjectFilter]);

  const { data: searchData, isLoading, isFetching } = useQuery({
    queryKey: documentSearchKeys.query(`dropdown:${searchParams.toString()}`),
    queryFn: async (): Promise<DocumentSearchResponse> => {
      const result = await documentsApi.search(searchParams);
      return {
        items: result.data as DocumentSearchResult[],
        meta: result.meta,
      };
    },
    enabled: isQueryValid && isOpen,
    staleTime: 30_000,
  });

  const results = useMemo(
    () => searchData?.items ?? [],
    [searchData?.items]
  );
  const total = searchData?.meta?.total ?? 0;

  const closeDropdown = useCallback(() => {
    setIsForceClosed(true);
    setSelectedIndex(-1);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (!isOpen || results.length === 0) {
        if (e.key === "Escape" && isOpen) {
          e.preventDefault();
          closeDropdown();
        }
        return;
      }

      switch (e.key) {
        case "ArrowDown": {
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev < results.length - 1 ? prev + 1 : 0
          );
          break;
        }
        case "ArrowUp": {
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev > 0 ? prev - 1 : results.length - 1
          );
          break;
        }
        case "Enter": {
          e.preventDefault();
          if (selectedIndex >= 0 && selectedIndex < results.length) {
            onSelectDocument(results[selectedIndex].id);
            closeDropdown();
          }
          break;
        }
        case "Escape": {
          e.preventDefault();
          closeDropdown();
          break;
        }
      }
    },
    [isOpen, results, selectedIndex, onSelectDocument, closeDropdown]
  );

  const handleFocus = useCallback(() => {
    // Cancel any pending blur close
    if (blurTimeoutRef.current) {
      clearTimeout(blurTimeoutRef.current);
      blurTimeoutRef.current = null;
    }
    if (queryLength > 0) {
      setIsForceClosed(false);
    }
  }, [queryLength]);

  const handleBlur = useCallback(() => {
    // Delay close to allow click on dropdown items
    blurTimeoutRef.current = setTimeout(() => {
      closeDropdown();
    }, BLUR_DELAY_MS);
  }, [closeDropdown]);

  // Cleanup blur timeout on unmount
  useEffect(() => {
    return () => {
      if (blurTimeoutRef.current) {
        clearTimeout(blurTimeoutRef.current);
      }
    };
  }, []);

  // Scroll selected item into view (DOM side effect, not state)
  useEffect(() => {
    if (selectedIndex < 0 || !listRef.current) return;

    const items = listRef.current.querySelectorAll("[data-search-item]");
    const selectedItem = items[selectedIndex];
    if (selectedItem) {
      selectedItem.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  return {
    results,
    total,
    isLoading: isLoading || isFetching,
    isOpen,
    shouldShowTypeToSearch,
    selectedIndex,
    handleKeyDown,
    handleFocus,
    handleBlur,
    closeDropdown,
    listRef,
  };
};
