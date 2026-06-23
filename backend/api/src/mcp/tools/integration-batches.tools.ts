/**
 * MCP tools for the Release Integration agent.
 *
 * The agent runs in a container with shell access (git, bun) and uses these
 * tools to read batch state, update item progress, and drive the release PR
 * lifecycle. The deterministic legacy runner does NOT use these tools — it
 * still hits the internal HTTP routes.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  db,
  integrationBatchItems,
  integrationBatches,
  getBatchByIdWithItems,
  updateBatchStatus,
  updateItemStatus,
  setItemFailure,
  setCurrentItemIndex,
  type IntegrationBatchStatus,
  type IntegrationBatchItemStatus,
  type IntegrationBatchItemFailureCategory,
} from "@almirant/database";
import { dodHumanActionV2Schema } from "@almirant/shared";
import { eq } from "drizzle-orm";
import { getOrganizationIdFromExtra } from "../setup";
import {
  ensureReleasePullRequest,
  refreshReleasePullRequestBody,
  mergeReleasePullRequest,
} from "../../domains/project-management/integration-batches/services/release-pr-service";
import {
  clearReleaseIntegrationBatchItemsAiProcessing,
  shouldClearReleaseIntegrationBatchItems,
  syncReleaseIntegrationItemAiProcessing,
} from "../../domains/project-management/integration-batches/services/integration-batch-ai-processing";

const BATCH_STATUSES = [
  "queued",
  "running",
  "awaiting_release",
  "merging",
  "completed",
  "failed",
  "aborted",
] as const;

const ITEM_STATUSES = [
  "pending",
  "rebasing",
  "migrating",
  "type_checking",
  "testing",
  "merged",
  "skipped",
  "failed",
] as const;

const FAILURE_CATEGORIES = [
  "merge_conflict",
  "schema_semantic",
  "schema_obsolete_branch",
  "schema_irreconcilable",
  "migration_apply_failed",
  "type_check_failed",
  "tests_failed",
] as const;

const errorText = (msg: string) => ({
  content: [{ type: "text" as const, text: `Error: ${msg}` }],
  isError: true,
});

const okJson = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

type McpExtra = { authInfo?: { extra?: Record<string, unknown> } };

const requireOrgScope = async (
  extra: McpExtra,
  batchId: string,
): Promise<
  | { ok: true; batch: NonNullable<Awaited<ReturnType<typeof getBatchByIdWithItems>>> }
  | { ok: false; result: ReturnType<typeof errorText> }
> => {
  const organizationId = getOrganizationIdFromExtra(extra);
  if (!organizationId) {
    return { ok: false, result: errorText("could not resolve organizationId from API key") };
  }
  const batch = await getBatchByIdWithItems(batchId);
  if (!batch) {
    return { ok: false, result: errorText(`Integration batch ${batchId} not found`) };
  }
  if (batch.organizationId !== organizationId) {
    return {
      ok: false,
      result: errorText(`Integration batch ${batchId} does not belong to your organization`),
    };
  }
  return { ok: true, batch };
};

/** Item-scoped variant: looks up the item's batch and verifies the org. */
const requireOrgScopeForItem = async (
  extra: McpExtra,
  itemId: string,
): Promise<
  | {
      ok: true;
      itemId: string;
      batchId: string;
      organizationId: string;
      workItemId: string;
    }
  | { ok: false; result: ReturnType<typeof errorText> }
> => {
  const organizationId = getOrganizationIdFromExtra(extra);
  if (!organizationId) {
    return { ok: false, result: errorText("could not resolve organizationId from API key") };
  }
  const [row] = await db
    .select({
      orgId: integrationBatches.organizationId,
      batchId: integrationBatchItems.batchId,
      workItemId: integrationBatchItems.workItemId,
    })
    .from(integrationBatchItems)
    .innerJoin(
      integrationBatches,
      eq(integrationBatchItems.batchId, integrationBatches.id),
    )
    .where(eq(integrationBatchItems.id, itemId))
    .limit(1);
  if (!row) {
    return { ok: false, result: errorText(`Integration batch item ${itemId} not found`) };
  }
  if (row.orgId !== organizationId) {
    return {
      ok: false,
      result: errorText(`Integration batch item ${itemId} does not belong to your organization`),
    };
  }
  return {
    ok: true,
    itemId,
    batchId: row.batchId,
    organizationId,
    workItemId: row.workItemId,
  };
};

export const registerIntegrationBatchesTools = (server: McpServer) => {
  // -------------------------------------------------------
  server.tool(
    "get_integration_batch",
    "Read the full state of an integration batch (status, integration branch, base branch, release number, every item with its branch/PR/status). The Release Integration agent calls this at the start of each phase to know what to work on.",
    {
      batchId: z.string().uuid().describe("UUID of the integration batch"),
    },
    async (params, extra) => {
      const guard = await requireOrgScope(extra, params.batchId);
      if (!guard.ok) return guard.result;
      return okJson(guard.batch);
    },
  );

  // -------------------------------------------------------
  server.tool(
    "update_integration_batch_status",
    "Update the lifecycle status of an integration batch (running / awaiting_release / merging / completed / failed / aborted). Optionally also sets errorMessage and completedAt.",
    {
      batchId: z.string().uuid(),
      status: z.enum(BATCH_STATUSES),
      errorMessage: z.string().nullable().optional(),
      completedAt: z
        .string()
        .datetime()
        .optional()
        .describe("ISO 8601 UTC timestamp; defaults to omitting the field."),
    },
    async (params, extra) => {
      const guard = await requireOrgScope(extra, params.batchId);
      if (!guard.ok) return guard.result;
      const updated = await updateBatchStatus(
        params.batchId,
        params.status as IntegrationBatchStatus,
        {
          errorMessage: params.errorMessage ?? undefined,
          completedAt: params.completedAt ? new Date(params.completedAt) : undefined,
        },
      );
      if (
        updated &&
        shouldClearReleaseIntegrationBatchItems(params.status as IntegrationBatchStatus)
      ) {
        await clearReleaseIntegrationBatchItemsAiProcessing({
          organizationId: guard.batch.organizationId,
          items: guard.batch.items,
        });
      }
      return okJson(updated);
    },
  );

  // -------------------------------------------------------
  server.tool(
    "update_integration_batch_item_status",
    "Update the status of a single item inside a batch (rebasing / migrating / type_checking / testing / merged / skipped / failed) plus optional commit shas, migrationRegenerated flag, and completion timestamp. To mark a failure, prefer set_integration_batch_item_failure which also persists category + reason.",
    {
      itemId: z.string().uuid().describe("UUID of the integration batch item"),
      status: z.enum(ITEM_STATUSES),
      commitShaBefore: z.string().optional(),
      commitShaAfter: z.string().optional(),
      migrationRegenerated: z.boolean().optional(),
      completedAt: z.string().datetime().optional(),
    },
    async (params, extra) => {
      const guard = await requireOrgScopeForItem(extra, params.itemId);
      if (!guard.ok) return guard.result;
      const updated = await updateItemStatus(
        params.itemId,
        params.status as IntegrationBatchItemStatus,
        {
          commitShaBefore: params.commitShaBefore,
          commitShaAfter: params.commitShaAfter,
          migrationRegenerated: params.migrationRegenerated,
          completedAt: params.completedAt ? new Date(params.completedAt) : undefined,
        },
      );
      if (!updated) return errorText(`Item ${params.itemId} not found`);
      await syncReleaseIntegrationItemAiProcessing({
        organizationId: guard.organizationId,
        workItemId: guard.workItemId,
        status: params.status as IntegrationBatchItemStatus,
      });
      return okJson(updated);
    },
  );

  // -------------------------------------------------------
  server.tool(
    "set_integration_batch_item_failure",
    `Mark a batch item as failed with a structured category and a human-readable reason. The agent uses this when it cannot make a clean merge and wants to escalate the item without aborting the whole batch.

Two specialized categories let the backend route the failure differently:

- **schema_obsolete_branch** — the branch was authored against an older schema state and the integrated branch (release/main-v*) has been moved forward by another already-approved feature. Pass \`integrationContext\` describing the canonical schema columns, conflicting files, and any imports/wiring in main that must be preserved. The backend will mark the leaf descendants as \`dod_incompleted=true\` so the next runner-fix-dod tick re-implements them against current main. NO human gate is set.

- **schema_irreconcilable** — two valid schemas with no clear winner; an operator must choose. Pass \`dodHumanActionV2\` with \`diagnosis\`, \`evidence\`, and a list of \`options\` (each with pros/cons/impact and a discriminated \`action\`). The frontend renders a card-per-option panel where the operator picks one with a single click.

Other categories (merge_conflict, migration_apply_failed, type_check_failed, tests_failed, schema_semantic) keep the legacy free-text human-action gate.`,
    {
      itemId: z.string().uuid(),
      failureCategory: z.enum(FAILURE_CATEGORIES),
      failureReason: z.string().min(1).max(2000),
      integrationContext: z
        .record(z.string(), z.unknown())
        .optional()
        .describe(
          "Required for failureCategory=schema_obsolete_branch. Free-form JSON object the runner-fix-dod prompt parses — typically: { groundTruthSchema, branchSchema, conflictingFiles, preserveImports }.",
        ),
      dodHumanActionV2: z
        .unknown()
        .optional()
        .describe(
          "Required for failureCategory=schema_irreconcilable. Structured payload (diagnosis, rootCause, evidence, options[], recommendation?) — see DodHumanActionV2 in @almirant/shared.",
        ),
    },
    async (params, extra) => {
      const guard = await requireOrgScopeForItem(extra, params.itemId);
      if (!guard.ok) return guard.result;

      let parsedV2 = undefined;
      if (
        params.failureCategory === "schema_irreconcilable" &&
        params.dodHumanActionV2
      ) {
        const parseResult = dodHumanActionV2Schema.safeParse(
          params.dodHumanActionV2,
        );
        if (!parseResult.success) {
          return errorText(
            `Invalid dodHumanActionV2 payload: ${parseResult.error.message}`,
          );
        }
        parsedV2 = parseResult.data;
      }

      const updated = await setItemFailure(
        params.itemId,
        params.failureCategory as IntegrationBatchItemFailureCategory,
        params.failureReason,
        {
          integrationContext: params.integrationContext,
          dodHumanActionV2: parsedV2,
        },
      );
      if (!updated) return errorText(`Item ${params.itemId} not found`);
      await syncReleaseIntegrationItemAiProcessing({
        organizationId: guard.organizationId,
        workItemId: guard.workItemId,
        status: "failed",
      });
      return okJson(updated);
    },
  );

  // -------------------------------------------------------
  server.tool(
    "set_current_integration_batch_item_index",
    "Update the batch's `currentItemIndex` cursor — useful for progress reporting in the UI while the agent processes items in order.",
    {
      batchId: z.string().uuid(),
      index: z.number().int().nonnegative(),
    },
    async (params, extra) => {
      const guard = await requireOrgScope(extra, params.batchId);
      if (!guard.ok) return guard.result;
      const updated = await setCurrentItemIndex(params.batchId, params.index);
      return okJson(updated);
    },
  );

  // -------------------------------------------------------
  server.tool(
    "ensure_release_pr",
    "Create the release PR on GitHub (head = integration branch, base = main) if it does not exist yet, or return the existing one. Also seeds metadata.releasePullRequest only on successfully merged batch items so the Rocket icon means integrated into the release branch. Idempotent.",
    {
      batchId: z.string().uuid(),
    },
    async (params, extra) => {
      const guard = await requireOrgScope(extra, params.batchId);
      if (!guard.ok) return guard.result;
      const result = await ensureReleasePullRequest(params.batchId);
      if (!result.ok) return errorText(result.error);
      return okJson({
        prUrl: result.prUrl,
        prNumber: result.prNumber,
        alreadyExists: result.alreadyExists,
        releaseColumnMove: result.releaseColumnMove,
      });
    },
  );

  // -------------------------------------------------------
  server.tool(
    "refresh_release_pr_body",
    "Re-render the release PR title and body from the current snapshot (changelog with Features/Fixes/Other + items table). Call after every wave so the body stays in sync with the items just processed.",
    {
      batchId: z.string().uuid(),
    },
    async (params, extra) => {
      const guard = await requireOrgScope(extra, params.batchId);
      if (!guard.ok) return guard.result;
      const result = await refreshReleasePullRequestBody(params.batchId);
      if (!result.ok) return errorText(result.error);
      return okJson({ refreshed: true });
    },
  );

  // -------------------------------------------------------
  server.tool(
    "merge_release_pr",
    "Squash-merge (default) the release PR into the base branch via the GitHub API. This is allowed only in the explicit merge phase after the batch status is already `merging`; process-phase jobs must never call it. The webhook handler picks up the merge and moves linked work items to Done.",
    {
      batchId: z.string().uuid(),
      mergeMethod: z.enum(["merge", "squash", "rebase"]).optional(),
    },
    async (params, extra) => {
      const guard = await requireOrgScope(extra, params.batchId);
      if (!guard.ok) return guard.result;
      const result = await mergeReleasePullRequest(params.batchId, {
        mergeMethod: params.mergeMethod,
      });
      if (!result.ok) return errorText(result.error);
      return okJson({ merged: result.merged, sha: result.sha });
    },
  );
};
