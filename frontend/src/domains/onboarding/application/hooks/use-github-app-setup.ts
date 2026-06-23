"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  API_BASE,
  buildApiRequestUrl,
  githubApi,
  githubAppApi,
} from "@/lib/api/client";
import { onboardingKeys } from "./use-onboarding-status";
import { useGithubStatus } from "@/domains/github/application/hooks/use-github-status";
import { githubKeys } from "@/domains/github/application/hooks/use-github-summary";
import type {
  GithubAppFormValues,
  GithubAppStatus,
  GithubManifestForm,
} from "../../domain/types";

export const githubAppKeys = {
  all: ["github-app"] as const,
  status: () => [...githubAppKeys.all, "status"] as const,
};

const EMPTY_FORM: GithubAppFormValues = {
  appId: "",
  slug: "",
  clientId: "",
  clientSecret: "",
  webhookSecret: "",
  privateKeyPem: "",
};

const EMPTY_MANIFEST_FORM: GithubManifestForm = {
  appName: "",
  installTarget: "personal",
  orgSlug: "",
};

const isTailscaleFunnelUrl = (publicUrl: string | null): boolean => {
  if (!publicUrl) return false;
  try {
    const host = new URL(publicUrl).hostname;
    return host.endsWith(".ts.net");
  } catch {
    return false;
  }
};

const buildGithubInstallUrl = (
  slug: string | null | undefined,
): string | null => {
  const normalizedSlug = slug?.trim();
  return normalizedSlug
    ? `https://github.com/apps/${normalizedSlug}/installations/select_target`
    : null;
};

export interface UseGithubAppSetupOptions {
  /** Where the manifest-callback should redirect after success. */
  returnTo?: "/onboarding" | "/settings/github";
  /** Public URL of the instance — used to detect Tailscale Funnel. */
  publicUrl?: string | null;
}

export const useGithubAppSetup = (options: UseGithubAppSetupOptions = {}) => {
  const { returnTo = "/onboarding", publicUrl = null } = options;
  const router = useRouter();
  const queryClient = useQueryClient();
  const waitingForInstall = useRef(false);
  const [formValues, setFormValues] = useState<GithubAppFormValues>(EMPTY_FORM);
  const [manifestForm, setManifestForm] =
    useState<GithubManifestForm>(EMPTY_MANIFEST_FORM);
  const [activeTab, setActiveTab] = useState("manifest");
  const [isCreatingApp, setIsCreatingApp] = useState(false);
  const [isSyncingInstallations, setIsSyncingInstallations] = useState(false);

  const statusQuery = useQuery<GithubAppStatus>({
    queryKey: githubAppKeys.status(),
    queryFn: () => githubAppApi.getStatus(),
  });

  const { data: githubConnectionStatus } = useGithubStatus();

  const saveCredentialsMutation = useMutation({
    mutationFn: () => githubAppApi.saveCredentials(formValues),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: githubAppKeys.all });
      queryClient.invalidateQueries({ queryKey: onboardingKeys.all });
      setFormValues(EMPTY_FORM);
    },
  });

  const deleteCredentialsMutation = useMutation({
    mutationFn: () => githubAppApi.deleteCredentials(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: githubAppKeys.all });
      queryClient.invalidateQueries({ queryKey: onboardingKeys.all });
    },
  });

  const handleFormValueChange = useCallback(
    (field: keyof GithubAppFormValues, value: string) => {
      setFormValues((prev) => ({ ...prev, [field]: value }));
    },
    [],
  );

  const handleManifestFormChange = useCallback(
    (field: keyof GithubManifestForm, value: string) => {
      setManifestForm((prev) => ({ ...prev, [field]: value }));
    },
    [],
  );

  const isManifestSubmittable = useMemo(() => {
    const trimmedName = manifestForm.appName.trim();
    if (!trimmedName) return false;
    if (manifestForm.installTarget === "org") {
      return manifestForm.orgSlug.trim().length > 0;
    }
    return true;
  }, [manifestForm]);

  const isTailscaleFunnel = useMemo(
    () => isTailscaleFunnelUrl(publicUrl),
    [publicUrl],
  );

  const appSlug = statusQuery.data?.slug ?? null;
  const githubInstallUrl = useMemo(
    () => buildGithubInstallUrl(appSlug),
    [appSlug],
  );

  const syncInstallations = useCallback(async () => {
    setIsSyncingInstallations(true);
    try {
      await githubApi.syncInstallations();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: githubKeys.all }),
        queryClient.invalidateQueries({ queryKey: onboardingKeys.all }),
      ]);
    } finally {
      setIsSyncingInstallations(false);
    }
  }, [queryClient]);

  useEffect(() => {
    const handleFocus = () => {
      if (!waitingForInstall.current) return;
      waitingForInstall.current = false;
      syncInstallations();
    };

    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [syncInstallations]);

  const handleInstallGithubApp = useCallback(() => {
    if (!githubInstallUrl) return;
    waitingForInstall.current = true;
    window.open(githubInstallUrl, "_blank");
  }, [githubInstallUrl]);

  const handleCreateProject = useCallback(() => {
    router.push("/projects/new");
  }, [router]);

  const handleManifestFlow = useCallback(async () => {
    if (!isManifestSubmittable) return;
    setIsCreatingApp(true);
    try {
      const state = crypto.randomUUID();
      const trimmedName = manifestForm.appName.trim();
      const trimmedOrgSlug = manifestForm.orgSlug.trim();

      const manifestUrl = buildApiRequestUrl(
        API_BASE,
        githubAppApi.getManifestUrl({
          state,
          appName: trimmedName,
          returnTo,
        }),
      );

      const response = await fetch(manifestUrl, { credentials: "include" });

      if (!response.ok) {
        throw new Error("Failed to fetch manifest");
      }

      const json = (await response.json()) as {
        success: boolean;
        data?: { manifest: unknown; state: string };
      };

      const manifest = json.data?.manifest;
      if (!manifest) throw new Error("Manifest payload missing");

      const targetUrl =
        manifestForm.installTarget === "org"
          ? `https://github.com/organizations/${encodeURIComponent(trimmedOrgSlug)}/settings/apps/new?state=${encodeURIComponent(state)}`
          : `https://github.com/settings/apps/new?state=${encodeURIComponent(state)}`;

      const form = document.createElement("form");
      form.method = "POST";
      form.action = targetUrl;

      const input = document.createElement("input");
      input.type = "hidden";
      input.name = "manifest";
      input.value = JSON.stringify(manifest);

      form.appendChild(input);
      document.body.appendChild(form);
      form.submit();
    } catch {
      setIsCreatingApp(false);
    }
  }, [isManifestSubmittable, manifestForm, returnTo]);

  return {
    // Status
    status: statusQuery.data,
    isLoading: statusQuery.isLoading,
    configured: statusQuery.data?.configured ?? false,
    appSlug,
    hasInstallations: (githubConnectionStatus?.installations.length ?? 0) > 0,
    githubInstallUrl,
    isSyncingInstallations,
    handleInstallGithubApp,
    handleSyncInstallations: syncInstallations,
    handleCreateProject,
    // Manual form
    formValues,
    handleFormValueChange,
    isSaving: saveCredentialsMutation.isPending,
    handleSaveManual: () => saveCredentialsMutation.mutate(),
    // Delete
    isDeleting: deleteCredentialsMutation.isPending,
    handleDelete: () => deleteCredentialsMutation.mutate(),
    // Manifest flow
    manifestForm,
    handleManifestFormChange,
    isManifestSubmittable,
    isTailscaleFunnel,
    isCreatingApp,
    handleManifestFlow,
    // Tabs
    activeTab,
    setActiveTab,
  };
};
