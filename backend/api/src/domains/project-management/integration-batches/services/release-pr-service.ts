/**
 * Reusable service for the release-PR lifecycle. Used by both the internal
 * runner endpoints and the MCP tools that the Release Integration agent calls.
 */

import {
  getBatchByIdWithItems,
  setBatchFinalPullRequest,
  setReleasePullRequestForBatch,
  getGithubInstallationIdByRepoFullName,
  getGithubRepoFullNameByRepoId,
  moveMergedIntegrationBatchItemsToReleaseColumn,
  type IntegrationBatchWithItems,
} from "@almirant/database";
import { getInstallationAccessToken } from "../../../integrations/github/services/github-service";
import {
  buildReleasePrTitle,
  loadReleaseChangelogSnapshot,
  renderReleasePrBody,
} from "./release-changelog";

const GITHUB_API_BASE = "https://api.github.com";

const parseOwnerRepo = (
  repoFullName: string,
): { owner: string; repo: string } | null => {
  const parts = repoFullName.split("/");
  if (parts.length !== 2) return null;
  const owner = (parts[0] ?? "").trim();
  const repo = (parts[1] ?? "").trim();
  if (!owner || !repo) return null;
  return { owner, repo };
};

type ResolvedRepo = {
  batch: IntegrationBatchWithItems;
  owner: string;
  repo: string;
  token: string;
};

const resolveRepoAndToken = async (
  batchId: string,
): Promise<{ ok: true; data: ResolvedRepo } | { ok: false; error: string }> => {
  const batch = await getBatchByIdWithItems(batchId);
  if (!batch) return { ok: false, error: "Integration batch not found" };
  const repoFullName = await getGithubRepoFullNameByRepoId(batch.repositoryId);
  if (!repoFullName)
    return { ok: false, error: "No linked GitHub repository for integration batch" };
  const repo = parseOwnerRepo(repoFullName);
  if (!repo) return { ok: false, error: "Invalid GitHub repository full name" };
  const installationId = await getGithubInstallationIdByRepoFullName(repoFullName);
  if (!installationId)
    return { ok: false, error: "No GitHub installation linked for integration batch repository" };
  const token = await getInstallationAccessToken(installationId);
  return {
    ok: true,
    data: { batch, owner: repo.owner, repo: repo.repo, token },
  };
};

const githubFetch = async (args: {
  token: string;
  method: "GET" | "POST" | "PATCH" | "PUT";
  path: string;
  body?: unknown;
}): Promise<Response> =>
  fetch(`${GITHUB_API_BASE}${args.path}`, {
    method: args.method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${args.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(args.body ? { "Content-Type": "application/json" } : {}),
    },
    body: args.body ? JSON.stringify(args.body) : undefined,
  });

export type EnsureReleasePrResult =
  | {
      ok: true;
      prUrl: string;
      prNumber: number;
      alreadyExists: boolean;
      releaseColumnMove: Awaited<
        ReturnType<typeof moveMergedIntegrationBatchItemsToReleaseColumn>
      >;
    }
  | { ok: false; error: string; status?: number };

export const ensureReleasePullRequest = async (
  batchId: string,
): Promise<EnsureReleasePrResult> => {
  const resolved = await resolveRepoAndToken(batchId);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  const { batch, owner, repo, token } = resolved.data;

  if (batch.finalPrUrl && batch.finalPrNumber) {
    if (batch.releaseNumber !== null) {
      await setReleasePullRequestForBatch(batch.id, {
        url: batch.finalPrUrl,
        number: batch.finalPrNumber,
        state: "open",
        branch: batch.integrationBranch,
        releaseNumber: batch.releaseNumber,
      });
    }
    const releaseColumnMove =
      await moveMergedIntegrationBatchItemsToReleaseColumn(batch.id);
    return {
      ok: true,
      prUrl: batch.finalPrUrl,
      prNumber: batch.finalPrNumber,
      alreadyExists: true,
      releaseColumnMove,
    };
  }

  const snapshot = await loadReleaseChangelogSnapshot(batch.id);
  const title = snapshot
    ? buildReleasePrTitle(snapshot)
    : `[Release v${batch.releaseNumber ?? "?"}] ${batch.integrationBranch}`;
  const body = snapshot
    ? renderReleasePrBody(snapshot)
    : "> Release PR created automatically by Almirant integration runner";

  const createRes = await githubFetch({
    token,
    method: "POST",
    path: `/repos/${owner}/${repo}/pulls`,
    body: {
      title,
      head: batch.integrationBranch,
      base: batch.baseBranch,
      body,
      draft: false,
    },
  });

  let prData: { html_url?: unknown; number?: unknown } | null = null;
  let alreadyExists = false;

  if (createRes.status === 422) {
    // PR for this head/base already exists — fetch it.
    const headParam = `${owner}:${batch.integrationBranch}`;
    const listRes = await githubFetch({
      token,
      method: "GET",
      path: `/repos/${owner}/${repo}/pulls?state=open&head=${encodeURIComponent(headParam)}`,
    });
    if (listRes.ok) {
      const prs = (await listRes.json()) as Array<{ html_url?: unknown; number?: unknown }>;
      prData = prs[0] ?? null;
      alreadyExists = !!prData;
    }
  } else if (createRes.ok) {
    prData = (await createRes.json()) as { html_url?: unknown; number?: unknown };
  }

  if (!prData || typeof prData.html_url !== "string" || typeof prData.number !== "number") {
    const text = await createRes.text().catch(() => "");
    return {
      ok: false,
      error: `Release PR create/reuse failed: HTTP ${createRes.status} ${createRes.statusText}: ${text.slice(0, 500)}`,
      status: createRes.ok ? 502 : createRes.status,
    };
  }

  await setBatchFinalPullRequest(batch.id, {
    finalPrUrl: prData.html_url,
    finalPrNumber: prData.number,
  });

  if (batch.releaseNumber !== null) {
    await setReleasePullRequestForBatch(batch.id, {
      url: prData.html_url,
      number: prData.number,
      state: "open",
      branch: batch.integrationBranch,
      releaseNumber: batch.releaseNumber,
    });
  }

  const releaseColumnMove =
    await moveMergedIntegrationBatchItemsToReleaseColumn(batch.id);

  return {
    ok: true,
    prUrl: prData.html_url,
    prNumber: prData.number,
    alreadyExists,
    releaseColumnMove,
  };
};

export type RefreshReleasePrBodyResult =
  | { ok: true; refreshed: true }
  | { ok: false; error: string; status?: number };

export const refreshReleasePullRequestBody = async (
  batchId: string,
): Promise<RefreshReleasePrBodyResult> => {
  const resolved = await resolveRepoAndToken(batchId);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  const { batch, owner, repo, token } = resolved.data;

  if (!batch.finalPrNumber) {
    return { ok: false, error: "Release PR has not been created yet", status: 409 };
  }

  const snapshot = await loadReleaseChangelogSnapshot(batch.id);
  if (!snapshot) {
    return { ok: false, error: "Release snapshot not loadable", status: 404 };
  }
  const title = buildReleasePrTitle(snapshot);
  const body = renderReleasePrBody(snapshot);

  const patchRes = await githubFetch({
    token,
    method: "PATCH",
    path: `/repos/${owner}/${repo}/pulls/${batch.finalPrNumber}`,
    body: { title, body },
  });

  if (!patchRes.ok) {
    const text = await patchRes.text().catch(() => "");
    return {
      ok: false,
      error: `Refresh release PR body failed: HTTP ${patchRes.status}: ${text.slice(0, 500)}`,
      status: 502,
    };
  }
  return { ok: true, refreshed: true };
};

export type MergeReleasePrResult =
  | { ok: true; merged: boolean; sha: string | null }
  | { ok: false; error: string; status?: number };

export const mergeReleasePullRequest = async (
  batchId: string,
  options?: { mergeMethod?: "merge" | "squash" | "rebase" },
): Promise<MergeReleasePrResult> => {
  const resolved = await resolveRepoAndToken(batchId);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  const { batch, owner, repo, token } = resolved.data;

  if (batch.status !== "merging") {
    return {
      ok: false,
      error: `Release PR can only be merged from the explicit merge phase (current status: ${batch.status})`,
      status: 409,
    };
  }

  if (!batch.finalPrNumber) {
    return { ok: false, error: "Release PR has not been created yet", status: 409 };
  }

  const snapshot = await loadReleaseChangelogSnapshot(batch.id);
  const commitTitle = snapshot
    ? buildReleasePrTitle(snapshot)
    : `[Release v${batch.releaseNumber ?? "?"}] Integration batch ${batch.id}`;
  const commitMessage = snapshot ? renderReleasePrBody(snapshot) : "";

  const mergeRes = await githubFetch({
    token,
    method: "PUT",
    path: `/repos/${owner}/${repo}/pulls/${batch.finalPrNumber}/merge`,
    body: {
      merge_method: options?.mergeMethod ?? "squash",
      commit_title: commitTitle,
      commit_message: commitMessage,
    },
  });

  if (!mergeRes.ok) {
    const text = await mergeRes.text().catch(() => "");
    return {
      ok: false,
      error: `Release PR merge failed: HTTP ${mergeRes.status}: ${text.slice(0, 500)}`,
      status: mergeRes.status,
    };
  }
  const data = (await mergeRes.json().catch(() => ({}))) as {
    merged?: boolean;
    sha?: string;
  };
  return {
    ok: true,
    merged: data.merged === true,
    sha: typeof data.sha === "string" ? data.sha : null,
  };
};
