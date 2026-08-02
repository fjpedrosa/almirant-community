"use client";

import { useCallback, useState } from "react";
import { devFlowApi } from "@/lib/api/client";
import type { ProjectDevFlowDiagnosisState } from "../../domain/types";

/**
 * Lazy, per-automation dispatch diagnosis for the "Automated dev flow" card.
 * Each of the four automation rows can independently trigger
 * GET /scheduled-agents/:id/explain (via the "Diagnose" action / row
 * expansion) instead of firing all four requests on initial render. Kept as
 * a small local `useState` map rather than React Query, since this is
 * on-demand diagnostic data with no caching/invalidation story of its own.
 */
export const useDevFlowDiagnostics = () => {
  const [diagnosisByConfigId, setDiagnosisByConfigId] = useState<
    Record<string, ProjectDevFlowDiagnosisState>
  >({});

  const diagnose = useCallback((configId: string) => {
    setDiagnosisByConfigId((current) => ({
      ...current,
      [configId]: { status: "loading", result: null, error: null },
    }));

    devFlowApi
      .explainAgent(configId)
      .then((result) => {
        setDiagnosisByConfigId((current) => ({
          ...current,
          [configId]: { status: "loaded", result, error: null },
        }));
      })
      .catch((error: unknown) => {
        setDiagnosisByConfigId((current) => ({
          ...current,
          [configId]: {
            status: "error",
            result: null,
            error: error instanceof Error ? error.message : "Failed to diagnose agent",
          },
        }));
      });
  }, []);

  return { diagnosisByConfigId, diagnose };
};
