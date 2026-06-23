import { Elysia, t } from "elysia";
import { logger } from "@almirant/config";
import { getScheduledAgentConfigByIdAndToken } from "@almirant/database";
import { successResponse, errorResponse } from "../../../shared/services/response";
import { executeScheduledAgentConfig } from "../services/execute-scheduled-agent-config";

/**
 * Public webhook endpoint to invoke an agent run from outside the app.
 *
 * Auth model: the agent's `id` and `webhookToken` both travel in the URL.
 * Both are required; mismatched/missing token → 401. The token is rotated
 * when an agent is converted away from `trigger=webhook`.
 *
 * GET  /webhook-test/agents/:agentId?token=…      → validate reachability only
 * POST /webhook-test/agents/:agentId?token=…      → validate reachability only
 * GET  /webhooks/agents/:agentId?token=…          → run with the system prompt
 * POST /webhooks/agents/:agentId?token=…          → run with system + user prompt
 *      body: { prompt?: string }                    (concatenated to system prompt)
 *
 * Mounted in the `public()` group so no session middleware applies.
 */
const paramsSchema = t.Object({ agentId: t.String() });
const tokenQuerySchema = t.Object({ token: t.String({ minLength: 1 }) });

const handleTestWebhook = async ({
  params,
  query,
}: {
  params: { agentId: string };
  query: { token: string };
}) => {
  try {
    const config = await getScheduledAgentConfigByIdAndToken(
      params.agentId,
      query.token,
    );

    return successResponse({
      received: true,
      mode: "test",
      agentId: params.agentId,
      saved: Boolean(config),
      message: config
        ? "Test webhook received. The production webhook can enqueue jobs."
        : "Test webhook received. Save the agent to activate the production webhook.",
    });
  } catch (error) {
    logger.error({ error }, "Failed to process agent test webhook");
    return errorResponse(
      error instanceof Error ? error.message : "Failed to process agent test webhook",
      500,
    );
  }
};

export const agentWebhooksRoutes = new Elysia()
  .get(
    "/webhook-test/agents/:agentId",
    handleTestWebhook,
    {
      params: paramsSchema,
      query: tokenQuerySchema,
    },
  )
  .post(
    "/webhook-test/agents/:agentId",
    handleTestWebhook,
    {
      params: paramsSchema,
      query: tokenQuerySchema,
    },
  )
  .get(
    "/webhooks/agents/:agentId",
    async ({ params, query, set }) => {
      try {
        const config = await getScheduledAgentConfigByIdAndToken(
          params.agentId,
          query.token,
        );
        if (!config) {
          set.status = 401;
          return errorResponse("invalid_webhook_credentials", 401);
        }

        const job = await executeScheduledAgentConfig(config, {
          createdByUserId: null,
        });

        return successResponse({ jobId: job.id, status: job.status });
      } catch (error) {
        logger.error({ error }, "Failed to execute agent webhook (GET)");
        return errorResponse(
          error instanceof Error ? error.message : "Failed to execute agent webhook",
          500,
        );
      }
    },
    {
      params: paramsSchema,
      query: tokenQuerySchema,
    },
  )
  .post(
    "/webhooks/agents/:agentId",
    async ({ params, query, body, set }) => {
      try {
        const config = await getScheduledAgentConfigByIdAndToken(
          params.agentId,
          query.token,
        );
        if (!config) {
          set.status = 401;
          return errorResponse("invalid_webhook_credentials", 401);
        }

        const extraUserPrompt =
          typeof body === "object" && body !== null && "prompt" in body
            ? (body as { prompt?: string | null }).prompt ?? null
            : null;

        const job = await executeScheduledAgentConfig(config, {
          createdByUserId: null,
          extraUserPrompt,
        });

        return successResponse({ jobId: job.id, status: job.status });
      } catch (error) {
        logger.error({ error }, "Failed to execute agent webhook (POST)");
        return errorResponse(
          error instanceof Error ? error.message : "Failed to execute agent webhook",
          500,
        );
      }
    },
    {
      params: paramsSchema,
      query: tokenQuerySchema,
      body: t.Optional(
        t.Object({
          prompt: t.Optional(t.Nullable(t.String())),
        }),
      ),
    },
  );
