"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { planningSessionsApi } from "@/domains/planning/infrastructure/api/planning-api";
import type { BootPhase } from "../../domain/types";

const DEFAULT_SUGGESTIONS = [
  "Planificar nueva feature",
  "Revisar ideas pendientes",
  "Brainstorming libre",
];

/**
 * Fetches a personalized welcome message from the backend LLM endpoint
 * and simulates boot phase progress while the session is loading.
 */
export function useWelcomeScreen(
  sessionId: string | null,
  projectName?: string,
  seedCount?: number,
) {
  const t = useTranslations("aiPlanning");
  const [welcomeMessage, setWelcomeMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [bootPhase, setBootPhase] = useState<BootPhase>("connecting");

  // Fetch welcome message when sessionId is set
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    setIsLoading(true);

    planningSessionsApi
      .getWelcomeMessage(sessionId, { projectName, seedCount })
      .then((res) => {
        if (!cancelled) setWelcomeMessage(res.message);
      })
      .catch(() => {
        if (!cancelled) setWelcomeMessage(t("welcomeFallback"));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId, projectName, seedCount, t]);

  // Progress simulation: advance boot phase over time
  useEffect(() => {
    if (!sessionId) return;
    const t1 = setTimeout(() => setBootPhase("preparing"), 3000);
    const t2 = setTimeout(() => setBootPhase("almost_ready"), 8000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [sessionId]);

  return {
    welcomeMessage,
    isLoadingWelcome: isLoading,
    bootPhase,
    suggestions: DEFAULT_SUGGESTIONS,
  };
}
