import jwt from "jsonwebtoken";
import { createHmac, timingSafeEqual } from "crypto";
import { logger } from "@almirant/config";
import {
  getInstallationByGithubId,
  getInstallationByRepoId,
  getRepoIdByGithubFullName,
  updateInstallationToken,
} from "@almirant/database";
import { getGithubAppCredentials } from "../../../instance/services/github-app-credentials-service";

// ---- Constants ----

const GITHUB_API_BASE = "https://api.github.com";
const JWT_EXPIRY_SECONDS = 600; // 10 minutes
// Must exceed the runner's TOKEN_REFRESH_INTERVAL_MS (25 min in
// services/runner/src/shared/token-refresh.ts). Returning a cached token with
// less life remaining than that interval lets it expire mid-job: the runner
// won't tick the next refresh before the push hits 401. Keep this >= the
// runner interval + headroom for long ops (rebases, GitHub p99 latency).
const TOKEN_REFRESH_MARGIN_MS = 30 * 60 * 1000; // Refresh 30 min before expiry

// ---- GitHub API response types ----

interface GithubAccessTokenResponse {
  token: string;
  expires_at: string;
  permissions: Record<string, string>;
}

interface GithubCommitResponse {
  sha: string;
  commit: {
    message: string;
    author: {
      name: string;
      email: string;
      date: string;
    };
  };
  author: {
    login: string;
    avatar_url: string;
  } | null;
  html_url: string;
  stats?: {
    additions: number;
    deletions: number;
  };
}

interface GithubPullRequestResponse {
  number: number;
  title: string;
  body: string | null;
  state: string;
  draft: boolean;
  user: {
    login: string;
    avatar_url: string;
  } | null;
  labels: Array<{ name: string }>;
  base: { ref: string };
  head: { ref: string };
  additions: number;
  deletions: number;
  html_url: string;
  created_at: string;
  updated_at: string;
  merged_at: string | null;
  closed_at: string | null;
}

interface GithubWorkflowRunResponse {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  head_branch: string;
  head_sha: string;
  html_url: string;
  event: string;
  run_started_at: string | null;
  updated_at: string;
}

interface GithubWorkflowRunsResponse {
  total_count: number;
  workflow_runs: GithubWorkflowRunResponse[];
}

interface GithubInstallationRepositoriesResponse {
  total_count: number;
  repositories: GithubRepositoryResponse[];
}

interface GithubRepositoryResponse {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  private: boolean;
  html_url: string;
  default_branch: string;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  pushed_at: string;
  created_at: string;
  updated_at: string;
  topics: string[];
  visibility: string;
  owner: {
    login: string;
    avatar_url: string;
  };
}

// ---- Configuration check ----

/**
 * Returns the last known GitHub App configuration state.
 *
 * IMPORTANT: this is intentionally synchronous for legacy callers, so it can be
 * stale after runtime DB credential changes. New request handlers should call
 * isGithubConfiguredAsync() before rejecting a GitHub App operation.
 */
export const isGithubConfigured = (): boolean => isGithubConfiguredSync;

/**
 * Authoritative GitHub App configuration check. Reads DB-backed instance
 * credentials first, then env fallback, and refreshes the synchronous snapshot.
 */
export const isGithubConfiguredAsync = async (): Promise<boolean> => {
  const result = await getGithubAppCredentials();
  isGithubConfiguredSync = result !== null;
  return isGithubConfiguredSync;
};

// Module-level warm-up: set the sync flag from env immediately, then
// re-check from DB asynchronously and update the flag.
let isGithubConfiguredSync = Boolean(
  process.env.GITHUB_APP_ID && process.env.GITHUB_PRIVATE_KEY,
);

// Warm up the configured flag from DB on module load (fire-and-forget)
void getGithubAppCredentials()
  .then((result) => {
    isGithubConfiguredSync = result !== null;
  })
  .catch(() => {
    /* non-fatal — env fallback already set */
  });

// ---- JWT generation ----

/**
 * Generate a JWT for the GitHub App. Reads credentials from DB first, then env.
 * Throws if no credentials are configured anywhere.
 */
export const generateAppJwt = async (): Promise<string> => {
  const result = await getGithubAppCredentials();
  if (!result) {
    throw new Error(
      "GitHub App not configured. Visit /settings/github to set it up.",
    );
  }

  const { credentials } = result;
  const now = Math.floor(Date.now() / 1000);

  const payload = {
    iat: now - 60, // Issued 60s in the past to account for clock drift
    exp: now + JWT_EXPIRY_SECONDS,
    iss: credentials.appId,
  };

  return jwt.sign(payload, credentials.privateKeyPem, { algorithm: "RS256" });
};

// ---- Installation access token ----

export const getInstallationAccessToken = async (
  installationId: number
): Promise<string> => {
  try {
    // Check DB for a cached token stored in provider_connections.config.accessToken
    const connection = await getInstallationByGithubId(installationId);

    if (connection) {
      const config = (connection.config as Record<string, unknown>) ?? {};
      const cachedToken = config.accessToken as string | undefined;

      if (
        cachedToken &&
        connection.tokenExpiresAt &&
        new Date(connection.tokenExpiresAt).getTime() > Date.now() + TOKEN_REFRESH_MARGIN_MS
      ) {
        return cachedToken;
      }
    }

    // Token is missing or about to expire -- request a fresh one
    const appJwt = await generateAppJwt();

    const response = await fetch(
      `${GITHUB_API_BASE}/app/installations/${installationId}/access_tokens`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${appJwt}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
      }
    );

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `GitHub API returned ${response.status} when requesting installation token: ${errorBody}`
      );
    }

    const data = (await response.json()) as GithubAccessTokenResponse;

    // Persist in DB (stored in config.accessToken on the provider_connections row)
    await updateInstallationToken(
      installationId,
      data.token,
      new Date(data.expires_at)
    );

    logger.info(
      { installationId, expiresAt: data.expires_at },
      "Refreshed GitHub installation access token"
    );

    return data.token;
  } catch (error) {
    logger.error(
      { installationId, error: error instanceof Error ? error.message : String(error) },
      "Failed to obtain GitHub installation access token"
    );
    throw error;
  }
};

// ---- Authenticated GitHub fetch ----

export const fetchFromGithub = async <T>(
  installationId: number,
  path: string
): Promise<T> => {
  try {
    const token = await getInstallationAccessToken(installationId);
    const url = path.startsWith("http") ? path : `${GITHUB_API_BASE}${path}`;

    const response = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `GitHub API ${response.status} on GET ${path}: ${errorBody}`
      );
    }

    return (await response.json()) as T;
  } catch (error) {
    logger.error(
      { installationId, path, error: error instanceof Error ? error.message : String(error) },
      "GitHub API request failed"
    );
    throw error;
  }
};

// ---- Authenticated GitHub mutate (POST/PUT/PATCH/DELETE) ----

export const mutateGithub = async <T>(
  installationId: number,
  path: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  body?: unknown
): Promise<T> => {
  try {
    const token = await getInstallationAccessToken(installationId);
    const url = path.startsWith("http") ? path : `${GITHUB_API_BASE}${path}`;

    const response = await fetch(url, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body !== undefined && { "Content-Type": "application/json" }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `GitHub API ${response.status} on ${method} ${path}: ${errorBody}`
      );
    }

    // Some DELETE endpoints return 204 No Content
    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  } catch (error) {
    logger.error(
      { installationId, path, method, error: error instanceof Error ? error.message : String(error) },
      "GitHub API mutation request failed"
    );
    throw error;
  }
};

// ---- Repository creation ----

export interface GithubCreateRepoResponse {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  default_branch: string;
  private: boolean;
  description: string | null;
}

interface CreateRepositoryOptions {
  name: string;
  description?: string;
  isPrivate?: boolean;
  autoInit?: boolean;
}

export const createRepository = async (
  installationId: number,
  owner: string,
  accountType: "user" | "organization",
  options: CreateRepositoryOptions
): Promise<GithubCreateRepoResponse> => {
  const path =
    accountType === "organization"
      ? `/orgs/${owner}/repos`
      : `/user/repos`;

  const payload = {
    name: options.name,
    description: options.description ?? "",
    private: options.isPrivate ?? true,
    auto_init: options.autoInit ?? true,
  };

  try {
    return await mutateGithub<GithubCreateRepoResponse>(
      installationId,
      path,
      "POST",
      payload
    );
  } catch (error) {
    logger.error(
      { installationId, owner, accountType, name: options.name, error: error instanceof Error ? error.message : String(error) },
      "Failed to create GitHub repository"
    );
    throw error;
  }
};

// ---- Repository creation with user OAuth token ----

export const createRepositoryWithUserToken = async (
  accessToken: string,
  options: CreateRepositoryOptions
): Promise<GithubCreateRepoResponse> => {
  const payload = {
    name: options.name,
    description: options.description ?? "",
    private: options.isPrivate ?? true,
    auto_init: options.autoInit ?? true,
  };

  try {
    const response = await fetch(`${GITHUB_API_BASE}/user/repos`, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `GitHub API ${response.status} on POST /user/repos: ${errorBody}`
      );
    }

    return (await response.json()) as GithubCreateRepoResponse;
  } catch (error) {
    logger.error(
      { name: options.name, error: error instanceof Error ? error.message : String(error) },
      "Failed to create GitHub repository with user OAuth token"
    );
    throw error;
  }
};

// ---- High-level fetchers ----

export const fetchRecentCommits = async (
  installationId: number,
  owner: string,
  repo: string,
  branch?: string,
  perPage: number = 30
): Promise<GithubCommitResponse[]> => {
  try {
    const params = new URLSearchParams({ per_page: String(perPage) });
    if (branch) {
      params.set("sha", branch);
    }

    return await fetchFromGithub<GithubCommitResponse[]>(
      installationId,
      `/repos/${owner}/${repo}/commits?${params.toString()}`
    );
  } catch (error) {
    logger.error(
      { installationId, owner, repo, branch, error: error instanceof Error ? error.message : String(error) },
      "Failed to fetch recent commits"
    );
    throw error;
  }
};

export const fetchOpenPullRequests = async (
  installationId: number,
  owner: string,
  repo: string
): Promise<GithubPullRequestResponse[]> => {
  try {
    return await fetchFromGithub<GithubPullRequestResponse[]>(
      installationId,
      `/repos/${owner}/${repo}/pulls?state=open`
    );
  } catch (error) {
    logger.error(
      { installationId, owner, repo, error: error instanceof Error ? error.message : String(error) },
      "Failed to fetch open pull requests"
    );
    throw error;
  }
};

/**
 * Fetch recently updated pull requests (all states) sorted by update time.
 * This catches PRs that were closed or merged since the last sync, ensuring
 * the local database reflects their current state even if webhooks were missed.
 */
export const fetchRecentlyUpdatedPullRequests = async (
  installationId: number,
  owner: string,
  repo: string,
  perPage: number = 30
): Promise<GithubPullRequestResponse[]> => {
  try {
    const params = new URLSearchParams({
      state: "all",
      sort: "updated",
      direction: "desc",
      per_page: String(perPage),
    });

    return await fetchFromGithub<GithubPullRequestResponse[]>(
      installationId,
      `/repos/${owner}/${repo}/pulls?${params.toString()}`
    );
  } catch (error) {
    logger.error(
      { installationId, owner, repo, error: error instanceof Error ? error.message : String(error) },
      "Failed to fetch recently updated pull requests"
    );
    throw error;
  }
};

export const fetchWorkflowRuns = async (
  installationId: number,
  owner: string,
  repo: string,
  perPage: number = 20
): Promise<GithubWorkflowRunsResponse> => {
  try {
    return await fetchFromGithub<GithubWorkflowRunsResponse>(
      installationId,
      `/repos/${owner}/${repo}/actions/runs?per_page=${perPage}`
    );
  } catch (error) {
    logger.error(
      { installationId, owner, repo, error: error instanceof Error ? error.message : String(error) },
      "Failed to fetch workflow runs"
    );
    throw error;
  }
};

export const fetchRepositoryInfo = async (
  installationId: number,
  owner: string,
  repo: string
): Promise<GithubRepositoryResponse> => {
  try {
    return await fetchFromGithub<GithubRepositoryResponse>(
      installationId,
      `/repos/${owner}/${repo}`
    );
  } catch (error) {
    logger.error(
      { installationId, owner, repo, error: error instanceof Error ? error.message : String(error) },
      "Failed to fetch repository info"
    );
    throw error;
  }
};

export const fetchInstallationRepositories = async (
  installationId: number,
  page: number = 1,
  perPage: number = 100
): Promise<GithubInstallationRepositoriesResponse> => {
  try {
    return await fetchFromGithub<GithubInstallationRepositoriesResponse>(
      installationId,
      `/installation/repositories?page=${page}&per_page=${perPage}`
    );
  } catch (error) {
    logger.error(
      { installationId, page, perPage, error: error instanceof Error ? error.message : String(error) },
      "Failed to fetch installation repositories"
    );
    throw error;
  }
};

// ---- Sync installations from GitHub API ----

interface GithubInstallationApiResponse {
  id: number;
  account: {
    login: string;
    type: string;
    avatar_url: string;
  };
  permissions: Record<string, string>;
  repository_selection: string;
  suspended_at: string | null;
}

export const syncInstallationsFromGithub = async (): Promise<GithubInstallationApiResponse[]> => {
  const appJwt = await generateAppJwt();

  const response = await fetch(`${GITHUB_API_BASE}/app/installations`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${appJwt}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `GitHub API returned ${response.status} when listing installations: ${errorBody}`
    );
  }

  return (await response.json()) as GithubInstallationApiResponse[];
};

// ---- Webhook signature verification ----

/**
 * Verify a GitHub webhook signature. Now async because it may need to
 * fetch the webhook secret from the DB-stored credentials.
 */
export const verifyWebhookSignature = async (
  payload: string,
  signature: string,
): Promise<boolean> => {
  try {
    const result = await getGithubAppCredentials();
    const webhookSecret = result?.credentials.webhookSecret;

    if (!webhookSecret) {
      logger.error("GitHub webhook secret is not configured, cannot verify webhook signature");
      return false;
    }

    const expected = `sha256=${createHmac("sha256", webhookSecret)
      .update(payload, "utf-8")
      .digest("hex")}`;

    if (expected.length !== signature.length) {
      return false;
    }

    return timingSafeEqual(
      Buffer.from(expected, "utf-8"),
      Buffer.from(signature, "utf-8"),
    );
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      "Failed to verify webhook signature",
    );
    return false;
  }
};

// ---- PR description update with preview URL ----

/**
 * Update a GitHub PR description with a preview deployment link.
 * Idempotent: uses HTML comment markers to replace an existing section
 * rather than duplicating it on re-deploys.
 */
export const updatePrDescriptionWithPreviewUrl = async (
  previewUrl: string,
  prNumber: number,
  repoFullName: string
): Promise<void> => {
  // 1. Resolve installation ID from repo full name
  const repoId = await getRepoIdByGithubFullName(repoFullName);
  if (!repoId) {
    logger.warn({ repoFullName }, "No repo found for full name, skipping PR description update");
    return;
  }

  const installation = await getInstallationByRepoId(repoId);
  if (!installation) {
    logger.warn({ repoFullName }, "No GitHub installation found for repo, skipping PR description update");
    return;
  }

  const installationId = installation.installationId;
  if (!installationId) {
    logger.warn({ repoFullName }, "No installationId in connection config, skipping PR description update");
    return;
  }

  // 2. Fetch current PR description
  const pr = await fetchFromGithub<{ body: string | null }>(
    installationId,
    `/repos/${repoFullName}/pulls/${prNumber}`
  );
  const currentBody = pr.body ?? "";

  // 3. Build preview section with HTML comment markers for idempotency
  const MARKER_START = "<!-- almirant-preview-start -->";
  const MARKER_END = "<!-- almirant-preview-end -->";
  const previewSection = `${MARKER_START}\n\n---\n**Preview deployment**: [${previewUrl}](${previewUrl})\n${MARKER_END}`;

  // 4. Replace existing section or append
  let newBody: string;
  const markerRegex = new RegExp(
    `${escapeRegExp(MARKER_START)}[\\s\\S]*?${escapeRegExp(MARKER_END)}`
  );

  if (markerRegex.test(currentBody)) {
    newBody = currentBody.replace(markerRegex, previewSection);
  } else {
    newBody = currentBody + "\n\n" + previewSection;
  }

  // 5. Update PR via PATCH
  await mutateGithub(
    installationId,
    `/repos/${repoFullName}/pulls/${prNumber}`,
    "PATCH",
    { body: newBody }
  );

  logger.info(
    { repoFullName, prNumber, previewUrl },
    "Updated PR description with preview deployment link"
  );
};

/**
 * Parse a GitHub PR URL into its repo full name and PR number.
 * Expected format: https://github.com/owner/repo/pull/123
 */
export const parseGithubPrUrl = (
  url: string
): { repoFullName: string; prNumber: number } | null => {
  const match = url.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
  if (!match) return null;
  const repoFullName = match[1];
  const prNumber = match[2];
  if (!repoFullName || !prNumber) {
    return null;
  }
  return { repoFullName, prNumber: parseInt(prNumber, 10) };
};

/** Escape special regex characters in a string. */
const escapeRegExp = (str: string): string =>
  str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ---- Repository tree for AI context ----

interface GithubTreeItem {
  path: string;
  mode: string;
  type: "blob" | "tree";
  sha: string;
  size?: number;
  url: string;
}

interface GithubTreeResponse {
  sha: string;
  url: string;
  tree: GithubTreeItem[];
  truncated: boolean;
}

/** Directories to exclude from the tree (case-insensitive prefix match). */
const TREE_EXCLUDED_PREFIXES = [
  "node_modules/",
  "dist/",
  ".git/",
  ".next/",
  ".nuxt/",
  ".output/",
  ".turbo/",
  ".vercel/",
  ".cache/",
  "coverage/",
  "__pycache__/",
  ".venv/",
  "vendor/",
  "build/",
];

/** Files to exclude by exact name. */
const TREE_EXCLUDED_FILES = new Set([
  "bun.lockb",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  ".DS_Store",
  "Thumbs.db",
]);

/** Maximum depth (number of `/` separators) to include in the tree. */
const TREE_MAX_DEPTH = 4;

/** In-memory cache for repository trees. */
const treeCache = new Map<string, { tree: string; expiresAt: number }>();

/** Cache TTL in milliseconds (5 minutes). */
const TREE_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Check whether a tree item should be excluded from AI context.
 */
const isExcludedTreePath = (path: string): boolean => {
  // Check depth (count separators)
  const depth = path.split("/").length;
  if (depth > TREE_MAX_DEPTH) return true;

  // Check excluded directories (prefix match)
  const lowerPath = path.toLowerCase() + "/";
  for (const prefix of TREE_EXCLUDED_PREFIXES) {
    if (lowerPath.startsWith(prefix) || lowerPath.includes(`/${prefix}`)) {
      return true;
    }
  }

  // Check excluded files (exact basename match)
  const basename = path.split("/").pop() ?? "";
  if (TREE_EXCLUDED_FILES.has(basename)) return true;

  return false;
};

/**
 * Format a flat list of tree paths into an indented tree string.
 */
const formatTreeAsIndentedText = (
  items: Array<{ path: string; type: "blob" | "tree" }>
): string => {
  // Sort paths alphabetically, directories first at each level
  const sorted = [...items].sort((a, b) => {
    const partsA = a.path.split("/");
    const partsB = b.path.split("/");
    const minLen = Math.min(partsA.length, partsB.length);

    for (let i = 0; i < minLen; i++) {
      if (partsA[i] !== partsB[i]) {
        // At the same level, directories come before files
        const isLastA = i === partsA.length - 1;
        const isLastB = i === partsB.length - 1;
        if (!isLastA && isLastB) return -1;
        if (isLastA && !isLastB) return 1;
        return partsA[i]!.localeCompare(partsB[i]!);
      }
    }
    return partsA.length - partsB.length;
  });

  // Build a set of directory paths that exist in the tree
  const dirSet = new Set<string>();
  for (const item of sorted) {
    if (item.type === "tree") {
      dirSet.add(item.path);
    }
  }

  const lines: string[] = [];
  for (const item of sorted) {
    const depth = item.path.split("/").length - 1;
    const indent = "  ".repeat(depth);
    const name = item.path.split("/").pop() ?? item.path;
    const suffix = item.type === "tree" ? "/" : "";
    lines.push(`${indent}${name}${suffix}`);
  }

  return lines.join("\n");
};

/**
 * Fetch the file tree of a GitHub repository, filtered and cached.
 * Returns a pre-formatted indented tree string suitable for injection
 * into an AI system prompt, or null if the fetch fails.
 */
export const fetchRepositoryTree = async (
  installationId: number,
  owner: string,
  repo: string,
  defaultBranch: string = "main"
): Promise<string | null> => {
  const cacheKey = `${owner}/${repo}`;

  // Check cache
  const cached = treeCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.tree;
  }

  // Remove expired entry if present
  if (cached) {
    treeCache.delete(cacheKey);
  }

  try {
    const response = await fetchFromGithub<GithubTreeResponse>(
      installationId,
      `/repos/${owner}/${repo}/git/trees/${defaultBranch}?recursive=1`
    );

    // Filter out irrelevant paths and limit depth
    const filtered = response.tree.filter(
      (item) => !isExcludedTreePath(item.path)
    );

    const formatted = formatTreeAsIndentedText(
      filtered.map((item) => ({ path: item.path, type: item.type }))
    );

    // Store in cache
    treeCache.set(cacheKey, {
      tree: formatted,
      expiresAt: Date.now() + TREE_CACHE_TTL_MS,
    });

    return formatted;
  } catch (error) {
    logger.warn(
      {
        installationId,
        owner,
        repo,
        defaultBranch,
        error: error instanceof Error ? error.message : String(error),
      },
      "Failed to fetch repository tree for AI context (non-fatal)"
    );
    return null;
  }
};
