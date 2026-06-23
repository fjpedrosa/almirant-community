"use client";

import { useEnqueueAgentJob } from "@/domains/agents/application/hooks/use-enqueue-agent-job";
import type { WorkItem, WalkthroughViewport, WalkthroughStatus, WalkthroughScript, WalkthroughRecording } from "../../domain/types";

export const useWalkthroughActions = (workItem: WorkItem) => {
  const enqueueJob = useEnqueueAgentJob();

  const walkthrough = workItem.metadata?.walkthrough;
  const walkthroughStatus: WalkthroughStatus | undefined = walkthrough?.status;
  const currentScript: WalkthroughScript | undefined = walkthrough?.currentScript;
  const recordings: WalkthroughRecording[] = walkthrough?.recordings ?? [];

  const canStart =
    walkthroughStatus === undefined ||
    walkthroughStatus === "completed" ||
    walkthroughStatus === "failed";

  const startWalkthrough = (viewport: WalkthroughViewport) => {
    enqueueJob.mutate({
      workItemId: workItem.id,
      provider: "claude-code",
      jobType: "recording",
      skillName: "record-video",
      // Pass viewport as part of the job data for the recording skill
      ...({ viewport } as Record<string, unknown>),
    });
  };

  return {
    startWalkthrough,
    isStarting: enqueueJob.isPending,
    walkthroughStatus,
    currentScript,
    recordings,
    canStart,
  };
};
