"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { githubApi, repositoriesApi, vercelApi } from "@/lib/api/client";
import { isGithubTokenExpiredError } from "@/domains/github/domain/types";
import { useActiveTeam } from "@/domains/teams/application/hooks/use-active-team";
import { useGithubStatus } from "@/domains/github/application/hooks/use-github-status";
import { useGithubInstallationRepos } from "@/domains/github/application/hooks/use-github-installation-repos";
import { useCreateGithubRepo } from "@/domains/github/application/hooks/use-create-github-repo";
import { useVercelStatus } from "@/domains/vercel/application/hooks/use-vercel-status";
import { useConnections, connectionKeys } from "@/domains/integrations/application/hooks/use-connections";
import { useOAuthConnect } from "@/domains/integrations/application/hooks/use-oauth-connect";
import { useCreateProject } from "./use-projects";
import { useCreateApiKey } from "@/domains/api-keys/application/hooks/use-api-keys";
import type {
  GithubMode,
  ProjectWizardApiKey,
  ProjectWizardState,
  ProjectWizardStep,
} from "../../domain/types";
import type { GithubAvailableRepo } from "@/domains/github/domain/types";

const isValidEmail = (value: string): boolean => {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
};

const SKIPPABLE_STEPS: ProjectWizardStep[] = ["collaborators", "github-repo", "vercel-deploy"];

export const useProjectWizard = () => {
  const router = useRouter();
  const createProject = useCreateProject();
  const createApiKey = useCreateApiKey();
  const { confirmedActiveTeamId: activeWorkspaceId } = useActiveTeam();

  // GitHub & Vercel connection status
  const { data: githubStatus } = useGithubStatus();
  const { data: vercelStatus } = useVercelStatus();

  // Check for GitHub OAuth (personal) connections
  const userConnectionsParams = useMemo(() => {
    const params = new URLSearchParams({ scope: "user", isActive: "true" });
    return params;
  }, []);
  const { data: userConnections } = useConnections(userConnectionsParams);
  const hasGitHubOAuth = useMemo(
    () => (userConnections ?? []).some((c) => c.provider === "github"),
    [userConnections],
  );

  // OAuth connect flow for inline GitHub connection
  const oauthConnect = useOAuthConnect();
  const queryClient = useQueryClient();

  const [needsGithubReconnect, setNeedsGithubReconnect] = useState(false);

  // Re-fetch user connections when window regains focus (after OAuth popup closes)
  useEffect(() => {
    const handleFocus = () => {
      queryClient.invalidateQueries({ queryKey: connectionKeys.all });
    };
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [queryClient]);

  const hasGithub = githubStatus?.configured ?? false;
  const hasVercel = vercelStatus?.connected ?? false;

  // Determine GitHub mode: app > oauth > none
  const githubMode: GithubMode = useMemo(() => {
    if (hasGithub) return "app";
    if (hasGitHubOAuth) return "oauth";
    return "none";
  }, [hasGithub, hasGitHubOAuth]);

  // Dynamic wizard steps — github-repo is always shown now
  const wizardSteps = useMemo<ProjectWizardStep[]>(() => {
    const steps: ProjectWizardStep[] = ["project-name"];

    steps.push("github-repo");

    steps.push("collaborators", "api-key");

    if (hasGithub && hasVercel) {
      steps.push("vercel-deploy");
    }

    steps.push("summary");
    return steps;
  }, [hasGithub, hasVercel]);

  const [stepIndex, setStepIndex] = useState(0);
  const [collaboratorInput, setCollaboratorInput] = useState("");

  // GitHub-specific state
  const [selectedInstallationId, setSelectedInstallationId] = useState<number | null>(() => {
    if (githubStatus?.installations && githubStatus.installations.length > 0) {
      return githubStatus.installations[0].installationId;
    }
    return null;
  });

  // Auto-select first installation when status loads
  const resolvedInstallationId = useMemo(() => {
    if (selectedInstallationId) return selectedInstallationId;
    const installations = githubStatus?.installations;
    if (installations && installations.length > 0) {
      return installations[0].installationId;
    }
    return null;
  }, [selectedInstallationId, githubStatus]);

  // Check if the selected installation is on a personal GitHub account.
  // Installation tokens cannot create repos on personal accounts —
  // we need the user's OAuth token for that.
  const selectedInstallationIsPersonal = useMemo(() => {
    const installations = githubStatus?.installations;
    if (!installations || !resolvedInstallationId) return false;
    const inst = installations.find((i) => i.installationId === resolvedInstallationId);
    return inst?.accountType === "user";
  }, [selectedInstallationId, githubStatus]);

  const { data: githubRepos, isLoading: isLoadingGithubRepos } =
    useGithubInstallationRepos(resolvedInstallationId);

  const createGithubRepo = useCreateGithubRepo(resolvedInstallationId ?? 0);

  const [state, setState] = useState<ProjectWizardState>({
    projectName: "",
    collaboratorEmails: [],
    apiKey: null,
    githubRepo: null,
    createNewRepo: false,
    newRepoName: "",
    newRepoIsPrivate: true,
    deployToVercel: false,
    vercelProjectName: "",
  });

  const step = wizardSteps[stepIndex];

  const canProceed = useMemo(() => {
    if (step === "project-name") return state.projectName.trim().length > 0;
    if (step === "github-repo") {
      if (githubMode === "none") return true; // Can skip if not connected
      if (githubMode === "oauth") {
        // In OAuth mode, user can proceed with or without filling a repo name
        return true;
      }
      if (state.createNewRepo) return state.newRepoName.trim().length > 0;
      return true; // Can proceed without selecting a repo (skip-like)
    }
    if (step === "vercel-deploy") return true;
    return true;
  }, [step, state.projectName, state.createNewRepo, state.newRepoName, githubMode]);

  // ---- Project name ----
  const updateProjectName = useCallback((projectName: string) => {
    setState((current) => ({ ...current, projectName }));
  }, []);

  // ---- Collaborators ----
  const addCollaborator = useCallback((email: string) => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) return;
    if (!isValidEmail(trimmed)) {
      showToast.error("Email invalido");
      return;
    }

    setCollaboratorInput("");
    setState((current) => {
      if (current.collaboratorEmails.includes(trimmed)) return current;
      return {
        ...current,
        collaboratorEmails: [...current.collaboratorEmails, trimmed],
      };
    });
  }, []);

  const removeCollaborator = useCallback((email: string) => {
    setState((current) => ({
      ...current,
      collaboratorEmails: current.collaboratorEmails.filter((value) => value !== email),
    }));
  }, []);

  // ---- API key ----
  const generateApiKey = useCallback(async () => {
    try {
      const name = `${state.projectName || "Project"} Wizard Key`;
      const created = await createApiKey.mutateAsync(name);
      const apiKey: ProjectWizardApiKey = {
        id: created.id,
        name: created.name,
        key: created.key,
      };
      setState((current) => ({ ...current, apiKey }));
      showToast.success("API key generada");
    } catch {
      showToast.error("No se pudo generar la API key");
    }
  }, [createApiKey, state.projectName]);

  const copyApiKey = useCallback(() => {
    if (!state.apiKey) return;
    navigator.clipboard.writeText(state.apiKey.key);
    showToast.success("API key copiada");
  }, [state.apiKey]);

  // ---- GitHub repo ----
  const selectInstallation = useCallback((id: number) => {
    setSelectedInstallationId(id);
    // Clear repo selection when switching installations
    setState((current) => ({ ...current, githubRepo: null }));
  }, []);

  const selectRepo = useCallback((repo: GithubAvailableRepo) => {
    setState((current) => ({
      ...current,
      githubRepo: {
        installationId: resolvedInstallationId ?? 0,
        fullName: repo.full_name,
        url: repo.html_url,
        isNew: false,
      },
      createNewRepo: false,
    }));
  }, [resolvedInstallationId]);

  const toggleCreateNew = useCallback(() => {
    setState((current) => ({
      ...current,
      createNewRepo: !current.createNewRepo,
      githubRepo: null, // Clear selection when toggling mode
    }));
  }, []);

  const setNewRepoName = useCallback((name: string) => {
    setState((current) => ({ ...current, newRepoName: name }));
  }, []);

  const togglePrivate = useCallback(() => {
    setState((current) => ({ ...current, newRepoIsPrivate: !current.newRepoIsPrivate }));
  }, []);

  // ---- Connect GitHub (OAuth) inline ----
  const connectGitHub = useCallback(() => {
    oauthConnect.openDialog("github");
  }, [oauthConnect]);

  // ---- Vercel deploy ----
  const toggleDeployToVercel = useCallback(() => {
    setState((current) => ({
      ...current,
      deployToVercel: !current.deployToVercel,
      // Default vercel project name from project name if empty
      vercelProjectName: !current.deployToVercel && !current.vercelProjectName
        ? current.projectName.trim().toLowerCase().replace(/\s+/g, "-")
        : current.vercelProjectName,
    }));
  }, []);

  const setVercelProjectName = useCallback((name: string) => {
    setState((current) => ({ ...current, vercelProjectName: name }));
  }, []);

  // ---- Navigation ----
  const next = useCallback(() => {
    if (!canProceed) return;
    setStepIndex((current) => Math.min(current + 1, wizardSteps.length - 1));
  }, [canProceed, wizardSteps.length]);

  const back = useCallback(() => {
    setStepIndex((current) => Math.max(current - 1, 0));
  }, []);

  const skip = useCallback(() => {
    if (!SKIPPABLE_STEPS.includes(step)) return;
    setStepIndex((current) => Math.min(current + 1, wizardSteps.length - 1));
  }, [step, wizardSteps.length]);

  // ---- Finish ----
  const finish = useCallback(async () => {
    try {
      // 1. Create the project (scoped to active workspace)
      const createdProject = (await createProject.mutateAsync({
        name: state.projectName.trim(),
        workspaceId: activeWorkspaceId,
      })) as { id: string };

      // 2. If creating a new GitHub repo, do it now
      let repoFullName = state.githubRepo?.fullName ?? null;
      let repoUrl = state.githubRepo?.url ?? null;

      const shouldCreateRepo =
        (githubMode === "oauth" && state.newRepoName.trim()) ||
        (state.createNewRepo && state.newRepoName.trim());

      if (shouldCreateRepo) {
        try {
          // Use OAuth endpoint for: explicit oauth mode, or App mode on
          // personal accounts (installation tokens can't create repos there).
          const useOAuth = githubMode === "oauth" || selectedInstallationIsPersonal;

          if (useOAuth) {
            const newRepo = (await githubApi.createUserRepo({
              name: state.newRepoName.trim(),
              isPrivate: state.newRepoIsPrivate,
              autoInit: true,
            })) as { full_name: string; html_url: string };
            repoFullName = newRepo.full_name;
            repoUrl = newRepo.html_url;
          } else if (resolvedInstallationId) {
            // Use GitHub App installation endpoint (org accounts)
            const newRepo = await createGithubRepo.mutateAsync({
              name: state.newRepoName.trim(),
              isPrivate: state.newRepoIsPrivate,
              autoInit: true,
            });
            repoFullName = newRepo.full_name;
            repoUrl = newRepo.html_url;
          }
        } catch (err) {
          if (isGithubTokenExpiredError(err)) {
            showToast.error("Tu token de GitHub ha expirado. Reconecta tu cuenta.");
            setNeedsGithubReconnect(true);
            return;
          }
          showToast.error("No se pudo crear el repositorio en GitHub");
        }
      }

      // 3. Link repository to the project if we have one
      if (repoFullName && repoUrl) {
        try {
          await repositoriesApi.create(createdProject.id, {
            name: repoFullName.split("/").pop() ?? repoFullName,
            url: repoUrl,
            provider: "github",
            isMonorepo: false,
          });
        } catch {
          showToast.error("No se pudo vincular el repositorio al proyecto");
        }
      }

      // 4. If deploying to Vercel and we have a repo
      if (state.deployToVercel && state.vercelProjectName.trim()) {
        try {
          await vercelApi.createProject({
            name: state.vercelProjectName.trim(),
            framework: "nextjs",
            ...(repoFullName ? { gitRepository: { type: "github", repo: repoFullName } } : {}),
          });
        } catch {
          showToast.error("No se pudo crear el proyecto en Vercel");
        }
      }

      showToast.success("Proyecto configurado correctamente");
      router.push(`/projects/${createdProject.id}`);
    } catch {
      showToast.error("No se pudo completar el setup del proyecto");
    }
  }, [
    activeWorkspaceId,
    createProject,
    createGithubRepo,
    githubMode,
    selectedInstallationIsPersonal,
    resolvedInstallationId,
    router,
    state,
  ]);

  const reconnectGitHub = useCallback(() => {
    setNeedsGithubReconnect(false);
    oauthConnect.openDialog("github");
  }, [oauthConnect]);

  // Clear needsGithubReconnect when user connections change (successful reconnect)
  const prevHasGitHubOAuth = useRef(hasGitHubOAuth);
  useEffect(() => {
    if (!prevHasGitHubOAuth.current && hasGitHubOAuth) {
      setNeedsGithubReconnect(false);
    }
    prevHasGitHubOAuth.current = hasGitHubOAuth;
  }, [hasGitHubOAuth]);

  return {
    step,
    stepIndex,
    totalSteps: wizardSteps.length,
    state,
    collaboratorInput,
    isGeneratingApiKey: createApiKey.isPending,
    isFinishing: createProject.isPending,
    canProceed,
    updateProjectName,
    setCollaboratorInput,
    addCollaborator,
    removeCollaborator,
    generateApiKey,
    copyApiKey,
    next,
    back,
    skip,
    finish,
    // GitHub
    hasGithub,
    githubMode,
    connectGitHub,
    oauthConnect,
    githubInstallations: githubStatus?.installations ?? [],
    selectedInstallationId: resolvedInstallationId,
    selectInstallation,
    githubRepos: githubRepos ?? [],
    isLoadingGithubRepos,
    selectedRepoFullName: state.githubRepo?.fullName ?? null,
    selectRepo,
    createNewRepo: state.createNewRepo,
    toggleCreateNew,
    newRepoName: state.newRepoName,
    setNewRepoName,
    newRepoIsPrivate: state.newRepoIsPrivate,
    togglePrivate,
    isCreatingRepo: createGithubRepo.isPending,
    needsOAuthForRepoCreation: selectedInstallationIsPersonal && !hasGitHubOAuth,
    needsGithubReconnect,
    reconnectGitHub,
    // Vercel
    hasVercel,
    deployToVercel: state.deployToVercel,
    toggleDeployToVercel,
    vercelProjectName: state.vercelProjectName,
    setVercelProjectName,
  };
};
