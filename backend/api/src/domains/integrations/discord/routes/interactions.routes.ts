import { Elysia } from "elysia";
import nacl from "tweetnacl";
import { env, logger } from "@almirant/config";
import {
  agentJobs,
  createJob,
  db,
  desc,
  eq,
  getJobById,
  getPendingInteractionForJob,
  getWorkItemByTaskIdExact,
  inArray,
  projects,
  respondToInteraction,
  updateJobStatus,
  workItems,
} from "@almirant/database";
import type { AgentJobConfig } from "@almirant/database";
import {
  buildSessionControlComponents,
  type DiscordActionRow,
} from "@almirant/remote-agent";
import { getCommandOptionValue } from "../services/discord-commands";
import { createDiscordThread, isDiscordBridgeConfigured } from "../services/discord-thread";
import { resolveDiscordChannel } from "../services/resolve-discord-channel";
import { broadcastAgentJobStatusChanged } from "../../../../shared/ws/agent-job-events";

const DISCORD_API_BASE = "https://discord.com/api/v10";

const INTERACTION_TYPE = {
  PING: 1,
  APPLICATION_COMMAND: 2,
  MESSAGE_COMPONENT: 3,
} as const;

const RESPONSE_TYPE = {
  PONG: 1,
  CHANNEL_MESSAGE: 4,
  DEFERRED_CHANNEL_MESSAGE: 5,
  DEFERRED_UPDATE: 6,
  UPDATE_MESSAGE: 7,
} as const;

const EPHEMERAL_FLAG = 1 << 6;

type DiscordInteraction = {
  id: string;
  type: number;
  token: string;
  application_id: string;
  guild_id?: string;
  channel_id?: string;
  member?: { user?: { id?: string } };
  user?: { id?: string };
  message?: {
    id?: string;
    components?: Array<Record<string, unknown>>;
  };
  data?: {
    name?: string;
    options?: Array<{ name?: string; value?: unknown }>;
    custom_id?: string;
    component_type?: number;
    values?: string[];
  };
};

type DiscordWebhookMessagePayload = {
  content?: string;
  flags?: number;
  components?: DiscordActionRow[];
};

const getDiscordUserId = (interaction: DiscordInteraction): string => {
  return (
    interaction.member?.user?.id ??
    interaction.user?.id ??
    "discord-anonymous"
  );
};

const decodeHex = (hex: string): Uint8Array | null => {
  const normalized = hex.trim();
  if (normalized.length === 0 || normalized.length % 2 !== 0) {
    return null;
  }

  const bytes = new Uint8Array(normalized.length / 2);
  for (let index = 0; index < normalized.length; index += 2) {
    const byte = Number.parseInt(normalized.slice(index, index + 2), 16);
    if (Number.isNaN(byte)) {
      return null;
    }
    bytes[index / 2] = byte;
  }

  return bytes;
};

const verifyDiscordSignature = (params: {
  rawBody: string;
  signature: string;
  timestamp: string;
}): boolean => {
  if (!env.DISCORD_PUBLIC_KEY) {
    logger.warn("DISCORD_PUBLIC_KEY not configured, skipping Discord signature verification");
    return true;
  }

  const signatureBytes = decodeHex(params.signature);
  const publicKeyBytes = decodeHex(env.DISCORD_PUBLIC_KEY);

  if (!signatureBytes || !publicKeyBytes) {
    return false;
  }

  const encoder = new TextEncoder();
  const message = encoder.encode(`${params.timestamp}${params.rawBody}`);
  return nacl.sign.detached.verify(message, signatureBytes, publicKeyBytes);
};

const parseInteraction = (rawBody: string): DiscordInteraction | null => {
  try {
    return JSON.parse(rawBody) as DiscordInteraction;
  } catch {
    return null;
  }
};

const getApplicationId = (interaction: DiscordInteraction): string | null => {
  const fromPayload = interaction.application_id?.trim();
  if (fromPayload) {
    return fromPayload;
  }

  const fromEnv = env.DISCORD_APPLICATION_ID?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : null;
};

const webhookRequest = async (params: {
  interaction: DiscordInteraction;
  path: string;
  method: "PATCH" | "POST" | "GET";
  body?: unknown;
}): Promise<Response> => {
  const applicationId = getApplicationId(params.interaction);
  if (!applicationId) {
    throw new Error("Missing Discord application id");
  }

  const url = `${DISCORD_API_BASE}/webhooks/${applicationId}/${params.interaction.token}${params.path}`;
  return fetch(url, {
    method: params.method,
    headers: {
      "Content-Type": "application/json",
    },
    body: params.body === undefined ? undefined : JSON.stringify(params.body),
  });
};

const editOriginalResponse = async (
  interaction: DiscordInteraction,
  payload: DiscordWebhookMessagePayload
): Promise<void> => {
  const response = await webhookRequest({
    interaction,
    path: "/messages/@original",
    method: "PATCH",
    body: payload,
  });

  if (!response.ok) {
    const raw = await response.text().catch(() => "");
    logger.warn(
      { status: response.status, body: raw.slice(0, 500) },
      "Failed to edit Discord original interaction response"
    );
  }
};

const sendFollowup = async (
  interaction: DiscordInteraction,
  payload: DiscordWebhookMessagePayload
): Promise<void> => {
  const response = await webhookRequest({
    interaction,
    path: "",
    method: "POST",
    body: payload,
  });

  if (!response.ok) {
    const raw = await response.text().catch(() => "");
    logger.warn(
      { status: response.status, body: raw.slice(0, 500) },
      "Failed to send Discord follow-up message"
    );
  }
};

const createThreadForCommand = async (params: {
  channelId: string;
  jobType: string;
  taskId: string;
}): Promise<string | null> => {
  // Route through discord-bridge if configured; the bridge centralizes
  // all Discord API calls (rate limiting, thread naming).
  if (isDiscordBridgeConfigured()) {
    return createDiscordThread({
      jobType: params.jobType,
      taskId: params.taskId,
      channelId: params.channelId,
    });
  }

  // Fallback: create thread directly (keeps slash commands working even without bridge)
  const botToken = env.DISCORD_BOT_TOKEN?.trim();
  if (!botToken) return null;

  try {
    const JOB_TYPE_LABELS: Record<string, { emoji: string; label: string }> = {
      implementation: { emoji: "🔧", label: "Implementando" },
      planning: { emoji: "📋", label: "Planificando" },
    };
    const { emoji, label } = JOB_TYPE_LABELS[params.jobType] ?? { emoji: "🔧", label: "Procesando" };
    const threadName = `${emoji} ${label} ${params.taskId}`.slice(0, 100);

    const response = await fetch(
      `${DISCORD_API_BASE}/channels/${params.channelId}/threads`,
      {
        method: "POST",
        headers: {
          Authorization: `Bot ${botToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: threadName,
          type: 12,
          auto_archive_duration: 1440,
          invitable: false,
        }),
        signal: AbortSignal.timeout(5_000),
      }
    );

    if (!response.ok) return null;
    const payload = (await response.json()) as { id?: string };
    return payload.id ?? null;
  } catch {
    return null;
  }
};

const resolveWorkspaceIdForWorkItem = async (
  workItemId: string
): Promise<string | null> => {
  const [row] = await db
    .select({ workspaceId: projects.workspaceId })
    .from(workItems)
    .innerJoin(projects, eq(workItems.projectId, projects.id))
    .where(eq(workItems.id, workItemId))
    .limit(1);

  return row?.workspaceId ?? null;
};

const parseAction = (customId: string): {
  action: string;
  jobId: string;
  extra?: string;
} | null => {
  const [action = "", jobId = "", extra] = customId.split(":");
  if (!action || !jobId) {
    return null;
  }
  return {
    action,
    jobId,
    extra,
  };
};

const disableMessageComponents = (
  messageComponents: Array<Record<string, unknown>> | undefined
): DiscordActionRow[] => {
  if (!Array.isArray(messageComponents)) {
    return [];
  }

  return messageComponents
    .map((row) => {
      if (row.type !== 1 || !Array.isArray(row.components)) {
        return null;
      }

      const components = row.components
        .map((component) => {
          if (typeof component !== "object" || component === null) {
            return null;
          }

          const typed = component as Record<string, unknown>;
          return {
            ...typed,
            disabled: true,
          };
        })
        .filter(Boolean) as Array<Record<string, unknown>>;

      return {
        type: 1,
        components,
      } as DiscordActionRow;
    })
    .filter(Boolean) as DiscordActionRow[];
};

const getActiveStatusLines = async (): Promise<string[]> => {
  const active = await db
    .select({
      id: agentJobs.id,
      status: agentJobs.status,
      jobType: agentJobs.jobType,
      workItemId: agentJobs.workItemId,
      createdAt: agentJobs.createdAt,
    })
    .from(agentJobs)
    .where(
      inArray(agentJobs.status, ["queued", "running", "finalizing", "waiting_for_input", "paused"])
    )
    .orderBy(desc(agentJobs.createdAt))
    .limit(8);

  if (active.length === 0) {
    return ["No active jobs."];
  }

  return active.map((job) => {
    const label = job.workItemId ? `workItem=${job.workItemId}` : "planning";
    return `- ${job.id} | ${job.status} | ${job.jobType} | ${label}`;
  });
};

const handleStatusCommand = async (
  interaction: DiscordInteraction
): Promise<Record<string, unknown>> => {
  const requestedJobId = getCommandOptionValue(interaction.data?.options, "job_id");
  if (requestedJobId) {
    const found = await getJobById(requestedJobId);
    if (!found) {
      return {
        type: RESPONSE_TYPE.CHANNEL_MESSAGE,
        data: {
          flags: EPHEMERAL_FLAG,
          content: `Job not found: ${requestedJobId}`,
        },
      };
    }

    return {
      type: RESPONSE_TYPE.CHANNEL_MESSAGE,
      data: {
        flags: EPHEMERAL_FLAG,
        content:
          `Job ${found.job.id}\n` +
          `Status: ${found.job.status}\n` +
          `Type: ${found.job.jobType}\n` +
          `Work item: ${found.job.workItemId ?? "n/a"}`,
      },
    };
  }

  const lines = await getActiveStatusLines();
  return {
    type: RESPONSE_TYPE.CHANNEL_MESSAGE,
    data: {
      flags: EPHEMERAL_FLAG,
      content: `Active jobs:\n${lines.join("\n")}`,
    },
  };
};

const VALID_PROVIDERS: Array<"claude-code" | "codex" | "zipu" | "grok"> = [
  "claude-code",
  "codex",
  "zipu",
  "grok",
];

const DEFAULT_PROVIDER: "claude-code" | "codex" | "zipu" | "grok" = "codex";

const queueCommandJob = async (params: {
  interaction: DiscordInteraction;
  commandName: "implement" | "plan";
}): Promise<void> => {
  await editOriginalResponse(params.interaction, {
    flags: EPHEMERAL_FLAG,
    content: `Processing /${params.commandName}...`,
  });

  const taskId = getCommandOptionValue(params.interaction.data?.options, "work_item_id");
  if (!taskId) {
    await sendFollowup(params.interaction, {
      flags: EPHEMERAL_FLAG,
      content: "Missing required option: work_item_id",
    });
    return;
  }

  const workItem = await getWorkItemByTaskIdExact(taskId);
  if (!workItem) {
    await sendFollowup(params.interaction, {
      flags: EPHEMERAL_FLAG,
      content: `Work item not found: ${taskId}`,
    });
    return;
  }

  const workspaceId = await resolveWorkspaceIdForWorkItem(workItem.id);
  const requesterDiscordUserId = getDiscordUserId(params.interaction);

  // Resolve provider: use the optional slash command option, falling back to DEFAULT_PROVIDER.
  const rawProvider = getCommandOptionValue(params.interaction.data?.options, "provider");
  const provider: "claude-code" | "codex" | "zipu" | "grok" =
    rawProvider && VALID_PROVIDERS.includes(rawProvider as typeof DEFAULT_PROVIDER)
      ? (rawProvider as typeof DEFAULT_PROVIDER)
      : DEFAULT_PROVIDER;

  // Create the Discord thread first so we can store the threadId in the job config.
  const jobType = params.commandName === "plan" ? "planning" : "implementation";

  // Resolve target channel: project override > org default > env var > interaction channel
  const resolved = await resolveDiscordChannel({
    projectId: workItem.projectId,
    workspaceId,
  });
  const targetChannelId = resolved?.channelId ?? params.interaction.channel_id;

  if (resolved) {
    logger.debug({ source: resolved.source, channelId: resolved.channelId, taskId }, "Discord channel resolved");
  }

  const createdThreadId = targetChannelId
    ? await createThreadForCommand({
        channelId: targetChannelId,
        jobType,
        taskId,
      })
    : null;

  const config: AgentJobConfig & {
    requesterDiscordUserId?: string;
    sourceChannelId?: string;
    sourceGuildId?: string;
    threadId?: string;
  } = {
    repoPath: ".",
    baseBranch: "main",
    skillName: params.commandName === "implement" ? "runner-implement" : params.commandName,
    ...(workItem.taskId ? { taskId: workItem.taskId } : {}),
    ...(typeof workItem.title === "string" && workItem.title.trim().length > 0
      ? { workItemTitle: workItem.title }
      : {}),
    requesterDiscordUserId,
    sourceChannelId: params.interaction.channel_id,
    sourceGuildId: params.interaction.guild_id,
    ...(createdThreadId ? { threadId: createdThreadId } : {}),
  };

  const createdJob = await createJob({
    projectId: workItem.projectId,
    boardId: workItem.boardId,
    workItemId: workItem.id,
    workspaceId,
    provider,
    priority: "medium",
    jobType: params.commandName === "plan" ? "planning" : "implementation",
    config,
    codingAgent: "claude-code",
    aiProvider: "anthropic",
    model: "claude-opus-4-6",
    skillName: config.skillName ?? "implement",
  });

  broadcastAgentJobStatusChanged({
    workspaceId: createdJob.workspaceId,
    jobId: createdJob.id,
    status: createdJob.status,
    workItemId: createdJob.workItemId ?? null,
    planningSessionId: createdJob.planningSessionId ?? null,
  });

  const threadLink =
    createdThreadId && params.interaction.guild_id
      ? `https://discord.com/channels/${params.interaction.guild_id}/${createdThreadId}`
      : null;

  await sendFollowup(params.interaction, {
    flags: EPHEMERAL_FLAG,
    content:
      `Queued ${params.commandName} job.\n` +
      `Job ID: ${createdJob.id}\n` +
      `Provider: ${provider}\n` +
      `Work item: ${taskId}` +
      (threadLink ? `\nThread: ${threadLink}` : ""),
  });
};

const handleApplicationCommand = async (
  interaction: DiscordInteraction
): Promise<Record<string, unknown>> => {
  const commandName = interaction.data?.name?.trim().toLowerCase();

  switch (commandName) {
    case "implement":
    case "plan": {
      void queueCommandJob({
        interaction,
        commandName,
      }).catch((error) => {
        logger.error(error, "Failed to queue Discord slash command job");
        void sendFollowup(interaction, {
          flags: EPHEMERAL_FLAG,
          content: "Failed to queue command. Check API logs.",
        });
      });

      return {
        type: RESPONSE_TYPE.DEFERRED_CHANNEL_MESSAGE,
        data: {
          flags: EPHEMERAL_FLAG,
        },
      };
    }

    case "status":
      return handleStatusCommand(interaction);

    default:
      return {
        type: RESPONSE_TYPE.CHANNEL_MESSAGE,
        data: {
          flags: EPHEMERAL_FLAG,
          content: `Unsupported command: ${commandName ?? "unknown"}`,
        },
      };
  }
};

const processControlButton = async (params: {
  interaction: DiscordInteraction;
  action: string;
  jobId: string;
}): Promise<void> => {
  const existing = await getJobById(params.jobId);
  if (!existing) {
    logger.warn({ jobId: params.jobId }, "Discord control button: job not found");
    await editOriginalResponse(params.interaction, {
      content: "Job not found.",
    });
    return;
  }

  if (!["queued", "running", "finalizing", "waiting_for_input", "paused"].includes(existing.job.status)) {
    logger.info(
      { jobId: params.jobId, status: existing.job.status },
      "Discord control button: job already in terminal status"
    );
    await editOriginalResponse(params.interaction, {
      content: `Job is already ${existing.job.status}.`,
    });
    return;
  }

  const currentResult =
    typeof existing.job.result === "object" && existing.job.result !== null
      ? (existing.job.result as unknown as Record<string, unknown>)
      : {};
  const shutdownRequested = params.action === "shutdown";

  await updateJobStatus(params.jobId, "cancelled", {
    completedAt: new Date(),
    result: {
      ...currentResult,
      cancelledBy: "discord",
      shutdownRequested,
    },
  });

  await editOriginalResponse(params.interaction, {
    content: shutdownRequested ? "⚫ Shutdown" : "🔴 Stopped",
    components: buildSessionControlComponents(
      params.jobId,
      shutdownRequested ? "shutdown" : "stopped"
    ),
  });
};

const handleControlButton = (params: {
  interaction: DiscordInteraction;
  action: string;
  jobId: string;
}): Record<string, unknown> => {
  logger.info({ action: params.action, jobId: params.jobId }, "Discord control button received");

  if (params.action === "resume") {
    return {
      type: RESPONSE_TYPE.CHANNEL_MESSAGE,
      data: {
        flags: EPHEMERAL_FLAG,
        content: "Resume is not available yet. Use /implement to relaunch.",
      },
    };
  }

  void processControlButton(params).catch((error) => {
    logger.error(
      { error, action: params.action, jobId: params.jobId },
      "Failed to process Discord control button"
    );
    void editOriginalResponse(params.interaction, {
      content: "Failed to process button action. Check API logs.",
    });
  });

  return { type: RESPONSE_TYPE.DEFERRED_UPDATE };
};

const processAnswerComponent = async (params: {
  interaction: DiscordInteraction;
  jobId: string;
  optionHint?: string;
}): Promise<void> => {
  const pending = await getPendingInteractionForJob(params.jobId);
  if (!pending) {
    logger.info({ jobId: params.jobId }, "Discord answer component: no pending interaction found");
    await editOriginalResponse(params.interaction, {
      content: "This question is no longer active.",
      components: disableMessageComponents(params.interaction.message?.components),
    });
    return;
  }

  const options = Array.isArray(pending.options) ? pending.options : [];

  let selected = "";
  const isSelectMenu = params.interaction.data?.component_type === 3;

  if (isSelectMenu) {
    const selectedValue = params.interaction.data?.values?.[0] ?? "";
    const selectedIndex = Number.parseInt(selectedValue, 10);
    if (!Number.isNaN(selectedIndex) && selectedIndex >= 0 && selectedIndex < options.length) {
      selected = options[selectedIndex] ?? "";
    } else {
      selected = selectedValue;
    }
  } else {
    const optionIndex = Number.parseInt(params.optionHint ?? "", 10);
    if (!Number.isNaN(optionIndex) && optionIndex >= 0 && optionIndex < options.length) {
      selected = options[optionIndex] ?? "";
    }
  }

  if (!selected.trim()) {
    logger.warn(
      { jobId: params.jobId, optionHint: params.optionHint },
      "Discord answer component: could not parse selected option"
    );
    await editOriginalResponse(params.interaction, {
      content: "Could not parse selected option.",
    });
    return;
  }

  const updated = await respondToInteraction(
    pending.id,
    selected,
    `discord:${getDiscordUserId(params.interaction)}`,
    {
      source: "discord_component",
      customId: params.interaction.data?.custom_id ?? "",
      selected,
    }
  );

  if (!updated) {
    logger.info({ jobId: params.jobId }, "Discord answer component: interaction already answered");
    await editOriginalResponse(params.interaction, {
      content: "This interaction was already answered.",
      components: disableMessageComponents(params.interaction.message?.components),
    });
    return;
  }

  await updateJobStatus(params.jobId, "running");

  await editOriginalResponse(params.interaction, {
    content: `✅ Selected: ${selected}`,
    components: disableMessageComponents(params.interaction.message?.components),
  });
};

const handleAnswerComponent = (params: {
  interaction: DiscordInteraction;
  jobId: string;
  optionHint?: string;
}): Record<string, unknown> => {
  logger.info({ jobId: params.jobId, optionHint: params.optionHint }, "Discord answer component received");

  void processAnswerComponent(params).catch((error) => {
    logger.error(
      { error, jobId: params.jobId },
      "Failed to process Discord answer component"
    );
    void editOriginalResponse(params.interaction, {
      content: "Failed to process answer. Check API logs.",
    });
  });

  return { type: RESPONSE_TYPE.DEFERRED_UPDATE };
};

const handleMessageComponent = async (
  interaction: DiscordInteraction
): Promise<Record<string, unknown>> => {
  const customId = interaction.data?.custom_id?.trim();
  logger.debug({ customId }, "Discord message component received");
  if (!customId) {
    return {
      type: RESPONSE_TYPE.CHANNEL_MESSAGE,
      data: {
        flags: EPHEMERAL_FLAG,
        content: "Missing custom_id",
      },
    };
  }

  const parsed = parseAction(customId);
  if (!parsed) {
    return {
      type: RESPONSE_TYPE.CHANNEL_MESSAGE,
      data: {
        flags: EPHEMERAL_FLAG,
        content: "Invalid custom_id format",
      },
    };
  }

  if (parsed.action === "stop" || parsed.action === "shutdown" || parsed.action === "resume") {
    return handleControlButton({
      interaction,
      action: parsed.action,
      jobId: parsed.jobId,
    });
  }

  if (parsed.action === "answer") {
    return handleAnswerComponent({
      interaction,
      jobId: parsed.jobId,
      optionHint: parsed.extra,
    });
  }

  return {
    type: RESPONSE_TYPE.CHANNEL_MESSAGE,
    data: {
      flags: EPHEMERAL_FLAG,
      content: `Unsupported action: ${parsed.action}`,
    },
  };
};

export const discordInteractionsRoutes = new Elysia().post(
  "/webhooks/discord/interactions",
  async ({ request, set }) => {
    const signature = request.headers.get("x-signature-ed25519") ?? "";
    const timestamp = request.headers.get("x-signature-timestamp") ?? "";
    const rawBody = await request.text();

    const interaction = parseInteraction(rawBody);
    logger.info(
      {
        interactionType: interaction?.type,
        hasSignature: !!signature,
        hasTimestamp: !!timestamp,
      },
      "Discord interaction received"
    );

    if (!verifyDiscordSignature({ rawBody, signature, timestamp })) {
      set.status = 401;
      return {
        type: RESPONSE_TYPE.CHANNEL_MESSAGE,
        data: {
          flags: EPHEMERAL_FLAG,
          content: "Invalid Discord signature",
        },
      };
    }

    if (!interaction) {
      set.status = 400;
      return {
        type: RESPONSE_TYPE.CHANNEL_MESSAGE,
        data: {
          flags: EPHEMERAL_FLAG,
          content: "Invalid JSON payload",
        },
      };
    }

    if (interaction.type === INTERACTION_TYPE.PING) {
      return { type: RESPONSE_TYPE.PONG };
    }

    if (interaction.type === INTERACTION_TYPE.APPLICATION_COMMAND) {
      return handleApplicationCommand(interaction);
    }

    if (interaction.type === INTERACTION_TYPE.MESSAGE_COMPONENT) {
      return handleMessageComponent(interaction);
    }

    return {
      type: RESPONSE_TYPE.CHANNEL_MESSAGE,
      data: {
        flags: EPHEMERAL_FLAG,
        content: `Unsupported interaction type: ${interaction.type}`,
      },
    };
  }
);
