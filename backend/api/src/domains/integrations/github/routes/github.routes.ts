import { Elysia, t } from "elysia";
import { sessionContextTypes } from "../../../../shared/middleware/session-context-types.plugin";
import {
  getInstallations,
  getConnectedInstallationIds,
  getInstallationByGithubId,
  upsertInstallation,
  linkRepoToInstallation,
  unlinkRepo,
  getLinkedReposByInstallation,
  getGithubSummaryForProject,
  getPullRequestsByProject,
  getRecentCommitsByProject,
  getWorkflowRunsByProject,
  getContributorsByProject,
  getRecentEventsByProject,
  getConnectionById,
  deactivateConnection,
  getUnlinkedGithubReposForWorkspace,
  extractGithubRepoFullName,
  getProjectIdsWithLinkedRepos,
  getProjectById,
  getWorkspaceIdByRepoId,
  db,
  eq,
  repoInstallationLinks,
} from "@almirant/database";
import type { ProviderConnection } from "@almirant/database";
import { findActiveConnection } from "@almirant/database";
import { refreshOAuthCredentials } from "../../../connections/services/oauth/token-refresh";
import { env } from "@almirant/config";
import {
  isGithubConfiguredAsync,
  fetchInstallationRepositories,
  syncInstallationsFromGithub,
  createRepository,
  createRepositoryWithUserToken,
} from "../services/github-service";
import { syncProjectGithubData } from "../services/github-sync";
import {
  successResponse,
  errorResponse,
  notFoundResponse,
} from "../../../../shared/services/response";
import { logger } from "@almirant/config";
import { wsConnectionManager } from "../../../../shared/ws/ws-connection-manager";

// ---------------------------------------------------------------------------
// Helper: extract backward-compatible GitHub fields from a provider_connections row
// ---------------------------------------------------------------------------

const GITHUB_APP_NOT_CONFIGURED_MESSAGE =
  "GitHub App is not configured. Visit /settings/github to create or configure it.";

const extractGithubFields = (connection: ProviderConnection) => {
  const config = (connection.config as Record<string, unknown>) ?? {};
  return {
    installationId: (config.installationId as number) ?? 0,
    accountLogin: connection.accountIdentifier ?? "",
    accountType: (config.accountType as string) ?? "user",
  };
};

export const githubRoutes = new Elysia({ prefix: "/github" })
  .use(sessionContextTypes)

  // ──────────────────────────────────────────────
  // GitHub Integration Status & Installations
  // ──────────────────────────────────────────────

  // GET /github/status — Check GitHub integration status
  .get("/status", async ({ activeWorkspace }) => {
    const orgId = (activeWorkspace as { id: string }).id;
    const configured = await isGithubConfiguredAsync();
    let installations = await getInstallations({ scopeId: orgId, isActive: true });

    const collectLinkedRepos = async () => {
      const linkedRepos: Array<{ repoId: string; githubRepoFullName: string }> = [];
      for (const installation of installations) {
        const links = await getLinkedReposByInstallation(installation.id);
        for (const link of links) {
          linkedRepos.push({
            repoId: link.repoId,
            githubRepoFullName: link.githubRepoFullName,
          });
        }
      }
      return linkedRepos;
    };

    // Collect linked repos across all installations for this workspace
    let linkedRepos = await collectLinkedRepos();

    // Self-heal historical data where repositories exist but links were not created.
    if (configured && installations.length > 0 && linkedRepos.length === 0) {
      try {
        let autoLinked = 0;

        for (const installation of installations) {
          const unlinkedRepos = await getUnlinkedGithubReposForWorkspace(orgId);

          for (const repo of unlinkedRepos) {
            const fullName = extractGithubRepoFullName(repo.url);
            if (!fullName) continue;

            try {
              await linkRepoToInstallation({
                installationId: installation.id,
                repoId: repo.id,
                githubRepoFullName: fullName,
              });
              autoLinked++;
            } catch (linkErr) {
              logger.warn(
                {
                  repoId: repo.id,
                  repoName: repo.name,
                  connectionId: installation.id,
                  error: linkErr,
                },
                "Failed to auto-link repo during GitHub status check (skipping)",
              );
            }
          }
        }

        if (autoLinked > 0) {
          linkedRepos = await collectLinkedRepos();
          logger.info(
            { orgId, autoLinked },
            "Auto-linked repositories during GitHub status check",
          );
        }
      } catch (error) {
        logger.error(error, "Auto-link repos failed during GitHub status check");
      }
    }

    return successResponse({
      configured,
      installations,
      linkedRepos,
    });
  })

  // POST /github/sync-installations — Discover installations from GitHub API and persist them
  .post("/sync-installations", async ({ activeWorkspace, set }) => {
    if (!(await isGithubConfiguredAsync())) {
      set.status = 400;
      return errorResponse(GITHUB_APP_NOT_CONFIGURED_MESSAGE);
    }

    const orgId = (activeWorkspace as { id: string }).id;

    try {
      const remoteInstallations = await syncInstallationsFromGithub();

      // Upsert installations and collect results for auto-linking
      const upsertedConnections: Array<{ upserted: Awaited<ReturnType<typeof upsertInstallation>> | null; installationId: number }> = [];

      for (const inst of remoteInstallations) {
        const upserted = await upsertInstallation({
          installationId: inst.id,
          accountLogin: inst.account.login,
          accountType: inst.account.type === "User" ? "user" : "organization",
          accountAvatarUrl: inst.account.avatar_url || null,
          permissions: inst.permissions || {},
          repositorySelection: inst.repository_selection || "all",
          workspaceId: orgId,
        });
        upsertedConnections.push({ upserted, installationId: inst.id });
      }

      // Auto-link existing GitHub repos for each upserted installation
      let totalAutoLinked = 0;
      for (const { upserted, installationId } of upsertedConnections) {
        if (!upserted?.id) continue;

        try {
          const unlinkedRepos = await getUnlinkedGithubReposForWorkspace(orgId);
          let autoLinked = 0;

          for (const repo of unlinkedRepos) {
            const fullName = extractGithubRepoFullName(repo.url);
            if (!fullName) continue;

            try {
              await linkRepoToInstallation({
                installationId: upserted.id,
                repoId: repo.id,
                githubRepoFullName: fullName,
              });
              autoLinked++;
            } catch (linkErr) {
              logger.warn(
                { repoId: repo.id, repoName: repo.name, error: linkErr },
                "Failed to auto-link repo to GitHub installation during sync (skipping)",
              );
            }
          }

          if (autoLinked > 0) {
            totalAutoLinked += autoLinked;
            logger.info(
              { connectionId: upserted.id, orgId, autoLinked, installationId },
              "Auto-linked existing repos to GitHub installation during sync",
            );
          }
        } catch (autoLinkErr) {
          // Non-fatal: the installation was synced successfully, auto-link is best-effort
          logger.error(autoLinkErr, "Failed to auto-link repos during GitHub installations sync");
        }

        // Fire-and-forget: trigger initial sync for all projects with linked repos
        try {
          const projectIds = await getProjectIdsWithLinkedRepos(upserted.id);
          if (projectIds.length > 0) {
            const installationPayload = [{
              id: upserted.id,
              installationId,
            }];

            void Promise.allSettled(
              projectIds.map((projectId) =>
                syncProjectGithubData(projectId, installationPayload),
              ),
            ).then((results) => {
              const succeeded = results.filter((r) => r.status === "fulfilled").length;
              logger.info(
                { projectCount: results.length, succeeded, orgId, connectionId: upserted.id },
                "Background auto-sync completed after GitHub installations sync",
              );
            }).catch((err) => {
              logger.error(err, "Background auto-sync failed after GitHub installations sync");
            });
          }
        } catch (syncDiscoveryErr) {
          // Non-fatal: installation sync and auto-link succeeded, sync discovery is best-effort
          logger.error(syncDiscoveryErr, "Failed to discover projects for auto-sync after GitHub installations sync");
        }
      }

      if (totalAutoLinked > 0) {
        logger.info(
          { orgId, totalAutoLinked, installationCount: upsertedConnections.length },
          "Completed auto-linking repos across all synced GitHub installations",
        );
      }

      const installations = await getInstallations({ scopeId: orgId, isActive: true });

      if (remoteInstallations.length > 0) {
        wsConnectionManager.broadcastToWorkspace(orgId, {
          type: "connection:updated",
          payload: {
            provider: "github",
            scope: "organization",
            scopeId: orgId,
            connectionId: null,
            action: "updated",
          },
        });
      }

      return successResponse({
        configured: true,
        installations,
        synced: remoteInstallations.length,
      });
    } catch (error) {
      logger.error(error, "Failed to sync installations from GitHub");
      set.status = 500;
      return errorResponse(
        `Failed to sync installations: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  })

  // GET /github/available-installations — Discover installations from GitHub API without persisting
  // Returns raw installations with a flag indicating which ones are already connected to this workspace
  .get("/available-installations", async ({ activeWorkspace, set }) => {
    if (!(await isGithubConfiguredAsync())) {
      set.status = 400;
      return errorResponse(GITHUB_APP_NOT_CONFIGURED_MESSAGE);
    }

    const orgId = (activeWorkspace as { id: string }).id;

    try {
      // Fetch raw installations from GitHub API (no persistence)
      const rawInstallations = await syncInstallationsFromGithub();

      // Connected to THIS org
      const connectedInstallations = await getInstallations({ scopeId: orgId, isActive: true });
      const connectedInstallationIds = new Set(
        connectedInstallations.map((c) => c.installationId)
      );

      // Connected to ANY org — used to hide installations belonging to other orgs
      const allConnectedInstallationIds = new Set(
        await getConnectedInstallationIds()
      );

      // Map to response format — only show installations connected to THIS org or not connected to any org
      const mapped = rawInstallations
        .filter((inst) =>
          connectedInstallationIds.has(inst.id) || !allConnectedInstallationIds.has(inst.id)
        )
        .map((inst) => ({
          installationId: inst.id,
          accountLogin: inst.account.login,
          accountType: inst.account.type,
          accountAvatarUrl: inst.account.avatar_url,
          repositorySelection: inst.repository_selection,
          suspendedAt: inst.suspended_at,
          isConnected: connectedInstallationIds.has(inst.id),
        }));

      return successResponse(mapped);
    } catch (error) {
      logger.error(error, "Failed to fetch available installations from GitHub");
      set.status = 500;
      return errorResponse(
        `Failed to fetch available installations: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  })

  // POST /github/connect-installation — Persist a specific GitHub installation for the current workspace
  .post("/connect-installation", async ({ body, activeWorkspace, set }) => {
    if (!(await isGithubConfiguredAsync())) {
      set.status = 400;
      return errorResponse(GITHUB_APP_NOT_CONFIGURED_MESSAGE);
    }

    const orgId = (activeWorkspace as { id: string }).id;

    try {
      // Fetch raw installations from GitHub to validate the installationId exists
      const rawInstallations = await syncInstallationsFromGithub();
      const targetInstallation = rawInstallations.find(
        (inst) => inst.id === body.installationId
      );

      if (!targetInstallation) {
        set.status = 404;
        return errorResponse(
          `GitHub installation ${body.installationId} not found. Ensure the GitHub App is installed on the target account.`
        );
      }

      // Upsert the installation as a provider connection scoped to this workspace.
      // Passing workspaceId ensures the lookup is scoped so that connecting the
      // same GitHub App installation to workspace B does not overwrite workspace A.
      const upserted = await upsertInstallation({
        installationId: targetInstallation.id,
        accountLogin: targetInstallation.account.login,
        accountType: targetInstallation.account.type === "Organization" ? "organization" : "user",
        accountAvatarUrl: targetInstallation.account.avatar_url ?? null,
        permissions: targetInstallation.permissions ?? {},
        repositorySelection: targetInstallation.repository_selection ?? null,
        workspaceId: orgId,
      });

      wsConnectionManager.broadcastToWorkspace(orgId, {
        type: "connection:updated",
        payload: {
          provider: "github",
          scope: "organization",
          scopeId: orgId,
          connectionId: upserted?.id ?? null,
          action: "connected",
        },
      });

      // Auto-link existing GitHub repos across all projects in this workspace
      if (upserted?.id) {
        try {
          const unlinkedRepos = await getUnlinkedGithubReposForWorkspace(orgId);
          let autoLinked = 0;

          for (const repo of unlinkedRepos) {
            const fullName = extractGithubRepoFullName(repo.url);
            if (!fullName) continue;

            try {
              await linkRepoToInstallation({
                installationId: upserted.id,
                repoId: repo.id,
                githubRepoFullName: fullName,
              });
              autoLinked++;
            } catch (linkErr) {
              logger.warn(
                { repoId: repo.id, repoName: repo.name, error: linkErr },
                "Failed to auto-link repo to new GitHub installation (skipping)",
              );
            }
          }

          if (autoLinked > 0) {
            logger.info(
              { connectionId: upserted.id, orgId, autoLinked, total: unlinkedRepos.length },
              "Auto-linked existing repos to new GitHub installation",
            );
          }
        } catch (autoLinkErr) {
          // Non-fatal: the connection was created successfully, auto-link is best-effort
          logger.error(autoLinkErr, "Failed to auto-link repos after connecting GitHub installation");
        }

        // Fire-and-forget: trigger initial sync for all projects with linked repos
        try {
          const projectIds = await getProjectIdsWithLinkedRepos(upserted.id);
          if (projectIds.length > 0) {
            const installationPayload = [{
              id: upserted.id,
              installationId: targetInstallation.id,
            }];

            // Intentionally not awaited -- background sync must not block the HTTP response
            void Promise.allSettled(
              projectIds.map((projectId) =>
                syncProjectGithubData(projectId, installationPayload),
              ),
            ).then((results) => {
              const succeeded = results.filter((r) => r.status === "fulfilled").length;
              logger.info(
                { projectCount: results.length, succeeded, orgId, connectionId: upserted.id },
                "Background auto-sync completed after GitHub connection",
              );
            }).catch((err) => {
              logger.error(err, "Background auto-sync failed after GitHub connection");
            });
          }
        } catch (syncDiscoveryErr) {
          // Non-fatal: connection and auto-link succeeded, sync discovery is best-effort
          logger.error(syncDiscoveryErr, "Failed to discover projects for auto-sync after GitHub connection");
        }
      }

      return successResponse(upserted);
    } catch (error) {
      logger.error(error, "Failed to connect GitHub installation");
      set.status = 500;
      return errorResponse(
        `Failed to connect installation: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }, {
    body: t.Object({
      installationId: t.Number(),
    }),
  })

  // GET /github/installations — List all GitHub App installations connected to this workspace
  .get("/installations", async ({ activeWorkspace }) => {
    const orgId = (activeWorkspace as { id: string }).id;
    const installations = await getInstallations({ scopeId: orgId, isActive: true });

    return successResponse(installations);
  })

  // GET /github/installations/:installationId/repos — List repos available to an installation
  .get("/installations/:installationId/repos", async ({ params, query, set, activeWorkspace }) => {
    if (!(await isGithubConfiguredAsync())) {
      set.status = 400;
      return errorResponse(GITHUB_APP_NOT_CONFIGURED_MESSAGE);
    }

    const orgId = (activeWorkspace as { id: string }).id;
    const connection = await getInstallationByGithubId(
      Number(params.installationId), orgId
    );

    if (!connection) {
      set.status = 404;
      return notFoundResponse("Installation");
    }

    const { installationId: ghInstallationId } = extractGithubFields(connection);
    const page = query.page ? parseInt(query.page, 10) : 1;
    const perPage = query.per_page ? parseInt(query.per_page, 10) : 100;

    const result = await fetchInstallationRepositories(
      ghInstallationId,
      page,
      perPage
    );

    return successResponse(result.repositories, {
      total: result.total_count,
      page,
      perPage,
    });
  }, {
    params: t.Object({
      installationId: t.String(),
    }),
    query: t.Object({
      page: t.Optional(t.String()),
      per_page: t.Optional(t.String()),
    }),
  })

  // POST /github/installations/:installationId/repos — Create a new repository
  .post("/installations/:installationId/repos", async ({ params, body, set, user, activeWorkspace }) => {
    if (!(await isGithubConfiguredAsync())) {
      set.status = 400;
      return errorResponse(GITHUB_APP_NOT_CONFIGURED_MESSAGE);
    }

    const orgId = (activeWorkspace as { id: string }).id;
    const userId = (user as { id: string }).id;

    // Validate repo name: only alphanumeric, hyphens, underscores, dots
    const REPO_NAME_REGEX = /^[a-zA-Z0-9._-]+$/;
    if (!REPO_NAME_REGEX.test(body.name)) {
      set.status = 400;
      return errorResponse(
        "Invalid repository name. Only alphanumeric characters, hyphens, underscores, and dots are allowed."
      );
    }

    const connection = await getInstallationByGithubId(
      Number(params.installationId), orgId
    );

    if (!connection) {
      set.status = 404;
      return notFoundResponse("Installation");
    }

    const { installationId: ghInstallationId, accountLogin, accountType } =
      extractGithubFields(connection);

    const repoOptions = {
      name: body.name,
      description: body.description,
      isPrivate: body.isPrivate,
      autoInit: body.autoInit,
    };

    try {
      // Always try the installation token first (works for orgs; works for
      // personal accounts if the GitHub App has administration:write).
      const repo = await createRepository(
        ghInstallationId,
        accountLogin,
        accountType as "user" | "organization",
        repoOptions
      );

      set.status = 201;
      return successResponse(repo);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const is403 = message.includes("403");

      // For personal accounts, installation tokens may lack permission to
      // create repos (POST /user/repos returns 403). Fall back to the
      // user's GitHub OAuth token if available.
      if (is403 && accountType === "user") {
        try {
          const oauthConnection = await findActiveConnection("github", "user", userId);
          if (oauthConnection) {
            const { credentials } = await refreshOAuthCredentials(oauthConnection, env.ENCRYPTION_KEY!);
            const repo = await createRepositoryWithUserToken(credentials.apiKey as string, repoOptions);
            set.status = 201;
            return successResponse(repo);
          }
        } catch (oauthError) {
          logger.error(
            { userId, error: oauthError instanceof Error ? oauthError.message : String(oauthError) },
            "OAuth fallback for repo creation also failed"
          );
        }
      }

      logger.error(
        { installationId: params.installationId, name: body.name, error: message },
        "Failed to create repository via GitHub API"
      );
      const is401 = message.includes("401");
      set.status = is401 ? 401 : 500;
      return errorResponse(
        is401
          ? "GitHub token expired or revoked. Please reconnect your GitHub account."
          : `Failed to create repository: ${message}`,
        is401 ? 401 : 500,
        is401 ? "GITHUB_TOKEN_EXPIRED" : undefined,
      );
    }
  }, {
    params: t.Object({
      installationId: t.String(),
    }),
    body: t.Object({
      name: t.String(),
      description: t.Optional(t.String()),
      isPrivate: t.Optional(t.Boolean()),
      autoInit: t.Optional(t.Boolean()),
    }),
  })

  // POST /github/user/repos — Create a repository in the user's personal GitHub account via OAuth token
  .post("/user/repos", async ({ user, body, set }) => {
    const userId = (user as { id: string }).id;

    // Validate repo name: only alphanumeric, hyphens, underscores, dots
    const REPO_NAME_REGEX = /^[a-zA-Z0-9._-]+$/;
    if (!REPO_NAME_REGEX.test(body.name)) {
      set.status = 400;
      return errorResponse(
        "Invalid repository name. Only alphanumeric characters, hyphens, underscores, and dots are allowed."
      );
    }

    // Find the user's active GitHub OAuth connection
    const connection = await findActiveConnection("github", "user", userId);
    if (!connection) {
      set.status = 400;
      return errorResponse(
        "No GitHub OAuth connection found. Please connect your GitHub account first."
      );
    }

    // Decrypt/refresh the OAuth token
    let accessToken: string;
    try {
      const { credentials } = await refreshOAuthCredentials(connection, env.ENCRYPTION_KEY!);
      accessToken = credentials.apiKey as string;
    } catch (error) {
      logger.error(
        { userId, connectionId: connection.id, error: error instanceof Error ? error.message : String(error) },
        "Failed to decrypt/refresh GitHub OAuth credentials"
      );
      set.status = 500;
      return errorResponse("Failed to access GitHub credentials");
    }

    if (!accessToken) {
      set.status = 400;
      return errorResponse("GitHub OAuth token is missing or invalid");
    }

    try {
      const repo = await createRepositoryWithUserToken(accessToken, {
        name: body.name,
        description: body.description,
        isPrivate: body.isPrivate,
        autoInit: body.autoInit,
      });

      set.status = 201;
      return successResponse(repo);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const is401 = message.includes("401");
      logger.error(
        { userId, name: body.name, error: message },
        "Failed to create repository via GitHub user OAuth token"
      );
      set.status = is401 ? 401 : 500;
      return errorResponse(
        is401
          ? "GitHub token expired or revoked. Please reconnect your GitHub account."
          : `Failed to create repository: ${message}`,
        is401 ? 401 : 500,
        is401 ? "GITHUB_TOKEN_EXPIRED" : undefined,
      );
    }
  }, {
    body: t.Object({
      name: t.String(),
      description: t.Optional(t.String()),
      isPrivate: t.Optional(t.Boolean()),
      autoInit: t.Optional(t.Boolean()),
    }),
  })

  // POST /github/installations/:installationId/link — Link a repo to an installation
  .post("/installations/:installationId/link", async ({ params, body, set, activeWorkspace }) => {
    const orgId = (activeWorkspace as { id: string }).id;

    if (!body.repoId || body.repoId.trim() === "") {
      set.status = 400;
      return errorResponse("repoId is required");
    }

    if (!body.githubRepoFullName || body.githubRepoFullName.trim() === "") {
      set.status = 400;
      return errorResponse("githubRepoFullName is required");
    }

    const connection = await getInstallationByGithubId(
      Number(params.installationId), orgId
    );

    if (!connection) {
      set.status = 404;
      return notFoundResponse("Installation");
    }

    // linkRepoToInstallation expects the provider_connections UUID as installationId
    const linked = await linkRepoToInstallation({
      installationId: connection.id,
      repoId: body.repoId,
      githubRepoFullName: body.githubRepoFullName,
      defaultBranch: body.defaultBranch || "main",
    });

    set.status = 201;
    return successResponse(linked);
  }, {
    params: t.Object({
      installationId: t.String(),
    }),
    body: t.Object({
      repoId: t.String(),
      githubRepoFullName: t.String(),
      defaultBranch: t.Optional(t.String()),
    }),
  })

  // DELETE /github/installations/:installationId/unlink/:repoId — Unlink a repo
  .delete("/installations/:installationId/unlink/:repoId", async ({ params, set, activeWorkspace }) => {
    const orgId = (activeWorkspace as { id: string }).id;

    const repoOrgId = await getWorkspaceIdByRepoId(params.repoId);
    if (!repoOrgId || repoOrgId !== orgId) {
      set.status = 404;
      return notFoundResponse("Linked repository");
    }

    const deleted = await unlinkRepo(params.repoId);

    if (!deleted) {
      set.status = 404;
      return notFoundResponse("Linked repository");
    }

    return successResponse({ deleted: true });
  }, {
    params: t.Object({
      installationId: t.String(),
      repoId: t.String(),
    }),
  })

  // ──────────────────────────────────────────────
  // Project-scoped GitHub Data
  // ──────────────────────────────────────────────

  // GET /github/projects/:id/summary — GitHub summary for a project
  .get("/projects/:id/summary", async ({ params, set, activeWorkspace }) => {
    const orgId = (activeWorkspace as { id: string }).id;
    const project = await getProjectById(orgId, params.id);
    if (!project) {
      set.status = 404;
      return notFoundResponse("Project");
    }

    const summary = await getGithubSummaryForProject(params.id);

    if (!summary) {
      set.status = 404;
      return notFoundResponse("Project");
    }

    return successResponse(summary);
  }, {
    params: t.Object({
      id: t.String(),
    }),
  })

  // POST /github/projects/summaries — GitHub summaries for many projects in one call
  // Collapses the per-project N+1 fan-out (one GET /projects/:id/summary each)
  // into a single request. Reuses the exact same per-project logic
  // (getGithubSummaryForProject) and scopes every id to the active workspace.
  .post("/projects/summaries", async ({ body, activeWorkspace }) => {
    const orgId = (activeWorkspace as { id: string }).id;

    const summaries: Record<
      string,
      Awaited<ReturnType<typeof getGithubSummaryForProject>>
    > = {};

    await Promise.all(
      body.projectIds.map(async (projectId) => {
        // Enforce workspace ownership per id, mirroring the single endpoint.
        const project = await getProjectById(orgId, projectId);
        if (!project) return;

        const summary = await getGithubSummaryForProject(projectId);
        if (summary) summaries[projectId] = summary;
      }),
    );

    return successResponse(summaries);
  }, {
    body: t.Object({
      projectIds: t.Array(t.String()),
    }),
  })

  // GET /github/projects/:id/prs — Pull requests for a project
  .get("/projects/:id/prs", async ({ params, query, set, activeWorkspace }) => {
    const orgId = (activeWorkspace as { id: string }).id;
    const project = await getProjectById(orgId, params.id);
    if (!project) {
      set.status = 404;
      return notFoundResponse("Project");
    }

    const prs = await getPullRequestsByProject(params.id, query.state);

    return successResponse(prs);
  }, {
    params: t.Object({
      id: t.String(),
    }),
    query: t.Object({
      state: t.Optional(t.String()),
    }),
  })

  // GET /github/projects/:id/commits — Recent commits for a project
  .get("/projects/:id/commits", async ({ params, query, set, activeWorkspace }) => {
    const orgId = (activeWorkspace as { id: string }).id;
    const project = await getProjectById(orgId, params.id);
    if (!project) {
      set.status = 404;
      return notFoundResponse("Project");
    }

    const limit = query.limit ? parseInt(query.limit, 10) : undefined;
    const commits = await getRecentCommitsByProject(params.id, limit);

    return successResponse(commits);
  }, {
    params: t.Object({
      id: t.String(),
    }),
    query: t.Object({
      limit: t.Optional(t.String()),
    }),
  })

  // GET /github/projects/:id/actions — Workflow runs for a project
  .get("/projects/:id/actions", async ({ params, query, set, activeWorkspace }) => {
    const orgId = (activeWorkspace as { id: string }).id;
    const project = await getProjectById(orgId, params.id);
    if (!project) {
      set.status = 404;
      return notFoundResponse("Project");
    }

    const limit = query.limit ? parseInt(query.limit, 10) : undefined;
    const runs = await getWorkflowRunsByProject(params.id, limit);

    return successResponse(runs);
  }, {
    params: t.Object({
      id: t.String(),
    }),
    query: t.Object({
      limit: t.Optional(t.String()),
    }),
  })

  // GET /github/projects/:id/contributors — Contributors for a project
  .get("/projects/:id/contributors", async ({ params, set, activeWorkspace }) => {
    const orgId = (activeWorkspace as { id: string }).id;
    const project = await getProjectById(orgId, params.id);
    if (!project) {
      set.status = 404;
      return notFoundResponse("Project");
    }

    const contributors = await getContributorsByProject(params.id);

    return successResponse(contributors);
  }, {
    params: t.Object({
      id: t.String(),
    }),
  })

  // GET /github/projects/:id/activity — Recent activity for a project
  .get("/projects/:id/activity", async ({ params, query, set, activeWorkspace }) => {
    const orgId = (activeWorkspace as { id: string }).id;
    const project = await getProjectById(orgId, params.id);
    if (!project) {
      set.status = 404;
      return notFoundResponse("Project");
    }

    const limit = query.limit ? parseInt(query.limit, 10) : undefined;
    const events = await getRecentEventsByProject(params.id, limit);

    return successResponse(events);
  }, {
    params: t.Object({
      id: t.String(),
    }),
    query: t.Object({
      limit: t.Optional(t.String()),
    }),
  })

  // POST /github/projects/:id/sync — Trigger a manual sync for a project
  .post("/projects/:id/sync", async ({ params, activeWorkspace, set }) => {
    const orgId = (activeWorkspace as { id: string }).id;
    const project = await getProjectById(orgId, params.id);
    if (!project) {
      set.status = 404;
      return notFoundResponse("Project");
    }

    const installations = await getInstallations({ scopeId: orgId, isActive: true });

    if (!installations || installations.length === 0) {
      set.status = 400;
      return errorResponse("No GitHub installations found");
    }

    const result = await syncProjectGithubData(
      params.id,
      installations.map((inst) => ({ id: inst.id, installationId: inst.installationId })),
    );

    if (!result.synced) {
      set.status = 404;
      return errorResponse("No linked repositories found for this project");
    }

    return successResponse(result);
  }, {
    params: t.Object({
      id: t.String(),
    }),
  })

  // ──────────────────────────────────────────────
  // Disconnect (soft-delete) a GitHub Installation
  // ──────────────────────────────────────────────

  // DELETE /github/installations/:installationId — Soft-delete a GitHub installation
  // Deactivates the provider connection and cleans up associated repoInstallationLinks.
  .delete("/installations/:installationId", async ({ params, activeWorkspace, set }) => {
    const orgId = (activeWorkspace as { id: string }).id;

    // Look up the connection by its UUID (the param is the provider_connections.id)
    const connection = await getConnectionById(params.installationId);

    if (!connection) {
      set.status = 404;
      return notFoundResponse("GitHub installation");
    }

    // Verify it is a GitHub provider connection
    if (connection.provider !== "github") {
      set.status = 404;
      return notFoundResponse("GitHub installation");
    }

    // Verify ownership: the connection must belong to this workspace
    const isOwner =
      connection.scope === "organization" && connection.scopeId === orgId;

    if (!isOwner) {
      set.status = 404;
      return notFoundResponse("GitHub installation");
    }

    // Clean up associated repo installation links
    await db
      .delete(repoInstallationLinks)
      .where(eq(repoInstallationLinks.connectionId, connection.id));

    // Soft-delete the connection
    const deactivated = await deactivateConnection(connection.id);

    if (!deactivated) {
      set.status = 500;
      return errorResponse("Failed to deactivate GitHub installation");
    }

    wsConnectionManager.broadcastToWorkspace(orgId, {
      type: "connection:updated",
      payload: {
        provider: "github",
        scope: "organization",
        scopeId: orgId,
        connectionId: connection.id,
        action: "disconnected",
      },
    });

    return successResponse({ deleted: true });
  }, {
    params: t.Object({
      installationId: t.String(),
    }),
  });
