"use client";

import { useEffect, useRef } from "react";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import type { AgentJob, AgentJobStatus } from "../../domain/types";

type JobStateMap = Map<string, AgentJobStatus>;

/**
 * Watches the agent job map for status transitions and shows toast
 * notifications when jobs complete, fail, or get cancelled.
 *
 * Skips the first render so that existing terminal-state jobs on page
 * load do not trigger a flood of toasts.
 */
export const useAgentJobNotifications = (
  jobMap: Map<string, AgentJob>
): void => {
  const prevStatesRef = useRef<JobStateMap>(new Map());
  const isInitializedRef = useRef(false);

  useEffect(() => {
    // On the first render, seed previous states with whatever is already
    // in the map so we only react to *future* transitions.
    if (!isInitializedRef.current) {
      const initial: JobStateMap = new Map();
      for (const [, job] of jobMap) {
        initial.set(job.id, job.status);
      }
      prevStatesRef.current = initial;
      isInitializedRef.current = true;
      return;
    }

    const prevStates = prevStatesRef.current;
    const nextStates: JobStateMap = new Map();

    for (const [, job] of jobMap) {
      nextStates.set(job.id, job.status);

      const prevStatus = prevStates.get(job.id);

      // No previous entry (brand-new job) or status unchanged -- nothing to notify.
      if (!prevStatus || prevStatus === job.status) continue;

      // Only notify when transitioning *from* an active state.
      const wasActive = prevStatus === "running" || prevStatus === "finalizing" || prevStatus === "queued" || prevStatus === "waiting_for_input" || prevStatus === "paused";
      if (!wasActive) continue;

      if (job.status === "completed") {
        showToast.success("AI job completed", {
          description: `Job ${job.id.slice(0, 8)}...`,
        });
      } else if (job.status === "incomplete") {
        showToast.warning("AI job incomplete", {
          description: job.errorMessage ?? "Some expected work was not reconciled",
        });
      } else if (job.status === "failed") {
        showToast.error("AI job failed", {
          description: job.errorMessage ?? "Unknown error",
        });
      } else if (job.status === "cancelled") {
        showToast.warning("AI job cancelled");
      } else if (job.status === "paused") {
        showToast.warning("AI job paused", {
          description: job.errorMessage ?? "Quota limit reached; the job will resume after reset",
        });
      }
    }

    prevStatesRef.current = nextStates;
  }, [jobMap]);
};
