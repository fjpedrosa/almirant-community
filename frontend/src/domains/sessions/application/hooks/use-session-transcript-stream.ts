"use client";

import { useEffect, useMemo, useState } from "react";
import { useAgentTranscript } from "@/domains/agents/application/hooks/use-agent-run-logs";
import { useWsContextOptional } from "@/domains/shared/application/hooks/use-ws-context";
import { isAgentSessionActive } from "../../domain/utils";
import type { AgentJobStatus } from "@/domains/agents/domain/types";
import {
  buildTranscriptSegments,
  mergeTranscriptChunks,
  serializeTranscriptChunks,
  type SessionTranscriptChunk,
} from "../utils/session-transcript-stream-utils";

interface UseSessionTranscriptStreamOptions {
  enabled?: boolean;
}

export const useSessionTranscriptStream = (
  jobId: string | null | undefined,
  status: AgentJobStatus | null | undefined,
  options?: UseSessionTranscriptStreamOptions,
) => {
  const isActive = isAgentSessionActive(status);
  const enabled = (options?.enabled ?? true) && !!jobId;

  // Initial REST load
  const { transcript: initialTranscript, chunks: initialChunks, isLoading } = useAgentTranscript(
    jobId,
    { enabled },
  );

  // WS live chunks — keyed by jobId so stale chunks are discarded
  const ws = useWsContextOptional();
  const [wsState, setWsState] = useState<{
    jobId: string | null | undefined;
    chunks: SessionTranscriptChunk[];
    lastSeq: number;
  }>({ jobId, chunks: [], lastSeq: -1 });

  // Reset when jobId changes (derived state pattern)
  const chunks = useMemo(
    () => (wsState.jobId === jobId ? wsState.chunks : []),
    [wsState, jobId],
  );

  useEffect(() => {
    if (!ws || !jobId || !isActive || !enabled) return;

    const unsubscribe = ws.subscribe("agent-job:log-batch", (msg) => {
      if (msg.type !== "agent-job:log-batch") return;
      const { jobId: msgJobId, chunks: incomingChunks } = msg.payload;
      if (msgJobId !== jobId) return;

      const transcriptChunks = incomingChunks
        .filter((c: { phase: string }) => c.phase === "transcript")
        .map((c: { seq: number; message: string; contentType?: "thinking" | "text" | "tool_use" }) => ({
          seq: c.seq,
          message: c.message,
          contentType: c.contentType,
        }));

      if (transcriptChunks.length > 0) {
        setWsState((prev) => {
          // If jobId changed, start fresh
          const base = prev.jobId === jobId ? prev.chunks : [];
          let lastSeq = prev.jobId === jobId ? prev.lastSeq : -1;

          const merged = [...base];
          for (const chunk of transcriptChunks) {
            if (chunk.seq > lastSeq) {
              merged.push(chunk);
              lastSeq = chunk.seq;
            }
          }
          return {
            jobId,
            chunks: merged.sort((a, b) => a.seq - b.seq),
            lastSeq,
          };
        });
      }
    });

    return unsubscribe;
  }, [ws, jobId, isActive, enabled]);

  const mergedChunks = useMemo(
    () => mergeTranscriptChunks(initialChunks, chunks),
    [initialChunks, chunks],
  );

  const transcript = useMemo(
    () => serializeTranscriptChunks(mergedChunks, initialTranscript),
    [mergedChunks, initialTranscript],
  );

  const segments = useMemo(
    () => buildTranscriptSegments(mergedChunks, initialTranscript),
    [mergedChunks, initialTranscript],
  );

  return {
    transcript,
    segments,
    isStreaming: isActive,
    isLoading,
  };
};
