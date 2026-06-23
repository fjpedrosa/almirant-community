import { Elysia, t } from "elysia";
import {
  validateApiKey,
  getBatchByIdWithItems,
  getGithubInstallationIdByRepoFullName,
  getGithubRepoFullNameByRepoId,
  updateBatchStatus,
  setBatchFinalPullRequest,
  setCurrentItemIndex,
  setSandboxContainerId,
  setReleasePullRequestForBatch,
  moveMergedIntegrationBatchItemsToReleaseColumn,
  updateItemStatus,
  setItemFailure,
  type IntegrationBatchStatus,
  type IntegrationBatchItemStatus,
  type IntegrationBatchItemFailureCategory,
} from "@almirant/database";
import { dodHumanActionV2Schema } from "@almirant/shared";
import {
  successResponse,
  errorResponse,
  notFoundResponse,
} from "../../../../shared/services/response";
import { getInstallationAccessToken } from "../../../integrations/github/services/github-service";
import {
  buildReleasePrTitle,
  loadReleaseChangelogSnapshot,
  renderReleasePrBody,
} from "../services/release-changelog";
import {
  clearReleaseIntegrationBatchItemsAiProcessing,
  shouldClearReleaseIntegrationBatchItems,
  syncReleaseIntegrationItemAiProcessing,
} from "../services/integration-batch-ai-processing";

const requireRunnerApiKey = async (request: Request) => {
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const raw = auth.slice(7);
  return validateApiKey(raw);
};

const BATCH_STATUSES: IntegrationBatchStatus[] = [
  "queued",
  "running",
  "awaiting_release",
  "merging",
  "completed",
  "failed",
  "aborted",
];

const ITEM_STATUSES: IntegrationBatchItemStatus[] = [
  "pending",
  "rebasing",
  "migrating",
  "type_checking",
  "testing",
  "merged",
  "skipped",
  "failed",
];

const FAILURE_CATEGORIES: IntegrationBatchItemFailureCategory[] = [
  "merge_conflict",
  "schema_semantic",
  "schema_obsolete_branch",
  "schema_irreconcilable",
  "migration_apply_failed",
  "type_check_failed",
  "tests_failed",
];

const GITHUB_API_BASE = "https://api.github.com";

const parseOwnerRepo = (repoFullName: string): { owner: string; repo: string } | null => {
  const parts = repoFullName.split("/");
  if (parts.length !== 2) return null;
  const owner = (parts[0] ?? "").trim();
  const repo = (parts[1] ?? "").trim();
  if (!owner || !repo) return null;
  return { owner, repo };
};

const fetchGithub = async (args: {
  token: string;
  method: "GET" | "POST";
  path: string;
  body?: unknown;
}): Promise<Response> => {
  return fetch(`${GITHUB_API_BASE}${args.path}`, {
    method: args.method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${args.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(args.body ? { "Content-Type": "application/json" } : {}),
    },
    body: args.body ? JSON.stringify(args.body) : undefined,
  });
};

export const internalIntegrationBatchesRoutes = new Elysia({
  prefix: "/internal/integration-batches",
})
  .derive({ as: "scoped" }, async ({ request }) => {
    const apiKey = await requireRunnerApiKey(request);
    return { apiKey };
  })
  .onBeforeHandle(({ apiKey, set }) => {
    if (!apiKey) {
      set.status = 401;
      return errorResponse("Unauthorized");
    }
  })

  // -------------------------------------------------------
  // GET /internal/integration-batches/:id
  // -------------------------------------------------------
  .get("/:id", async ({ params, set }) => {
    const batch = await getBatchByIdWithItems(params.id);
    if (!batch) {
      set.status = 404;
      return notFoundResponse("Integration batch");
    }
    return successResponse(batch);
  })

  // -------------------------------------------------------
  // POST /internal/integration-batches/:id/release-pr
  // -------------------------------------------------------
  .post("/:id/release-pr", async ({ params, set }) => {
    const batch = await getBatchByIdWithItems(params.id);
    if (!batch) {
      set.status = 404;
      return notFoundResponse("Integration batch");
    }

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
      return successResponse({
        prUrl: batch.finalPrUrl,
        prNumber: batch.finalPrNumber,
        alreadyExists: true,
        releaseColumnMove,
      });
    }

    const repoFullName = await getGithubRepoFullNameByRepoId(batch.repositoryId);
    if (!repoFullName) {
      set.status = 404;
      return errorResponse("No linked GitHub repository for integration batch");
    }

    const repo = parseOwnerRepo(repoFullName);
    if (!repo) {
      set.status = 400;
      return errorResponse("Invalid GitHub repository full name");
    }

    const installationId = await getGithubInstallationIdByRepoFullName(repoFullName);
    if (!installationId) {
      set.status = 404;
      return errorResponse("No GitHub installation linked for integration batch repository");
    }

    const token = await getInstallationAccessToken(installationId);
    const snapshot = await loadReleaseChangelogSnapshot(batch.id);
    const title = snapshot
      ? buildReleasePrTitle(snapshot)
      : `[Release v${batch.releaseNumber ?? "?"}] ${batch.integrationBranch}`;
    const body = snapshot
      ? renderReleasePrBody(snapshot)
      : "> Release PR created automatically by Almirant integration runner";

    const createRes = await fetchGithub({
      token,
      method: "POST",
      path: `/repos/${repo.owner}/${repo.repo}/pulls`,
      body: {
        title,
        head: batch.integrationBranch,
        base: batch.baseBranch,
        body,
        draft: false,
      },
    });

    let prData: { html_url?: unknown; number?: unknown; id?: unknown } | null = null;
    let alreadyExists = false;
    if (createRes.status === 422) {
      const headParam = `${repo.owner}:${batch.integrationBranch}`;
      const listRes = await fetchGithub({
        token,
        method: "GET",
        path: `/repos/${repo.owner}/${repo.repo}/pulls?state=open&head=${encodeURIComponent(headParam)}`,
      });
      if (listRes.ok) {
        const prs = (await listRes.json()) as Array<{ html_url?: unknown; number?: unknown; id?: unknown }>;
        prData = prs[0] ?? null;
        alreadyExists = !!prData;
      }
    } else if (createRes.ok) {
      prData = (await createRes.json()) as { html_url?: unknown; number?: unknown; id?: unknown };
    }

    if (!prData || typeof prData.html_url !== "string" || typeof prData.number !== "number") {
      const text = await createRes.text().catch(() => "");
      set.status = createRes.ok ? 502 : createRes.status;
      return errorResponse(
        `Release PR create/reuse failed: HTTP ${createRes.status} ${createRes.statusText}: ${text.slice(0, 500)}`,
      );
    }

    await setBatchFinalPullRequest(batch.id, {
      finalPrUrl: prData.html_url,
      finalPrNumber: prData.number,
    });

    // Seed releasePullRequest metadata only on merged batch items so the
    // Rocket icon means the work is actually present in this release.
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

    return successResponse({
      prUrl: prData.html_url,
      prNumber: prData.number,
      alreadyExists,
      releaseColumnMove,
    });
  })

  // -------------------------------------------------------
  // POST /internal/integration-batches/:id/release-pr/refresh-body
  // Re-renders the release PR title/body from the current snapshot. Called
  // after each wave so the changelog stays in sync as items are added.
  // -------------------------------------------------------
  .post("/:id/release-pr/refresh-body", async ({ params, set }) => {
    const batch = await getBatchByIdWithItems(params.id);
    if (!batch) {
      set.status = 404;
      return notFoundResponse("Integration batch");
    }
    if (!batch.finalPrNumber || !batch.finalPrUrl) {
      set.status = 409;
      return errorResponse("Release PR has not been created yet");
    }

    const repoFullName = await getGithubRepoFullNameByRepoId(batch.repositoryId);
    if (!repoFullName) {
      set.status = 404;
      return errorResponse("No linked GitHub repository for integration batch");
    }
    const repo = parseOwnerRepo(repoFullName);
    if (!repo) {
      set.status = 400;
      return errorResponse("Invalid GitHub repository full name");
    }
    const installationId = await getGithubInstallationIdByRepoFullName(repoFullName);
    if (!installationId) {
      set.status = 404;
      return errorResponse("No GitHub installation linked for integration batch repository");
    }

    const snapshot = await loadReleaseChangelogSnapshot(batch.id);
    if (!snapshot) {
      set.status = 404;
      return notFoundResponse("Release snapshot");
    }
    const token = await getInstallationAccessToken(installationId);
    const title = buildReleasePrTitle(snapshot);
    const body = renderReleasePrBody(snapshot);

    // GitHub uses PATCH to update pulls; bypass the helper which only does GET/POST.
    const patchRes = await fetch(
      `${GITHUB_API_BASE}/repos/${repo.owner}/${repo.repo}/pulls/${batch.finalPrNumber}`,
      {
        method: "PATCH",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title, body }),
      },
    );
    if (!patchRes.ok) {
      const text = await patchRes.text().catch(() => "");
      set.status = 502;
      return errorResponse(
        `Refresh release PR body failed: HTTP ${patchRes.status}: ${text.slice(0, 500)}`,
      );
    }

    return successResponse({ refreshed: true });
  })

  // -------------------------------------------------------
  // POST /internal/integration-batches/:id/release-pr/merge — squash-merge the
  // release PR into the base branch via the GitHub API. Called by the merge
  // phase of the integration runner once the operator approves.
  // -------------------------------------------------------
  .post(
    "/:id/release-pr/merge",
    async ({ params, body, set }) => {
      const batch = await getBatchByIdWithItems(params.id);
      if (!batch) {
        set.status = 404;
        return notFoundResponse("Integration batch");
      }
      if (batch.status !== "merging") {
        set.status = 409;
        return errorResponse(
          `Release PR can only be merged from the explicit merge phase (current status: ${batch.status})`,
        );
      }
      if (!batch.finalPrNumber) {
        set.status = 409;
        return errorResponse("Release PR has not been created");
      }

      const repoFullName = await getGithubRepoFullNameByRepoId(batch.repositoryId);
      if (!repoFullName) {
        set.status = 404;
        return errorResponse("No linked GitHub repository for integration batch");
      }
      const repo = parseOwnerRepo(repoFullName);
      if (!repo) {
        set.status = 400;
        return errorResponse("Invalid GitHub repository full name");
      }
      const installationId = await getGithubInstallationIdByRepoFullName(repoFullName);
      if (!installationId) {
        set.status = 404;
        return errorResponse("No GitHub installation linked");
      }

      const token = await getInstallationAccessToken(installationId);
      const mergeMethod = body.mergeMethod ?? "squash";

      const snapshot = await loadReleaseChangelogSnapshot(batch.id);
      const commitTitle = snapshot
        ? buildReleasePrTitle(snapshot)
        : `[Release v${batch.releaseNumber ?? "?"}] Integration batch ${batch.id}`;
      const commitMessage = snapshot ? renderReleasePrBody(snapshot) : "";

      const mergeRes = await fetch(
        `${GITHUB_API_BASE}/repos/${repo.owner}/${repo.repo}/pulls/${batch.finalPrNumber}/merge`,
        {
          method: "PUT",
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${token}`,
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            merge_method: mergeMethod,
            commit_title: commitTitle,
            commit_message: commitMessage,
          }),
        },
      );

      if (!mergeRes.ok) {
        const text = await mergeRes.text().catch(() => "");
        set.status = mergeRes.status;
        return errorResponse(
          `Release PR merge failed: HTTP ${mergeRes.status}: ${text.slice(0, 500)}`,
        );
      }

      const mergeData = (await mergeRes.json().catch(() => ({}))) as {
        merged?: boolean;
        sha?: string;
      };

      return successResponse({
        merged: mergeData.merged === true,
        sha: typeof mergeData.sha === "string" ? mergeData.sha : null,
      });
    },
    {
      body: t.Object({
        mergeMethod: t.Optional(
          t.Union([t.Literal("merge"), t.Literal("squash"), t.Literal("rebase")]),
        ),
      }),
    },
  )

  // -------------------------------------------------------
  // PATCH /internal/integration-batches/:id
  // -------------------------------------------------------
  .patch(
    "/:id",
    async ({ params, body, set }) => {
      if (
        body.status === undefined &&
        body.currentItemIndex === undefined &&
        body.sandboxContainerId === undefined
      ) {
        set.status = 400;
        return errorResponse("Nothing to update");
      }

      let batch = null;
      if (body.status !== undefined) {
        if (!BATCH_STATUSES.includes(body.status as IntegrationBatchStatus)) {
          set.status = 400;
          return errorResponse(`Invalid status: ${body.status}`);
        }
        batch = await updateBatchStatus(
          params.id,
          body.status as IntegrationBatchStatus,
          {
            errorMessage: body.errorMessage ?? undefined,
            completedAt: body.completedAt ? new Date(body.completedAt) : undefined,
          },
        );
        if (
          batch &&
          shouldClearReleaseIntegrationBatchItems(body.status as IntegrationBatchStatus)
        ) {
          const batchWithItems = await getBatchByIdWithItems(params.id);
          if (batchWithItems) {
            await clearReleaseIntegrationBatchItemsAiProcessing({
              organizationId: batchWithItems.organizationId,
              items: batchWithItems.items,
            });
          }
        }
      }
      if (body.currentItemIndex !== undefined) {
        batch = await setCurrentItemIndex(params.id, body.currentItemIndex);
      }
      if (body.sandboxContainerId !== undefined) {
        batch = await setSandboxContainerId(params.id, body.sandboxContainerId);
      }

      if (!batch) {
        set.status = 404;
        return notFoundResponse("Integration batch");
      }
      return successResponse(batch);
    },
    {
      body: t.Object({
        status: t.Optional(t.String()),
        currentItemIndex: t.Optional(t.Integer()),
        sandboxContainerId: t.Optional(t.Union([t.String(), t.Null()])),
        errorMessage: t.Optional(t.Union([t.String(), t.Null()])),
        completedAt: t.Optional(t.String()),
      }),
    },
  )

  // -------------------------------------------------------
  // PATCH /internal/integration-batches/:id/items/:itemId
  // -------------------------------------------------------
  .patch(
    "/:id/items/:itemId",
    async ({ params, body, set }) => {
      if (
        body.status === undefined &&
        body.failureCategory === undefined
      ) {
        set.status = 400;
        return errorResponse("Nothing to update");
      }

      const batch = await getBatchByIdWithItems(params.id);
      if (!batch) {
        set.status = 404;
        return notFoundResponse("Integration batch");
      }
      const batchItem = batch.items.find((item) => item.id === params.itemId);
      if (!batchItem) {
        set.status = 404;
        return notFoundResponse("Integration batch item");
      }

      let item = null;
      if (
        body.failureCategory !== undefined &&
        body.failureReason !== undefined
      ) {
        if (
          !FAILURE_CATEGORIES.includes(
            body.failureCategory as IntegrationBatchItemFailureCategory,
          )
        ) {
          set.status = 400;
          return errorResponse(
            `Invalid failureCategory: ${body.failureCategory}`,
          );
        }

        const failureCategory =
          body.failureCategory as IntegrationBatchItemFailureCategory;

        // Validate optional payloads only when the category routes to a path
        // that actually consumes them. The shapes are owned by @almirant/shared.
        let parsedDodHumanActionV2 = undefined;
        if (failureCategory === "schema_irreconcilable" && body.dodHumanActionV2) {
          const parseResult = dodHumanActionV2Schema.safeParse(body.dodHumanActionV2);
          if (!parseResult.success) {
            set.status = 400;
            return errorResponse(
              `Invalid dodHumanActionV2 payload: ${parseResult.error.message}`,
            );
          }
          parsedDodHumanActionV2 = parseResult.data;
        }

        item = await setItemFailure(
          params.itemId,
          failureCategory,
          body.failureReason,
          {
            integrationContext: body.integrationContext,
            dodHumanActionV2: parsedDodHumanActionV2,
          },
        );
        if (item) {
          await syncReleaseIntegrationItemAiProcessing({
            organizationId: batch.organizationId,
            workItemId: batchItem.workItemId,
            status: "failed",
          });
        }
      } else if (body.status !== undefined) {
        if (
          !ITEM_STATUSES.includes(body.status as IntegrationBatchItemStatus)
        ) {
          set.status = 400;
          return errorResponse(`Invalid status: ${body.status}`);
        }
        item = await updateItemStatus(
          params.itemId,
          body.status as IntegrationBatchItemStatus,
          {
            commitShaBefore: body.commitShaBefore,
            commitShaAfter: body.commitShaAfter,
            migrationRegenerated: body.migrationRegenerated,
            completedAt: body.completedAt ? new Date(body.completedAt) : undefined,
          },
        );
        if (item) {
          await syncReleaseIntegrationItemAiProcessing({
            organizationId: batch.organizationId,
            workItemId: batchItem.workItemId,
            status: body.status as IntegrationBatchItemStatus,
          });
        }
      }

      if (!item) {
        set.status = 404;
        return notFoundResponse("Integration batch item");
      }
      return successResponse(item);
    },
    {
      body: t.Object({
        status: t.Optional(t.String()),
        failureCategory: t.Optional(t.String()),
        failureReason: t.Optional(t.String()),
        commitShaBefore: t.Optional(t.String()),
        commitShaAfter: t.Optional(t.String()),
        migrationRegenerated: t.Optional(t.Boolean()),
        completedAt: t.Optional(t.String()),
        // For category=schema_obsolete_branch: agent supplies the
        // integration context that runner-fix-dod will use to re-implement
        // against the current main schema. Free-form JSON object — the
        // remediation prompt parses it.
        integrationContext: t.Optional(t.Record(t.String(), t.Unknown())),
        // For category=schema_irreconcilable: agent supplies the structured
        // DodHumanActionV2 payload (diagnosis + options + recommendation).
        // Validated server-side via Zod against the canonical schema in
        // @almirant/shared.
        dodHumanActionV2: t.Optional(t.Unknown()),
      }),
    },
  );
