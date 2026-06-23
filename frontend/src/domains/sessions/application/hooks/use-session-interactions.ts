"use client";

import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { agentJobsApi } from "@/lib/api/client";
import { useWsContextOptional } from "@/domains/shared/application/hooks/use-ws-context";
import { sessionKeys } from "../../domain/query-keys";
import type { WorkerInteraction } from "@/domains/agents/domain/types";

export const useSessionInteractions = (
  jobId: string | null | undefined,
  isActive: boolean,
) => {
  const queryClient = useQueryClient();
  const ws = useWsContextOptional();
  const [answerText, setAnswerText] = useState("");

  const queryKey = sessionKeys.interactions(jobId ?? "");

  const { data: interactions = [], isLoading } = useQuery({
    queryKey,
    queryFn: () => agentJobsApi.getInteractions(jobId!),
    enabled: !!jobId,
    refetchInterval: isActive ? 5_000 : false,
    staleTime: 3_000,
  });

  // Listen for WebSocket events to invalidate the interactions query
  useEffect(() => {
    if (!ws || !jobId) return;

    const unsubs: Array<() => void> = [];

    unsubs.push(
      ws.subscribe("worker-interaction:created", (msg) => {
        if (msg.type !== "worker-interaction:created") return;
        if (msg.payload.jobId === jobId) {
          queryClient.invalidateQueries({ queryKey });
        }
      }),
    );

    unsubs.push(
      ws.subscribe("worker-interaction:responded", (msg) => {
        if (msg.type !== "worker-interaction:responded") return;
        if (msg.payload.jobId === jobId) {
          queryClient.invalidateQueries({ queryKey });
        }
      }),
    );

    unsubs.push(
      ws.subscribe("worker-interaction:expired", (msg) => {
        if (msg.type !== "worker-interaction:expired") return;
        if (msg.payload.jobId === jobId) {
          queryClient.invalidateQueries({ queryKey });
        }
      }),
    );

    return () => {
      unsubs.forEach((unsub) => unsub());
    };
  }, [ws, jobId, queryClient, queryKey]);

  const respondMutation = useMutation({
    mutationFn: (params: { interactionId: string; answerText: string }) =>
      agentJobsApi.respondToInteraction(jobId!, params.interactionId, {
        answerText: params.answerText,
      }),
    onSuccess: () => {
      setAnswerText("");
      queryClient.invalidateQueries({ queryKey });
    },
  });

  const pendingInteraction: WorkerInteraction | null =
    interactions.find((i) => i.status === "pending") ?? null;

  const respond = useCallback(() => {
    if (!pendingInteraction || !answerText.trim()) return;
    respondMutation.mutate({
      interactionId: pendingInteraction.id,
      answerText: answerText.trim(),
    });
  }, [pendingInteraction, answerText, respondMutation]);

  const respondWithOption = useCallback(
    (option: string) => {
      if (!pendingInteraction) return;
      respondMutation.mutate({
        interactionId: pendingInteraction.id,
        answerText: option,
      });
    },
    [pendingInteraction, respondMutation],
  );

  return {
    pendingInteraction,
    interactions,
    answerText,
    setAnswerText,
    respond,
    respondWithOption,
    isResponding: respondMutation.isPending,
    isLoading,
  };
};
