import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  listScheduledAgentConfigsByWorkspace,
  getScheduledAgentConfigById,
  createScheduledAgentConfig,
  updateScheduledAgentConfig,
  deleteScheduledAgentConfig,
} from "@almirant/database";
import { assertOrgScope, getProjectIdFromExtra, getUserIdFromExtra } from "../setup";
import { executeScheduledAgentConfig } from "../../domains/agents/services/execute-scheduled-agent-config";
import { assertValidScheduledAgentRuntime } from "../../domains/agents/services/scheduled-agent-runtime-validation";
import {
  resolveScheduledAgentEffectiveRuntimes,
} from "../../domains/agents/services/scheduled-agent-effective-model-resolver";

const TRIGGER_VALUES = ["scheduled", "webhook"] as const;
const SCHEDULE_TYPE_VALUES = ["manual", "time_window", "cron"] as const;
const PROVIDER_VALUES = ["claude-code", "codex", "zipu", "grok"] as const;
const CODING_AGENT_VALUES = ["claude-code", "codex", "opencode"] as const;
const AI_PROVIDER_VALUES = ["anthropic", "openai", "zai", "xai"] as const;
const JOB_TYPE_VALUES = [
  "implementation",
  "planning",
  "review",
  "validation",
  "bug-fix",
  "recording",
  "prewarm",
  "scheduled",
  "incident-analyze",
  "integration",
] as const;

const cronConfigSchema = z.object({ expression: z.string().min(1) });
const timeWindowConfigSchema = z.object({
  startHour: z.number().int().min(0).max(23),
  endHour: z.number().int().min(0).max(23),
  daysOfWeek: z.array(z.number().int().min(0).max(6)),
});
const scheduleConfigSchema = z.union([cronConfigSchema, timeWindowConfigSchema]);
const backlogDrainProjectRuleSchema = z.object({
  projectId: z.string().min(1),
  enabled: z.boolean().optional(),
  maxConcurrentJobs: z.number().int().min(1).max(100).nullable().optional(),
  excludedWorkItemIds: z.array(z.string()).optional(),
  excludeDescendants: z.boolean().optional(),
  codingAgent: z.enum(CODING_AGENT_VALUES).nullable().optional(),
  aiProvider: z.enum(["anthropic", "openai", "google", "zai", "xai"]).nullable().optional(),
  model: z.string().nullable().optional(),
  reasoningLevel: z.string().nullable().optional(),
}).strict();
const backlogDrainConfigSchema = z.object({
  enabled: z.boolean().optional(),
  minAgeMinutes: z.number().min(0).max(1440).optional(),
  defaultMaxConcurrentJobs: z.number().int().min(1).max(100).nullable().optional(),
  projects: z.array(backlogDrainProjectRuleSchema).optional(),
}).strict();
const dodReviewConfigSchema = z.object({
  enabled: z.boolean().optional(),
  minAgeMinutes: z.number().min(0).max(1440).optional(),
  defaultMaxConcurrentJobs: z.number().int().min(1).max(100).nullable().optional(),
  projects: z.array(backlogDrainProjectRuleSchema).optional(),
}).strict();
const releaseIntegrationConfigSchema = z.object({
  enabled: z.boolean().optional(),
  minAgeMinutes: z.number().min(0).max(1440).optional(),
  defaultMaxConcurrentJobs: z.number().int().min(1).max(100).nullable().optional(),
  projects: z.array(backlogDrainProjectRuleSchema).optional(),
}).strict();
const targetConfigSchema = z.object({
  projectIds: z.array(z.string()).optional(),
  columnIds: z.array(z.string()).optional(),
  statuses: z.array(z.string()).optional(),
  priorities: z.array(z.string()).optional(),
  maxAgeHours: z.number().min(1).optional(),
  customFilters: z.record(z.string(), z.unknown()).optional(),
  requireDodApproved: z.boolean().optional(),
  backlogDrain: backlogDrainConfigSchema.optional(),
  dodRemediation: backlogDrainConfigSchema.optional(),
  dodReview: dodReviewConfigSchema.optional(),
  releaseIntegration: releaseIntegrationConfigSchema.optional(),
}).strict();

const buildAgentInput = (params: {
  trigger?: typeof TRIGGER_VALUES[number];
  scheduleType?: typeof SCHEDULE_TYPE_VALUES[number];
  scheduleConfig?: z.infer<typeof scheduleConfigSchema> | null;
}) => {
  const trigger = params.trigger ?? "scheduled";
  if (trigger === "webhook") {
    return {
      trigger,
      scheduleType: "manual" as const,
      scheduleConfig: null,
      enabled: false,
    };
  }
  const scheduleType = params.scheduleType ?? "manual";
  if (scheduleType !== "manual" && !params.scheduleConfig) {
    throw new Error("scheduleConfig is required for time_window/cron scheduled agents");
  }
  return {
    trigger,
    scheduleType,
    scheduleConfig: scheduleType === "manual" ? null : params.scheduleConfig ?? null,
  };
};

export const registerAgentsTools = (server: McpServer) => {
  // -------------------------------------------------------
  // list_agents
  // -------------------------------------------------------
  server.tool(
    "list_agents",
    "List scheduled / webhook-triggered agents for the active workspace. Includes the project name and the linked skill name when present.",
    {
      projectId: z.string().uuid().optional().describe("Filter by project; falls back to MCP session projectId"),
    },
    async (params, extra) => {
      try {
        const orgResult = assertOrgScope(extra);
        if (typeof orgResult !== "string") return orgResult;
        const workspaceId = orgResult;

        const projectId = params.projectId ?? getProjectIdFromExtra(extra) ?? undefined;
        const agents = await listScheduledAgentConfigsByWorkspace(workspaceId, {
          projectId,
        });

        return {
          content: [{ type: "text" as const, text: JSON.stringify({ agents }, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error listing agents: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------
  // get_agent
  // -------------------------------------------------------
  server.tool(
    "get_agent",
    "Get a single agent by ID.",
    {
      id: z.string().uuid().describe("Agent (scheduled-agent-config) ID"),
    },
    async (params, extra) => {
      try {
        const orgResult = assertOrgScope(extra);
        if (typeof orgResult !== "string") return orgResult;
        const workspaceId = orgResult;

        const agent = await getScheduledAgentConfigById(params.id, workspaceId);
        if (!agent) {
          return {
            content: [{ type: "text" as const, text: `Error: agent ${params.id} not found` }],
            isError: true,
          };
        }

        return {
          content: [{ type: "text" as const, text: JSON.stringify(agent, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error fetching agent: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------
  // create_agent
  // -------------------------------------------------------
  server.tool(
    "create_agent",
    "Create a new agent. Use trigger='webhook' to expose a public POST/GET /webhooks/agents/:id?token=… endpoint (token auto-generated). Use trigger='scheduled' for cron/time-window/manual schedules.",
    {
      name: z.string().min(1).max(255).describe("Display name"),
      trigger: z.enum(TRIGGER_VALUES).optional().describe("scheduled | webhook (default: scheduled)"),
      jobType: z.enum(JOB_TYPE_VALUES).describe("Type of job that the runner produces"),
      provider: z.enum(PROVIDER_VALUES).describe("Runner provider. Must match aiProvider: anthropic→claude-code, openai→codex, zai→zipu, xai→grok."),
      prompt: z.string().optional().describe("System prompt the runner executes"),
      description: z.string().optional(),
      skillId: z.string().uuid().nullable().optional().describe("Optional skill linked to this agent"),
      projectId: z.string().uuid().nullable().optional(),
      codingAgent: z.enum(CODING_AGENT_VALUES).optional(),
      aiProvider: z.enum(AI_PROVIDER_VALUES).optional().describe("AI provider used for credentials/model routing."),
      aiModel: z.string().optional().describe("Model id; must belong to aiProvider, e.g. glm-5.2 requires aiProvider=zai and provider=zipu."),
      reasoningLevel: z.string().optional(),
      timezone: z.string().optional(),
      enabled: z.boolean().optional(),
      targetConfig: targetConfigSchema.optional(),
      maxJobsPerRun: z.number().int().min(1).max(100).optional(),
      scheduleType: z.enum(SCHEDULE_TYPE_VALUES).optional(),
      scheduleConfig: scheduleConfigSchema.nullable().optional(),
    },
    async (params, extra) => {
      try {
        const orgResult = assertOrgScope(extra);
        if (typeof orgResult !== "string") return orgResult;
        const workspaceId = orgResult;

        const triggerInput = buildAgentInput(params);
        const effectiveRuntimes = await resolveScheduledAgentEffectiveRuntimes({
          workspaceId,
          provider: params.provider,
          codingAgent: params.codingAgent,
          aiProvider: params.aiProvider,
          aiModel: params.aiModel,
          reasoningLevel: params.reasoningLevel,
          jobType: params.jobType,
          projectId: params.projectId,
          targetConfig: params.targetConfig,
        });
        assertValidScheduledAgentRuntime({
          provider: params.provider,
          codingAgent: params.codingAgent,
          aiProvider: params.aiProvider,
          aiModel: params.aiModel,
          reasoningLevel: params.reasoningLevel,
          effectiveRuntimes,
          targetConfig: params.targetConfig,
        });

        const agent = await createScheduledAgentConfig({
          workspaceId,
          name: params.name,
          prompt: params.prompt ?? null,
          description: params.description ?? null,
          jobType: params.jobType,
          provider: params.provider,
          codingAgent: params.codingAgent ?? null,
          aiProvider: params.aiProvider ?? null,
          aiModel: params.aiModel ?? null,
          reasoningLevel: params.reasoningLevel ?? null,
          skillId: params.skillId ?? null,
          projectId: params.projectId ?? null,
          trigger: triggerInput.trigger,
          scheduleType: triggerInput.scheduleType,
          scheduleConfig: triggerInput.scheduleConfig,
          timezone: params.timezone,
          enabled: ("enabled" in triggerInput ? triggerInput.enabled : params.enabled) ?? false,
          targetConfig: params.targetConfig ?? {},
          maxJobsPerRun: params.maxJobsPerRun ?? 10,
        });

        return {
          content: [{ type: "text" as const, text: JSON.stringify(agent, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error creating agent: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------
  // update_agent
  // -------------------------------------------------------
  server.tool(
    "update_agent",
    "Update an existing agent. Only provided fields are changed. Switching `trigger` between scheduled and webhook regenerates the webhook token if needed.",
    {
      id: z.string().uuid().describe("Agent ID"),
      name: z.string().min(1).max(255).optional(),
      trigger: z.enum(TRIGGER_VALUES).optional(),
      jobType: z.enum(JOB_TYPE_VALUES).optional(),
      provider: z.enum(PROVIDER_VALUES).optional().describe("Runner provider. Must match aiProvider: anthropic→claude-code, openai→codex, zai→zipu, xai→grok."),
      prompt: z.string().nullable().optional(),
      description: z.string().nullable().optional(),
      skillId: z.string().uuid().nullable().optional(),
      projectId: z.string().uuid().nullable().optional(),
      codingAgent: z.enum(CODING_AGENT_VALUES).optional(),
      aiProvider: z.enum(AI_PROVIDER_VALUES).optional().describe("AI provider used for credentials/model routing."),
      aiModel: z.string().optional().describe("Model id; must belong to aiProvider, e.g. glm-5.2 requires aiProvider=zai and provider=zipu."),
      reasoningLevel: z.string().optional(),
      timezone: z.string().optional(),
      enabled: z.boolean().optional(),
      targetConfig: targetConfigSchema.optional(),
      maxJobsPerRun: z.number().int().min(1).max(100).optional(),
      scheduleType: z.enum(SCHEDULE_TYPE_VALUES).optional(),
      scheduleConfig: scheduleConfigSchema.nullable().optional(),
    },
    async (params, extra) => {
      try {
        const orgResult = assertOrgScope(extra);
        if (typeof orgResult !== "string") return orgResult;
        const workspaceId = orgResult;

        const { id, ...rest } = params;
        const existing = await getScheduledAgentConfigById(id, workspaceId);
        if (!existing) {
          return {
            content: [{ type: "text" as const, text: `Error: agent ${id} not found` }],
            isError: true,
          };
        }

        // Only normalize schedule when trigger or schedule fields are touched
        const touchesScheduling =
          rest.trigger !== undefined ||
          rest.scheduleType !== undefined ||
          rest.scheduleConfig !== undefined;
        const scheduleUpdate = touchesScheduling
          ? buildAgentInput({
              trigger: rest.trigger,
              scheduleType: rest.scheduleType,
              scheduleConfig: rest.scheduleConfig,
            })
          : undefined;
        const touchesRuntime =
          rest.provider !== undefined ||
          rest.codingAgent !== undefined ||
          rest.aiProvider !== undefined ||
          rest.aiModel !== undefined ||
          rest.reasoningLevel !== undefined ||
          rest.jobType !== undefined ||
          rest.targetConfig !== undefined;

        if (touchesRuntime) {
          const nextProvider = rest.provider ?? existing.provider;
          const nextAiProvider = rest.aiProvider ?? existing.aiProvider;
          const nextAiModel = rest.aiModel ?? existing.aiModel;
          const nextJobType = rest.jobType ?? existing.jobType;
          const effectiveRuntimes = await resolveScheduledAgentEffectiveRuntimes({
            workspaceId,
            provider: nextProvider,
            codingAgent: rest.codingAgent ?? existing.codingAgent,
            aiProvider: nextAiProvider,
            aiModel: nextAiModel,
            reasoningLevel: rest.reasoningLevel ?? existing.reasoningLevel,
            jobType: nextJobType,
            projectId: rest.projectId ?? existing.projectId,
            targetConfig: rest.targetConfig ?? existing.targetConfig,
          });
          assertValidScheduledAgentRuntime({
            provider: nextProvider,
            codingAgent: rest.codingAgent ?? existing.codingAgent,
            aiProvider: nextAiProvider,
            aiModel: nextAiModel,
            reasoningLevel: rest.reasoningLevel ?? existing.reasoningLevel,
            effectiveRuntimes,
            targetConfig: rest.targetConfig ?? existing.targetConfig,
          });
        }

        const updated = await updateScheduledAgentConfig(id, workspaceId, {
          ...rest,
          ...(scheduleUpdate ?? {}),
        });

        if (!updated) {
          return {
            content: [{ type: "text" as const, text: `Error: agent ${id} not found` }],
            isError: true,
          };
        }

        return {
          content: [{ type: "text" as const, text: JSON.stringify(updated, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error updating agent: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------
  // delete_agent
  // -------------------------------------------------------
  server.tool(
    "delete_agent",
    "Delete an agent permanently.",
    {
      id: z.string().uuid().describe("Agent ID"),
    },
    async (params, extra) => {
      try {
        const orgResult = assertOrgScope(extra);
        if (typeof orgResult !== "string") return orgResult;
        const workspaceId = orgResult;

        const deleted = await deleteScheduledAgentConfig(params.id, workspaceId);
        if (!deleted) {
          return {
            content: [{ type: "text" as const, text: `Error: agent ${params.id} not found` }],
            isError: true,
          };
        }

        return {
          content: [{ type: "text" as const, text: JSON.stringify({ deleted: true, id: params.id }, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error deleting agent: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------
  // trigger_agent — manually run an agent now
  // -------------------------------------------------------
  server.tool(
    "trigger_agent",
    "Manually run an agent now. Optionally accepts a `prompt` that gets concatenated to the agent's system prompt as a user input — same shape as POST /webhooks/agents/:id.",
    {
      id: z.string().uuid().describe("Agent ID"),
      prompt: z.string().optional().describe("Optional user prompt appended to the agent's system prompt"),
    },
    async (params, extra) => {
      try {
        const orgResult = assertOrgScope(extra);
        if (typeof orgResult !== "string") return orgResult;
        const workspaceId = orgResult;

        const config = await getScheduledAgentConfigById(params.id, workspaceId);
        if (!config) {
          return {
            content: [{ type: "text" as const, text: `Error: agent ${params.id} not found` }],
            isError: true,
          };
        }

        const job = await executeScheduledAgentConfig(config, {
          createdByUserId: getUserIdFromExtra(extra) ?? null,
          extraUserPrompt: params.prompt ?? null,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ jobId: job.id, status: job.status }, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error triggering agent: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
};
