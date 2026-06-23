"use client";

import { useState, useCallback } from "react";
import { useOAuthFlow } from "./use-oauth-flow";
import type {
  OAuthProvider,
  UseOAuthConnectReturn,
} from "../../domain/types";

// ---------------------------------------------------------------------------
// Static provider metadata for OAuth-capable providers
// ---------------------------------------------------------------------------

const OAUTH_PROVIDER_META: Record<
  OAuthProvider,
  { name: string; description: string }
> = {
  github: {
    name: "GitHub",
    description:
      "Connect your GitHub account to sync repositories, issues and pull requests with your work items.",
  },
  vercel: {
    name: "Vercel",
    description:
      "Connect your Vercel account to deploy previews and manage production deployments from your projects.",
  },
};

// ---------------------------------------------------------------------------
// useOAuthConnect
// ---------------------------------------------------------------------------
// Thin wrapper around useOAuthFlow that adds dialog open/close state and
// provides provider metadata needed by the presentational dialog.
// ---------------------------------------------------------------------------

export const useOAuthConnect = (): UseOAuthConnectReturn => {
  const { flowStep, error, startOAuth, reset } = useOAuthFlow();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [activeProvider, setActiveProvider] = useState<OAuthProvider | null>(
    null,
  );

  const meta = activeProvider
    ? OAUTH_PROVIDER_META[activeProvider]
    : { name: "", description: "" };

  const openDialog = useCallback((provider: OAuthProvider) => {
    setActiveProvider(provider);
    setDialogOpen(true);
  }, []);

  const closeDialog = useCallback(() => {
    setDialogOpen(false);
    setActiveProvider(null);
    reset();
  }, [reset]);

  const handleConnect = useCallback(() => {
    if (!activeProvider) return;
    // GitHub OAuth connections are user-scoped (personal token for repo creation)
    const scope = activeProvider === "github" ? "user" as const : undefined;
    startOAuth(activeProvider, scope);
  }, [activeProvider, startOAuth]);

  return {
    dialogOpen,
    activeProvider,
    providerName: meta.name,
    providerDescription: meta.description,
    flowStep,
    error,
    openDialog,
    closeDialog,
    handleConnect,
  };
};
