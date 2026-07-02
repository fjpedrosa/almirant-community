import { db } from "../../client";
import {
  repoInstallationLinks,
  githubCommits,
  githubPullRequests,
  githubWorkflowRuns,
  githubEvents,
  projectRepositories,
  projects,
  providerConnections,
  member,
  workItems,
} from "../../schema";
import { eq, desc, and, sql, inArray, isNull, isNotNull } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract the GitHub repo full name (owner/repo) from a GitHub URL.
 * Supports various formats:
 *   - https://github.com/owner/repo
 *   - https://github.com/owner/repo.git
 *   - git@github.com:owner/repo.git
 * Returns null if the URL is not a valid GitHub URL.
 */
export const extractGithubRepoFullName = (url: string): string | null => {
  // Try HTTPS format: https://github.com/owner/repo(.git)?
  const httpsMatch = url.match(
    /^https?:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?\/?$/
  );
  if (httpsMatch) return httpsMatch[1]!;

  // Try SSH format: git@github.com:owner/repo(.git)?
  const sshMatch = url.match(
    /^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?\/?$/
  );
  if (sshMatch) return sshMatch[1]!;

  return null;
};

/**
 * Find the first active GitHub provider connection for a given workspace.
 * Returns the connection row or null if none exists.
 */
export const getGithubConnectionForWorkspace = async (
  workspaceId: string,
) => {
  const [row] = await db
    .select()
    .from(providerConnections)
    .where(
      and(
        eq(providerConnections.provider, "github"),
        eq(providerConnections.scope, "organization"),
        eq(providerConnections.scopeId, workspaceId),
        eq(providerConnections.isActive, true),
      ),
    )
    .orderBy(desc(providerConnections.updatedAt))
    .limit(1);

  return row ?? null;
};

/**
 * Find all GitHub-provider project repositories across ALL projects of an
 * workspace that do NOT have a corresponding repo_installation_links record.
 * Used to auto-link repos when a GitHub installation is connected.
 */
export const getUnlinkedGithubReposForWorkspace = async (
  workspaceId: string,
) => {
  const rows = await db
    .select({
      id: projectRepositories.id,
      url: projectRepositories.url,
      name: projectRepositories.name,
    })
    .from(projectRepositories)
    .innerJoin(projects, eq(projectRepositories.projectId, projects.id))
    .leftJoin(
      repoInstallationLinks,
      eq(projectRepositories.id, repoInstallationLinks.repoId),
    )
    .where(
      and(
        eq(projects.workspaceId, workspaceId),
        eq(projectRepositories.provider, "github"),
        isNull(repoInstallationLinks.id),
      ),
    );

  return rows;
};

/**
 * Find all GitHub-provider project repositories for a project that do NOT have
 * a corresponding repo_installation_links record. Used by the repair endpoint.
 */
export const getUnlinkedGithubRepos = async (projectId: string) => {
  const rows = await db
    .select({
      id: projectRepositories.id,
      url: projectRepositories.url,
      name: projectRepositories.name,
    })
    .from(projectRepositories)
    .leftJoin(
      repoInstallationLinks,
      eq(projectRepositories.id, repoInstallationLinks.repoId),
    )
    .where(
      and(
        eq(projectRepositories.projectId, projectId),
        eq(projectRepositories.provider, "github"),
        isNull(repoInstallationLinks.id),
      ),
    );

  return rows;
};

/**
 * Given a projectId, return all repoIds linked through projectRepositories.
 * Returns an empty array when the project has no repositories.
 */
export const getRepoIdsForProject = async (
  projectId: string
): Promise<string[]> => {
  const rows = await db
    .select({ id: projectRepositories.id })
    .from(projectRepositories)
    .where(eq(projectRepositories.projectId, projectId));

  return rows.map((r) => r.id);
};

// ---------------------------------------------------------------------------
// Connection queries (replaces legacy githubInstallations queries)
// ---------------------------------------------------------------------------

/**
 * Get a GitHub provider connection by the numeric GitHub installationId
 * stored in config->>installationId.
 *
 * When `scopeId` is provided the lookup is scoped to that workspace,
 * allowing the same GitHub App installation to be connected to multiple
 * workspaces independently.  Without `scopeId` the first matching active
 * connection is returned (useful for webhook handlers and token caching).
 */
export const getInstallationByGithubId = async (
  installationId: number,
  scopeId?: string,
) => {
  const conditions = [
    eq(providerConnections.provider, "github"),
    eq(providerConnections.isActive, true),
    sql`(${providerConnections.config}->>'installationId')::bigint = ${installationId}`,
  ];

  if (scopeId) {
    conditions.push(eq(providerConnections.scopeId, scopeId));
  }

  const [row] = await db
    .select()
    .from(providerConnections)
    .where(and(...conditions))
    .limit(1);

  return row ?? null;
};

/**
 * Given a projectRepositories.id (repoId), find the linked GitHub provider connection.
 * Returns connection details needed for API calls.
 */
export const getInstallationByRepoId = async (repoId: string) => {
  const [row] = await db
    .select({
      id: providerConnections.id,
      config: providerConnections.config,
      accountIdentifier: providerConnections.accountIdentifier,
      encryptedCredentials: providerConnections.encryptedCredentials,
      credentialsIv: providerConnections.credentialsIv,
      credentialsAuthTag: providerConnections.credentialsAuthTag,
      tokenExpiresAt: providerConnections.tokenExpiresAt,
    })
    .from(repoInstallationLinks)
    .innerJoin(providerConnections, eq(repoInstallationLinks.connectionId, providerConnections.id))
    .where(eq(repoInstallationLinks.repoId, repoId))
    .limit(1);

  if (!row) return null;

  // Extract installationId from config for backward compatibility
  const config = row.config as Record<string, unknown> | null;
  const installationId = config?.installationId as number | undefined;

  return {
    id: row.id,
    installationId: installationId ?? 0,
    accountLogin: row.accountIdentifier ?? "",
    encryptedCredentials: row.encryptedCredentials,
    credentialsIv: row.credentialsIv,
    credentialsAuthTag: row.credentialsAuthTag,
    tokenExpiresAt: row.tokenExpiresAt,
  };
};

/**
 * Update the cached access token on a GitHub provider connection.
 * Looks up the connection by the numeric GitHub installationId in config.
 */
export const updateInstallationToken = async (
  installationId: number,
  token: string,
  expiresAt: Date
) => {
  // Find the connection by installationId in config
  const connection = await getInstallationByGithubId(installationId);
  if (!connection) return null;

  const [updated] = await db
    .update(providerConnections)
    .set({
      config: {
        ...(connection.config as Record<string, unknown> ?? {}),
        accessToken: token,
      },
      tokenExpiresAt: expiresAt,
      updatedAt: new Date(),
    })
    .where(eq(providerConnections.id, connection.id))
    .returning();

  return updated ?? null;
};

// ---------------------------------------------------------------------------
// Upserts (used by github-webhook-handlers.ts)
// ---------------------------------------------------------------------------

export const upsertCommit = async (data: {
  repoId: string;
  sha: string;
  message: string;
  authorLogin?: string | null;
  authorName?: string | null;
  branch?: string | null;
  committedAt: Date;
}) => {
  const [row] = await db
    .insert(githubCommits)
    .values({
      repoId: data.repoId,
      sha: data.sha,
      message: data.message,
      authorLogin: data.authorLogin ?? null,
      authorName: data.authorName ?? null,
      branch: data.branch ?? null,
      committedAt: data.committedAt,
    })
    .onConflictDoUpdate({
      target: [githubCommits.repoId, githubCommits.sha],
      set: {
        message: data.message,
        authorLogin: data.authorLogin ?? null,
        authorName: data.authorName ?? null,
        branch: data.branch ?? null,
        committedAt: data.committedAt,
      },
    })
    .returning();

  return row;
};

export const upsertPullRequest = async (data: {
  repoId: string;
  number: number;
  title: string;
  body?: string | null;
  state?: "open" | "closed" | "merged";
  authorLogin?: string | null;
  authorAvatarUrl?: string | null;
  labels?: unknown;
  baseBranch?: string | null;
  headBranch?: string | null;
  additions?: number;
  deletions?: number;
  htmlUrl?: string | null;
  isDraft?: boolean;
  mergedAt?: Date | null;
  closedAt?: Date | null;
}) => {
  const [row] = await db
    .insert(githubPullRequests)
    .values({
      repoId: data.repoId,
      number: data.number,
      title: data.title,
      body: data.body ?? null,
      state: data.state ?? "open",
      authorLogin: data.authorLogin ?? null,
      authorAvatarUrl: data.authorAvatarUrl ?? null,
      labels: data.labels ?? [],
      baseBranch: data.baseBranch ?? null,
      headBranch: data.headBranch ?? null,
      additions: data.additions ?? 0,
      deletions: data.deletions ?? 0,
      htmlUrl: data.htmlUrl ?? null,
      isDraft: data.isDraft ?? false,
      mergedAt: data.mergedAt ?? null,
      closedAt: data.closedAt ?? null,
    })
    .onConflictDoUpdate({
      target: [githubPullRequests.repoId, githubPullRequests.number],
      set: {
        title: data.title,
        body: data.body ?? null,
        state: data.state ?? "open",
        authorLogin: data.authorLogin ?? null,
        authorAvatarUrl: data.authorAvatarUrl ?? null,
        labels: data.labels ?? [],
        baseBranch: data.baseBranch ?? null,
        headBranch: data.headBranch ?? null,
        additions: data.additions ?? 0,
        deletions: data.deletions ?? 0,
        htmlUrl: data.htmlUrl ?? null,
        isDraft: data.isDraft ?? false,
        mergedAt: data.mergedAt ?? null,
        closedAt: data.closedAt ?? null,
        updatedAt: new Date(),
      },
    })
    .returning();

  return row;
};

export const upsertWorkflowRun = async (data: {
  repoId: string;
  runId: number;
  name?: string | null;
  status?: string | null;
  conclusion?: string | null;
  branch?: string | null;
  headSha?: string | null;
  htmlUrl?: string | null;
  event?: string | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
}) => {
  const [row] = await db
    .insert(githubWorkflowRuns)
    .values({
      repoId: data.repoId,
      runId: data.runId,
      name: data.name ?? null,
      status: data.status ?? null,
      conclusion: data.conclusion ?? null,
      branch: data.branch ?? null,
      headSha: data.headSha ?? null,
      htmlUrl: data.htmlUrl ?? null,
      event: data.event ?? null,
      startedAt: data.startedAt ?? null,
      completedAt: data.completedAt ?? null,
    })
    .onConflictDoUpdate({
      target: [githubWorkflowRuns.repoId, githubWorkflowRuns.runId],
      set: {
        name: data.name ?? null,
        status: data.status ?? null,
        conclusion: data.conclusion ?? null,
        branch: data.branch ?? null,
        headSha: data.headSha ?? null,
        htmlUrl: data.htmlUrl ?? null,
        event: data.event ?? null,
        startedAt: data.startedAt ?? null,
        completedAt: data.completedAt ?? null,
      },
    })
    .returning();

  return row;
};

export const createGithubEvent = async (data: {
  repoId: string;
  eventType: "push" | "pull_request" | "pull_request_review" | "check_run" | "workflow_run" | "installation" | "deployment";
  action?: string | null;
  actorLogin?: string | null;
  actorAvatarUrl?: string | null;
  summary?: string | null;
  payload?: unknown;
  githubDeliveryId?: string | null;
}) => {
  const [row] = await db
    .insert(githubEvents)
    .values({
      repoId: data.repoId,
      eventType: data.eventType,
      action: data.action ?? null,
      actorLogin: data.actorLogin ?? null,
      actorAvatarUrl: data.actorAvatarUrl ?? null,
      summary: data.summary ?? null,
      payload: data.payload ?? {},
      githubDeliveryId: data.githubDeliveryId ?? null,
    })
    .returning();

  return row;
};

/**
 * Upsert a GitHub installation as a provider connection.
 * Uses the numeric installationId stored in config->>installationId
 * as the conflict detection key.
 */
export const upsertInstallation = async (data: {
  installationId: number;
  accountLogin: string;
  accountType?: "user" | "organization";
  accountAvatarUrl?: string | null;
  permissions?: unknown;
  repositorySelection?: string | null;
  workspaceId?: string;
}) => {
  // Check if a connection already exists for this GitHub installationId
  // When workspaceId is known, scope the lookup so that connecting the
  // same GitHub App installation to a different workspace creates a separate
  // provider_connections row instead of overwriting the existing one.
  const existing = data.workspaceId
    ? await getInstallationByGithubId(data.installationId, data.workspaceId)
    : await getInstallationByGithubId(data.installationId);

  if (existing) {
    // Update the existing connection
    const existingConfig = (existing.config as Record<string, unknown>) ?? {};
    const [updated] = await db
      .update(providerConnections)
      .set({
        name: `GitHub: ${data.accountLogin}`,
        accountIdentifier: data.accountLogin,
        // Always update scopeId when we have org context from the caller
        ...(data.workspaceId ? { scopeId: data.workspaceId } : {}),
        config: {
          ...existingConfig,
          installationId: data.installationId,
          accountType: data.accountType ?? "user",
          accountAvatarUrl: data.accountAvatarUrl ?? null,
          permissions: data.permissions ?? {},
          repositorySelection: data.repositorySelection ?? null,
        },
        updatedAt: new Date(),
      })
      .where(eq(providerConnections.id, existing.id))
      .returning();

    return updated;
  }

  // Create a new connection
  // NOTE: We use a placeholder scopeId here since we may not know the org yet.
  // The migration script or caller should set the proper scopeId.
  const [row] = await db
    .insert(providerConnections)
    .values({
      provider: "github",
      category: "code",
      scope: "organization",
      scopeId: data.workspaceId ?? "pending",
      name: `GitHub: ${data.accountLogin}`,
      accountIdentifier: data.accountLogin,
      config: {
        installationId: data.installationId,
        accountType: data.accountType ?? "user",
        accountAvatarUrl: data.accountAvatarUrl ?? null,
        permissions: data.permissions ?? {},
        repositorySelection: data.repositorySelection ?? null,
      },
      isActive: true,
    })
    .returning();

  return row;
};

/**
 * Update the scopeId (workspace) of a GitHub provider connection.
 * Used when connecting an installation to a specific workspace.
 */
export const updateInstallationScopeId = async (
  connectionId: string,
  scopeId: string
) => {
  const [updated] = await db
    .update(providerConnections)
    .set({
      scopeId,
      updatedAt: new Date(),
    })
    .where(eq(providerConnections.id, connectionId))
    .returning();

  return updated ?? null;
};

export const deleteInstallationByGithubId = async (
  installationId: number
): Promise<boolean> => {
  const connection = await getInstallationByGithubId(installationId);
  if (!connection) return false;

  const result = await db
    .delete(providerConnections)
    .where(eq(providerConnections.id, connection.id))
    .returning();

  return result.length > 0;
};

export const getRepoIdByGithubFullName = async (
  fullName: string
): Promise<string | null> => {
  const [row] = await db
    .select({ repoId: repoInstallationLinks.repoId })
    .from(repoInstallationLinks)
    .where(eq(repoInstallationLinks.githubRepoFullName, fullName))
    .limit(1);

  return row?.repoId ?? null;
};

export const getGithubRepoFullNameByRepoId = async (
  repoId: string
): Promise<string | null> => {
  const [row] = await db
    .select({ githubRepoFullName: repoInstallationLinks.githubRepoFullName })
    .from(repoInstallationLinks)
    .where(eq(repoInstallationLinks.repoId, repoId))
    .limit(1);

  return row?.githubRepoFullName ?? null;
};

export const getProjectIdByRepoId = async (
  repoId: string
): Promise<string | null> => {
  const [row] = await db
    .select({ projectId: projectRepositories.projectId })
    .from(projectRepositories)
    .where(eq(projectRepositories.id, repoId))
    .limit(1);

  return row?.projectId ?? null;
};

/**
 * Given a projectRepositories.id (repoId), resolve the workspaceId
 * by joining projectRepositories -> projects.
 * Returns null if the repo or project is not found, or if workspaceId is not set.
 */
export const getWorkspaceIdByRepoId = async (
  repoId: string
): Promise<string | null> => {
  const [row] = await db
    .select({ workspaceId: projects.workspaceId })
    .from(projectRepositories)
    .innerJoin(projects, eq(projectRepositories.projectId, projects.id))
    .where(eq(projectRepositories.id, repoId))
    .limit(1);

  return row?.workspaceId ?? null;
};

/**
 * Resolve a workspace member userId from a GitHub login (accountIdentifier)
 * tied to a user-scoped GitHub provider connection.
 */
export const getWorkspaceMemberUserIdByGithubLogin = async (
  workspaceId: string,
  githubLogin: string
): Promise<string | null> => {
  const normalizedLogin = githubLogin.trim().toLowerCase();
  if (!normalizedLogin) return null;

  const [row] = await db
    .select({ userId: member.userId })
    .from(member)
    .innerJoin(
      providerConnections,
      and(
        eq(providerConnections.scope, "user"),
        eq(providerConnections.scopeId, member.userId),
        eq(providerConnections.provider, "github"),
        eq(providerConnections.isActive, true)
      )
    )
    .where(
      and(
        eq(member.workspaceId, workspaceId),
        sql`lower(${providerConnections.accountIdentifier}) = ${normalizedLogin}`
      )
    )
    .limit(1);

  return row?.userId ?? null;
};

/**
 * Given a projectRepositories.id (repoId), resolve the docsPath.
 * Returns the docsPath value or null (caller falls back to "docs/").
 */
export const getDocsPathByRepoId = async (
  repoId: string
): Promise<string | null> => {
  const [row] = await db
    .select({ docsPath: projectRepositories.docsPath })
    .from(projectRepositories)
    .where(eq(projectRepositories.id, repoId))
    .limit(1);

  return row?.docsPath ?? null;
};

/**
 * Given a projectId, resolve the docsPath from the first associated repository.
 * Returns the docsPath value or null (caller falls back to "docs/").
 */
export const getDocsPathByProjectId = async (
  projectId: string
): Promise<string | null> => {
  const [row] = await db
    .select({ docsPath: projectRepositories.docsPath })
    .from(projectRepositories)
    .where(eq(projectRepositories.projectId, projectId))
    .limit(1);

  return row?.docsPath ?? null;
};

/**
 * Given a repo full name, find the numeric GitHub installation ID
 * by joining repoInstallationLinks -> providerConnections and reading config->>installationId.
 */
export const getGithubInstallationIdByRepoFullName = async (
  fullName: string
): Promise<number | null> => {
  const [row] = await db
    .select({ config: providerConnections.config })
    .from(repoInstallationLinks)
    .innerJoin(providerConnections, eq(repoInstallationLinks.connectionId, providerConnections.id))
    .where(eq(repoInstallationLinks.githubRepoFullName, fullName))
    .limit(1);

  if (!row) return null;

  const config = row.config as Record<string, unknown> | null;
  const installationId = config?.installationId;
  return typeof installationId === "number" ? installationId : null;
};

export const updatePullRequestReviewStatus = async (
  repoId: string,
  prNumber: number,
  status: string
) => {
  const [updated] = await db
    .update(githubPullRequests)
    .set({
      reviewStatus: status as "pending" | "approved" | "changes_requested" | "commented" | "dismissed",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(githubPullRequests.repoId, repoId),
        eq(githubPullRequests.number, prNumber)
      )
    )
    .returning();

  return updated ?? null;
};

export const updatePullRequestCiStatus = async (
  repoId: string,
  headBranch: string,
  status: string
) => {
  const updated = await db
    .update(githubPullRequests)
    .set({
      ciStatus: status as "pending" | "queued" | "in_progress" | "success" | "failure" | "cancelled" | "skipped" | "neutral",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(githubPullRequests.repoId, repoId),
        eq(githubPullRequests.headBranch, headBranch)
      )
    )
    .returning();

  return updated;
};

/**
 * Given a provider_connections UUID (connectionId), return all distinct project IDs
 * that have at least one repo linked through repoInstallationLinks.
 * Used to discover which projects should be synced after connecting a GitHub installation.
 */
export const getProjectIdsWithLinkedRepos = async (
  connectionId: string,
): Promise<string[]> => {
  const rows = await db
    .selectDistinct({ projectId: projectRepositories.projectId })
    .from(repoInstallationLinks)
    .innerJoin(
      projectRepositories,
      eq(repoInstallationLinks.repoId, projectRepositories.id),
    )
    .where(eq(repoInstallationLinks.connectionId, connectionId));

  return rows.map((r) => r.projectId);
};

// ---------------------------------------------------------------------------
// Route queries (used by github.routes.ts)
// ---------------------------------------------------------------------------

/**
 * Get all GitHub provider connections (replaces getInstallations).
 * Returns rows with installationId extracted from config for backward compatibility.
 *
 * Accepts optional filters to narrow results by scopeId and/or isActive flag.
 */
export const getInstallations = async (filters?: {
  scopeId?: string;
  isActive?: boolean;
}) => {
  const conditions = [eq(providerConnections.provider, "github")];

  if (filters?.scopeId) {
    conditions.push(eq(providerConnections.scopeId, filters.scopeId));
  }
  if (filters?.isActive !== undefined) {
    conditions.push(eq(providerConnections.isActive, filters.isActive));
  }

  const rows = await db
    .select()
    .from(providerConnections)
    .where(and(...conditions))
    .orderBy(desc(providerConnections.createdAt));

  return rows.map((row) => {
    const config = (row.config as Record<string, unknown>) ?? {};
    return {
      ...row,
      // Backward-compatible fields from the old githubInstallations table
      installationId: (config.installationId as number) ?? 0,
      accountLogin: row.accountIdentifier ?? "",
      accountType: (config.accountType as string) ?? "user",
      accountAvatarUrl: (config.accountAvatarUrl as string | null) ?? null,
      permissions: (config.permissions as Record<string, string>) ?? {},
      repositorySelection: (config.repositorySelection as string | null) ?? null,
    };
  });
};

/**
 * Get only the installationIds of all active GitHub connections across all orgs.
 * Returns a lightweight number[] without loading sensitive config/credentials.
 */
export const getConnectedInstallationIds = async (): Promise<number[]> => {
  const rows = await db
    .select({
      installationId: sql<number>`(${providerConnections.config}->>'installationId')::int`,
    })
    .from(providerConnections)
    .where(
      and(
        eq(providerConnections.provider, "github"),
        eq(providerConnections.isActive, true)
      )
    );
  return rows
    .map((r) => r.installationId)
    .filter((id): id is number => id !== null);
};

export const linkRepoToInstallation = async (data: {
  installationId: string; // This is the providerConnections.id (UUID)
  repoId: string;
  githubRepoFullName: string;
  defaultBranch?: string;
}) => {
  const [row] = await db
    .insert(repoInstallationLinks)
    .values({
      connectionId: data.installationId,
      repoId: data.repoId,
      githubRepoFullName: data.githubRepoFullName,
      defaultBranch: data.defaultBranch ?? "main",
    })
    .returning();

  return row;
};

export const unlinkRepo = async (repoId: string): Promise<boolean> => {
  const result = await db
    .delete(repoInstallationLinks)
    .where(eq(repoInstallationLinks.repoId, repoId))
    .returning();

  return result.length > 0;
};

export const getLinkedReposByInstallation = async (
  connectionId: string
) => {
  return db
    .select()
    .from(repoInstallationLinks)
    .where(eq(repoInstallationLinks.connectionId, connectionId));
};

// ---------------------------------------------------------------------------
// Project-level aggregation queries (used by github.routes.ts)
// ---------------------------------------------------------------------------

export const getGithubSummaryForProject = async (projectId: string) => {
  const repoIds = await getRepoIdsForProject(projectId);
  if (repoIds.length === 0) return null;

  const [openPrsResult, latestCommitResult, latestWorkflowResult, totalCommitsResult, contributorsResult] =
    await Promise.all([
      // Count open PRs
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(githubPullRequests)
        .where(
          and(
            inArray(githubPullRequests.repoId, repoIds),
            eq(githubPullRequests.state, "open")
          )
        ),

      // Latest commit date
      db
        .select({ committedAt: githubCommits.committedAt })
        .from(githubCommits)
        .where(inArray(githubCommits.repoId, repoIds))
        .orderBy(desc(githubCommits.committedAt))
        .limit(1),

      // Latest workflow run conclusion
      db
        .select({ conclusion: githubWorkflowRuns.conclusion })
        .from(githubWorkflowRuns)
        .where(inArray(githubWorkflowRuns.repoId, repoIds))
        .orderBy(desc(githubWorkflowRuns.createdAt))
        .limit(1),

      // Total commits count
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(githubCommits)
        .where(inArray(githubCommits.repoId, repoIds)),

      // Distinct contributors count
      db
        .select({ count: sql<number>`count(distinct ${githubCommits.authorLogin})::int` })
        .from(githubCommits)
        .where(inArray(githubCommits.repoId, repoIds)),
    ]);

  return {
    openPrs: openPrsResult[0]?.count ?? 0,
    latestCommitDate: latestCommitResult[0]?.committedAt ?? null,
    latestWorkflowConclusion: latestWorkflowResult[0]?.conclusion ?? null,
    totalCommits: totalCommitsResult[0]?.count ?? 0,
    totalContributors: contributorsResult[0]?.count ?? 0,
  };
};

export const getPullRequestsByProject = async (
  projectId: string,
  state?: string
) => {
  const repoIds = await getRepoIdsForProject(projectId);
  if (repoIds.length === 0) return [];

  const conditions = [inArray(githubPullRequests.repoId, repoIds)];
  if (state) {
    conditions.push(
      eq(githubPullRequests.state, state as "open" | "closed" | "merged")
    );
  }

  return db
    .select()
    .from(githubPullRequests)
    .where(and(...conditions))
    .orderBy(desc(githubPullRequests.updatedAt));
};

export const getRecentCommitsByProject = async (
  projectId: string,
  limit: number = 30
) => {
  const repoIds = await getRepoIdsForProject(projectId);
  if (repoIds.length === 0) return [];

  return db
    .select()
    .from(githubCommits)
    .where(inArray(githubCommits.repoId, repoIds))
    .orderBy(desc(githubCommits.committedAt))
    .limit(limit);
};

export const getWorkflowRunsByProject = async (
  projectId: string,
  limit: number = 20
) => {
  const repoIds = await getRepoIdsForProject(projectId);
  if (repoIds.length === 0) return [];

  return db
    .select()
    .from(githubWorkflowRuns)
    .where(inArray(githubWorkflowRuns.repoId, repoIds))
    .orderBy(desc(githubWorkflowRuns.createdAt))
    .limit(limit);
};

export const getContributorsByProject = async (projectId: string) => {
  const repoIds = await getRepoIdsForProject(projectId);
  if (repoIds.length === 0) return [];

  const normalizedLogin = sql<string>`lower(${githubCommits.authorLogin})`;

  const rows = await db
    .select({
      login: normalizedLogin.as("login"),
      avatarUrl: sql<string | null>`max(${githubCommits.authorAvatarUrl})`.as(
        "avatar_url"
      ),
      name: sql<string | null>`max(${githubCommits.authorName})`.as("name"),
      commitCount: sql<number>`count(*)::int`,
    })
    .from(githubCommits)
    .where(
      and(
        inArray(githubCommits.repoId, repoIds),
        isNotNull(githubCommits.authorLogin)
      )
    )
    .groupBy(normalizedLogin)
    .orderBy(sql`count(*) desc`);

  return rows;
};

export const getRecentEventsByProject = async (
  projectId: string,
  limit: number = 50
) => {
  const repoIds = await getRepoIdsForProject(projectId);
  if (repoIds.length === 0) return [];

  return db
    .select()
    .from(githubEvents)
    .where(inArray(githubEvents.repoId, repoIds))
    .orderBy(desc(githubEvents.createdAt))
    .limit(limit);
};

// ---------------------------------------------------------------------------
// Commits by branch & repo
// ---------------------------------------------------------------------------

export const getCommitsByBranchAndRepo = async (
  repoId: string,
  branch: string
): Promise<Array<{ commitId: string; message: string }>> => {
  const rows = await db
    .select({ commitId: githubCommits.id, message: githubCommits.message })
    .from(githubCommits)
    .where(and(eq(githubCommits.repoId, repoId), eq(githubCommits.branch, branch)));
  return rows;
};

// ---------------------------------------------------------------------------
// PR state reconciliation
// ---------------------------------------------------------------------------

/**
 * Find work items whose `metadata.pullRequest` state is stale compared to
 * the `github_pull_requests` table.
 *
 * Returns rows where the work item has a `metadata->'pullRequest'->'number'`
 * value that matches a PR in the given repo whose DB state differs from
 * the value stored in the work item metadata.
 *
 * This enables idempotent reconciliation: only work items that actually need
 * an update are returned.
 */
export const getWorkItemsWithStalePrState = async (
  repoId: string
): Promise<
  Array<{
    workItemId: string;
    workspaceId: string;
    currentMetadata: Record<string, unknown>;
    prNumber: number;
    prState: "open" | "closed" | "merged";
    prHtmlUrl: string | null;
    prHeadBranch: string | null;
  }>
> => {
  const rows = await db
    .select({
      workItemId: workItems.id,
      workspaceId: projects.workspaceId,
      currentMetadata: workItems.metadata,
      prNumber: githubPullRequests.number,
      prState: githubPullRequests.state,
      prHtmlUrl: githubPullRequests.htmlUrl,
      prHeadBranch: githubPullRequests.headBranch,
    })
    .from(workItems)
    .innerJoin(projects, eq(workItems.projectId, projects.id))
    .innerJoin(projectRepositories, eq(projectRepositories.projectId, projects.id))
    .innerJoin(
      githubPullRequests,
      and(
        eq(githubPullRequests.repoId, projectRepositories.id),
        sql`(${workItems.metadata}->'pullRequest'->>'number')::int = ${githubPullRequests.number}`
      )
    )
    .where(
      and(
        eq(projectRepositories.id, repoId),
        isNotNull(sql`${workItems.metadata}->'pullRequest'`),
        sql`${workItems.metadata}->'pullRequest'->>'state' IS DISTINCT FROM ${githubPullRequests.state}`
      )
    );

  return rows.flatMap((r) =>
    r.workspaceId
      ? [{
          workItemId: r.workItemId,
          workspaceId: r.workspaceId,
          currentMetadata: (r.currentMetadata ?? {}) as Record<string, unknown>,
          prNumber: r.prNumber,
          prState: r.prState as "open" | "closed" | "merged",
          prHtmlUrl: r.prHtmlUrl,
          prHeadBranch: r.prHeadBranch,
        }]
      : [],
  );
};
