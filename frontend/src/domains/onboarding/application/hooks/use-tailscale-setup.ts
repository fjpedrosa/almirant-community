"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { tailscaleApi } from "@/lib/api/client";
import { onboardingKeys } from "./use-onboarding-status";
import type {
  TailscaleSetupState,
  TailscaleServeResult,
} from "../../domain/types";

export const tailscaleKeys = {
  all: ["tailscale"] as const,
  status: () => [...tailscaleKeys.all, "status"] as const,
};

const detectBrowserPublicUrl = (): string => {
  if (typeof window === "undefined") return "";

  try {
    const url = new URL(window.location.origin);
    const isLocalhost = ["localhost", "127.0.0.1", "::1"].includes(
      url.hostname,
    );

    if (url.protocol !== "https:" || isLocalhost) return "";
    return url.origin;
  } catch {
    return "";
  }
};

export const useTailscaleSetup = () => {
  const queryClient = useQueryClient();
  const [port, setPort] = useState(8080);
  const [detectedPublicUrl] = useState(detectBrowserPublicUrl);
  const [manualUrl, setManualUrl] = useState(detectedPublicUrl);
  const [activeTab, setActiveTab] = useState("tailscale");
  const [serveResult, setServeResult] = useState<TailscaleServeResult | null>(
    null,
  );

  const statusQuery = useQuery<TailscaleSetupState>({
    queryKey: tailscaleKeys.status(),
    queryFn: () => tailscaleApi.getStatus(),
  });

  const serveMutation = useMutation({
    mutationFn: () => tailscaleApi.serve(port),
    onSuccess: (result) => {
      setServeResult(result);
      queryClient.invalidateQueries({ queryKey: tailscaleKeys.all });
      queryClient.invalidateQueries({ queryKey: onboardingKeys.all });
    },
  });

  const setPublicUrlMutation = useMutation({
    mutationFn: (url?: string) => tailscaleApi.setPublicUrl(url ?? manualUrl),
    onSuccess: (result) => {
      if (result.publicUrl) setManualUrl(result.publicUrl);
      queryClient.invalidateQueries({ queryKey: tailscaleKeys.all });
      queryClient.invalidateQueries({ queryKey: onboardingKeys.all });
    },
  });

  const disableServeMutation = useMutation({
    mutationFn: () => tailscaleApi.disableServe(port),
    onSuccess: () => {
      setServeResult(null);
      queryClient.invalidateQueries({ queryKey: tailscaleKeys.all });
      queryClient.invalidateQueries({ queryKey: onboardingKeys.all });
    },
  });

  return {
    // Status
    status: statusQuery.data,
    isLoading: statusQuery.isLoading,
    // Tailscale serve
    port,
    setPort,
    serveResult,
    isServing: serveMutation.isPending,
    handleServe: () => serveMutation.mutate(),
    // Custom URL
    manualUrl,
    setManualUrl,
    isSavingUrl: setPublicUrlMutation.isPending,
    handleSaveManualUrl: () => setPublicUrlMutation.mutate(undefined),
    detectedPublicUrl: detectedPublicUrl || null,
    handleUseDetectedPublicUrl: () => {
      if (detectedPublicUrl) setPublicUrlMutation.mutate(detectedPublicUrl);
    },
    // Disable serve
    isDisabling: disableServeMutation.isPending,
    handleDisableServe: () => disableServeMutation.mutate(),
    // Tabs
    activeTab,
    setActiveTab,
  };
};
