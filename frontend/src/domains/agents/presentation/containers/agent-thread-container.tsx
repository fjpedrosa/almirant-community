"use client";

import { useRef, useEffect, useCallback } from "react";
import { useWorkerInteractions } from "../../application/hooks/use-worker-interactions";
import { useRespondInteraction } from "../../application/hooks/use-respond-interaction";
import { useAgentJobStatus } from "../../application/hooks/use-agent-jobs";
import { AgentThread } from "../components/agent-thread";

interface AgentThreadContainerProps {
  workItemId: string;
}

export const AgentThreadContainer: React.FC<AgentThreadContainerProps> = ({
  workItemId,
}) => {
  const { data: interactions, isLoading } = useWorkerInteractions(workItemId);
  const activeJob = useAgentJobStatus(workItemId);
  const jobId = activeJob.data?.id ?? "";

  const respondMutation = useRespondInteraction({ jobId, workItemId });

  // Auto-scroll to bottom when new interactions arrive
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [interactions]);

  const handleRespond = useCallback(
    (interactionId: string, answer: string) => {
      if (!jobId) return;
      respondMutation.mutate({
        jobId,
        interactionId,
        data: { answerText: answer },
      });
    },
    [jobId, respondMutation]
  );

  // Don't render if no interactions and no active job
  const hasContent =
    (interactions && interactions.length > 0) || activeJob.data;
  if (!hasContent && !isLoading) return null;

  return (
    <div ref={scrollRef} className="max-h-[300px] overflow-y-auto">
      <AgentThread
        interactions={interactions ?? []}
        onRespond={handleRespond}
        isResponding={respondMutation.isPending}
      />
    </div>
  );
};
