"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { useCurrentUserTeams } from "@/domains/teams/application/hooks/use-current-user-teams";
import {
  buildCallbackUrl,
  buildCliAuthCallbackParams,
  buildCliAuthReturnPath,
  resolveCliAuthWorkspace,
  type CliAuthWorkspace,
} from "./cli-auth-workspace";

type Status =
  | "auth_required"
  | "loading"
  | "select_workspace"
  | "success"
  | "error";

type CreateKeyResponse = {
  success?: boolean;
  data?: { key?: string; id?: string };
  error?: string;
};

export default function CliAuthPage() {
  const [status, setStatus] = useState<Status>("loading");
  const [message, setMessage] = useState("Checking session...");
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(
    null,
  );

  const session = authClient.useSession();
  const { teams, isLoading: isLoadingTeams } = useCurrentUserTeams();
  const searchParams = useSearchParams();

  const callback = searchParams.get("callback");
  const keyName = searchParams.get("name") || "Almirant CLI";
  const workspaceHint = searchParams.get("workspace");
  const workspaces = useMemo(
    () => teams as CliAuthWorkspace[],
    [teams],
  );

  useEffect(() => {
    if (!callback) {
      setStatus("error");
      setMessage("Missing callback parameter.");
      return;
    }

    if (session.isPending) {
      setStatus("loading");
      setMessage("Checking session...");
      return;
    }

    if (!session.data?.user) {
      setStatus("auth_required");
      setMessage("You need to sign in to continue.");
      return;
    }

    if (isLoadingTeams) {
      setStatus("loading");
      setMessage("Loading workspaces...");
      return;
    }

    const workspaceResolution = resolveCliAuthWorkspace(
      workspaces,
      workspaceHint,
      selectedWorkspaceId,
    );

    if (workspaceResolution.status === "needs_selection") {
      setStatus("select_workspace");
      setMessage("Choose the workspace this CLI account should use.");
      return;
    }

    if (workspaceResolution.status === "error") {
      setStatus("error");
      setMessage(workspaceResolution.message);
      window.location.href = buildCallbackUrl(callback, {
        error: workspaceResolution.message,
      });
      return;
    }

    const run = async () => {
      try {
        setStatus("loading");
        setMessage(
          `Generating API key for ${workspaceResolution.workspace.name}...`,
        );

        const response = await fetch("/api/api-keys", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: keyName,
            workspaceId: workspaceResolution.workspace.id,
          }),
        });

        const data = (await response.json()) as CreateKeyResponse;

        if (!response.ok || !data.success || !data.data?.key) {
          throw new Error(data.error || "Failed to generate API key");
        }

        setStatus("success");
        setMessage("Authentication complete. Redirecting back to CLI...");

        window.location.href = buildCallbackUrl(callback, {
          ...buildCliAuthCallbackParams(
            { key: data.data.key, id: data.data.id },
            workspaceResolution.workspace,
          ),
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : "unknown error";
        setStatus("error");
        setMessage(`Failed to generate API key: ${reason}`);
        window.location.href = buildCallbackUrl(callback, { error: reason });
      }
    };

    void run();
  }, [
    callback,
    keyName,
    isLoadingTeams,
    selectedWorkspaceId,
    session.data?.user,
    session.isPending,
    workspaceHint,
    workspaces,
  ]);

  const signIn = () => {
    if (!callback) return;

    const callbackURL = buildCliAuthReturnPath(callback, keyName, workspaceHint);

    authClient.signIn.social({
      provider: "google",
      callbackURL,
      errorCallbackURL: `/sign-in?error=unauthorized&redirectTo=${encodeURIComponent(callbackURL)}`,
    });
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-xl items-center justify-center px-6">
      <div className="w-full rounded-lg border bg-card p-6 text-center shadow-sm">
        <h1 className="text-xl font-semibold">Almirant CLI Auth</h1>
        <p className="mt-3 text-sm text-muted-foreground">{message}</p>
        {status === "select_workspace" && (
          <div className="mt-5 space-y-2">
            {workspaces.map((workspace) => (
              <button
                key={workspace.id}
                type="button"
                onClick={() => setSelectedWorkspaceId(workspace.id)}
                className="block w-full rounded-md border px-4 py-2 text-left text-sm hover:bg-muted"
              >
                <span className="font-medium">{workspace.name}</span>
                <span className="ml-2 text-muted-foreground">
                  {workspace.slug}
                </span>
              </button>
            ))}
          </div>
        )}
        {status === "auth_required" && (
          <button
            type="button"
            onClick={signIn}
            className="mt-5 inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Sign in with Google
          </button>
        )}
      </div>
    </div>
  );
}
