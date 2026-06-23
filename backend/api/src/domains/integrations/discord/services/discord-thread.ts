import { env, logger } from "@almirant/config";

/**
 * Create a Discord thread via the discord-bridge service.
 * The bridge handles all Discord API communication (rate limiting, thread creation, initial message).
 * Returns the thread ID, or null if the bridge is not configured or the call fails.
 */
export const createDiscordThread = async (params: {
  jobType: string;
  taskId: string;
  channelId?: string;
  initialMessage?: string;
}): Promise<string | null> => {
  const bridgeUrl = env.DISCORD_BRIDGE_URL?.trim();
  if (!bridgeUrl) {
    return null;
  }

  try {
    const response = await fetch(`${bridgeUrl.replace(/\/+$/, "")}/threads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jobType: params.jobType,
        taskId: params.taskId,
        ...(params.channelId ? { channelId: params.channelId } : {}),
        ...(params.initialMessage ? { initialMessage: params.initialMessage } : {}),
      }),
      signal: AbortSignal.timeout(5_000),
    });

    if (!response.ok) {
      const raw = await response.text().catch(() => "");
      logger.warn(
        { status: response.status, body: raw.slice(0, 500) },
        "discord-bridge: failed to create thread"
      );
      return null;
    }

    const payload = (await response.json()) as { threadId?: string };
    return payload.threadId ?? null;
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : String(error) },
      "discord-bridge: thread creation error"
    );
    return null;
  }
};

/**
 * Rename a Discord thread via the discord-bridge service.
 * Best-effort — returns true on success, false on failure.
 */
export const renameDiscordThread = async (
  threadId: string,
  name: string,
): Promise<boolean> => {
  const bridgeUrl = env.DISCORD_BRIDGE_URL?.trim();
  if (!bridgeUrl) {
    return false;
  }

  try {
    const response = await fetch(
      `${bridgeUrl.replace(/\/+$/, "")}/threads/${encodeURIComponent(threadId)}/rename`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
        signal: AbortSignal.timeout(5_000),
      },
    );

    if (!response.ok) {
      const raw = await response.text().catch(() => "");
      logger.warn(
        { status: response.status, body: raw.slice(0, 500), threadId },
        "discord-bridge: failed to rename thread",
      );
      return false;
    }

    return true;
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : String(error), threadId },
      "discord-bridge: thread rename error",
    );
    return false;
  }
};

/**
 * Check whether discord-bridge is configured (DISCORD_BRIDGE_URL is set).
 */
export const isDiscordBridgeConfigured = (): boolean => {
  return Boolean(env.DISCORD_BRIDGE_URL?.trim());
};
