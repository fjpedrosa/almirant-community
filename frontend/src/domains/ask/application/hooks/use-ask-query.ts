"use client";

import { useState, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { askApi } from "@/lib/api/client";
import type {
  AskRequest,
  AskResponse,
  AskHistoryItem,
  AskQueryState,
  AskFilters,
} from "../../domain/types";

// ---------------------------------------------------------------------------
// Query Keys
// ---------------------------------------------------------------------------

export const askKeys = {
  all: ["ask"] as const,
  history: () => [...askKeys.all, "history"] as const,
} as const;

// ---------------------------------------------------------------------------
// Hook: useAskQuery
// ---------------------------------------------------------------------------
// Manages the Ask feature state: submitting questions, tracking conversation
// history, and handling follow-up sessions.
// ---------------------------------------------------------------------------

export interface UseAskQueryOptions {
  filters: AskFilters;
}

export interface UseAskQueryReturn {
  state: AskQueryState;
  history: AskHistoryItem[];
  currentResponse: AskResponse | null;
  submitQuestion: (question: string) => void;
  clearHistory: () => void;
  isLoading: boolean;
  error: Error | null;
}

export const useAskQuery = (options: UseAskQueryOptions): UseAskQueryReturn => {
  const { filters } = options;

  const [state, setState] = useState<AskQueryState>("idle");
  const [history, setHistory] = useState<AskHistoryItem[]>([]);
  const [currentResponse, setCurrentResponse] = useState<AskResponse | null>(
    null
  );
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const mutation = useMutation({
    mutationFn: (request: AskRequest) => askApi.query(request),
    onMutate: () => {
      setState("loading");
      setError(null);
    },
    onSuccess: (response) => {
      const newState: AskQueryState = response.isAbstention
        ? "abstained"
        : "success";
      setState(newState);
      setCurrentResponse(response);
      setSessionId(response.sessionId);

      // Add to history
      setHistory((prev) => {
        const lastItem = prev[prev.length - 1];
        if (lastItem && lastItem.state === "loading") {
          // Update the last item with the response
          return prev.map((item, idx) =>
            idx === prev.length - 1
              ? { ...item, response, state: newState }
              : item
          );
        }
        return prev;
      });
    },
    onError: (err) => {
      setState("error");
      setError(err instanceof Error ? err : new Error(String(err)));

      // Update last history item with error state
      setHistory((prev) => {
        const lastItem = prev[prev.length - 1];
        if (lastItem && lastItem.state === "loading") {
          return prev.map((item, idx) =>
            idx === prev.length - 1
              ? {
                  ...item,
                  state: "error" as const,
                  errorMessage:
                    err instanceof Error ? err.message : "An error occurred",
                }
              : item
          );
        }
        return prev;
      });
    },
  });

  const submitQuestion = useCallback(
    (question: string) => {
      if (!filters.projectId || mutation.isPending) return;

      // Create history item before mutation
      const historyItem: AskHistoryItem = {
        id: crypto.randomUUID(),
        question,
        response: null,
        state: "loading",
        createdAt: new Date().toISOString(),
      };

      setHistory((prev) => [...prev, historyItem]);

      const request: AskRequest = {
        question,
        projectId: filters.projectId,
        featureId: filters.featureId,
        timeRange: filters.timeRange,
        followUpSessionId: sessionId ?? undefined,
      };

      mutation.mutate(request);
    },
    [filters, sessionId, mutation]
  );

  const clearHistory = useCallback(() => {
    setHistory([]);
    setCurrentResponse(null);
    setSessionId(null);
    setState("idle");
    setError(null);
  }, []);

  return {
    state,
    history,
    currentResponse,
    submitQuestion,
    clearHistory,
    isLoading: mutation.isPending,
    error,
  };
};
