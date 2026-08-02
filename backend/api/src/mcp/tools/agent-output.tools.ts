import { logger } from "@almirant/config";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  AgentOutputValidationError,
  type AgentOutputCapabilityService,
} from "../../domains/agents/services/agent-output-capability";
import {
  getJobIdFromExtra,
  getPermissionsFromExtra,
  getWorkspaceIdFromExtra,
} from "../setup";

const REJECTION = "Structured agent output was rejected";

/**
 * Authorization and unexpected failures stay opaque so no internal state
 * crosses the output boundary. Schema violations are different: the agent wrote
 * the payload and already holds the schema, so it gets the offending paths and
 * rules back — otherwise it cannot fix its own output and just retries.
 *
 * Either way the failure is logged. Swallowing it made seven consecutive
 * rejected submissions look like silence, and the job died with a generic
 * `agent_job_failed` nobody could explain.
 */
const errorResult = (jobId: string | undefined, error: unknown) => {
  const isSchemaViolation = error instanceof AgentOutputValidationError;
  const details = isSchemaViolation ? error.details : undefined;

  logger.warn(
    {
      jobId,
      errorName: error instanceof Error ? error.name : typeof error,
      ...(details?.length ? { schemaViolations: details } : {}),
    },
    "submit_agent_output rejected",
  );

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          details?.length
            ? { error: REJECTION, details }
            : { error: REJECTION },
        ),
      },
    ],
    isError: true,
  };
};

const actorFromExtra = (
  extra: { authInfo?: { extra?: Record<string, unknown> } },
) => {
  const sessionType = extra.authInfo?.extra?.sessionType;
  return {
    jobId: getJobIdFromExtra(extra),
    workspaceId: getWorkspaceIdFromExtra(extra),
    permissions: getPermissionsFromExtra(extra),
    sessionType:
      typeof sessionType === "string" ? sessionType : undefined,
  };
};

export const registerAgentOutputTools = (
  server: McpServer,
  service: AgentOutputCapabilityService,
) => {
  server.tool(
    "submit_agent_output",
    "Submit the single schema-validated structured output bound to this exact agent job.",
    { output: z.unknown() },
    async ({ output }, extra) => {
      const actor = actorFromExtra(extra);
      try {
        const submitted = await service.submit(actor, output);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(submitted),
            },
          ],
        };
      } catch (error) {
        return errorResult(actor.jobId, error);
      }
    },
  );
};
