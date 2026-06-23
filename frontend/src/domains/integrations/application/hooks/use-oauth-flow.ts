"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { connectionsApi, vercelApi } from "@/lib/api/client";
import { connectionKeys } from "./use-connections";
import type { OAuthFlowStep, ProviderType } from "../../domain/types";

// ---------------------------------------------------------------------------
// useOAuthFlow - manages the OAuth redirect flow for provider connections
// ---------------------------------------------------------------------------

export const useOAuthFlow = () => {
  const queryClient = useQueryClient();

  const [flowStep, setFlowStep] = useState<OAuthFlowStep>("idle");
  const [error, setError] = useState<string | null>(null);
  const [activeProvider, setActiveProvider] = useState<ProviderType | null>(
    null
  );

  // Track whether we're waiting for the user to return from the OAuth popup/tab
  const waitingForOAuth = useRef(false);

  // When user returns to the tab after the OAuth redirect, refresh connection data
  useEffect(() => {
    const handleFocus = () => {
      if (waitingForOAuth.current) {
        waitingForOAuth.current = false;
        setFlowStep("idle");
        setActiveProvider(null);
        queryClient.invalidateQueries({ queryKey: connectionKeys.all });
      }
    };

    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [queryClient]);

  /**
   * Start the OAuth flow for a given provider.
   * Opens the provider authorization URL in a new tab.
   */
  const startOAuth = useCallback(async (provider: ProviderType, scope?: "user" | "organization") => {
    setError(null);
    setActiveProvider(provider);
    setFlowStep("redirecting");

    try {
      const { url } = provider === "vercel"
        ? await vercelApi.getAuthUrl()
        : await connectionsApi.getOAuthUrl(provider, scope);
      waitingForOAuth.current = true;
      setFlowStep("waiting_callback");
      window.open(url, "_blank");
    } catch (err) {
      setFlowStep("error");
      setError(
        err instanceof Error ? err.message : "Failed to start OAuth flow"
      );
    }
  }, []);

  /**
   * Handle the OAuth callback manually (e.g. when the provider requires
   * pasting a code instead of a redirect).
   */
  const handleCallback = useCallback(
    async (provider: ProviderType, code: string, state: string) => {
      setError(null);
      setFlowStep("exchanging");

      try {
        await connectionsApi.handleOAuthCallback(provider, { code, state });
        setFlowStep("success");
        queryClient.invalidateQueries({ queryKey: connectionKeys.all });
      } catch (err) {
        setFlowStep("error");
        setError(
          err instanceof Error
            ? err.message
            : "Failed to complete OAuth exchange"
        );
      }
    },
    [queryClient]
  );

  /**
   * Reset the flow back to idle (e.g. user cancels or dismisses error).
   */
  const reset = useCallback(() => {
    waitingForOAuth.current = false;
    setFlowStep("idle");
    setError(null);
    setActiveProvider(null);
  }, []);

  return {
    flowStep,
    error,
    activeProvider,
    startOAuth,
    handleCallback,
    reset,
  };
};
