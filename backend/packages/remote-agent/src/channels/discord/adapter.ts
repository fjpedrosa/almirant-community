import type { ChannelAdapter } from "../../core/types";
import { DISCORD_LIMITS, type DiscordApiConfig, type DiscordApiMessage, type DiscordChannelMessage, type DiscordChannelThread, type DiscordMessagePayload, type DiscordRichChannelAdapter, type DiscordThreadReply } from "./types";
import { splitMessageContent, stripAnsiForDiscord } from "./formatter";

type AdapterDeps = {
  fetchFn?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

type JsonValue = Record<string, unknown>;

const DEFAULT_API_BASE = "https://discord.com/api/v10";
const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;
const DEFAULT_EDIT_THROTTLE_MS = 1000;
const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_REPLY_TIMEOUT_MS = 5 * 60 * 1000;

const clampThreadName = (name: string): string => {
  const cleaned = name.trim().replace(/\s+/g, " ");
  if (cleaned.length <= DISCORD_LIMITS.threadName) {
    return cleaned;
  }
  return `${cleaned.slice(0, DISCORD_LIMITS.threadName - 1)}…`;
};

const isFiniteNumber = (value: unknown): value is number => {
  return typeof value === "number" && Number.isFinite(value);
};

const toDiscordMessage = (payload: JsonValue): DiscordChannelMessage => {
  return {
    id: String(payload.id ?? ""),
    content: String(payload.content ?? ""),
    raw: {
      id: String(payload.id ?? ""),
      content: String(payload.content ?? ""),
      timestamp:
        typeof payload.timestamp === "string"
          ? payload.timestamp
          : new Date().toISOString(),
      author: (payload.author as { id?: string; username?: string; bot?: boolean } | undefined)
        ? {
            id: String((payload.author as { id?: string }).id ?? ""),
            username: (payload.author as { username?: string }).username,
            bot: (payload.author as { bot?: boolean }).bot,
          }
        : undefined,
    },
  };
};

const toDiscordThread = (payload: JsonValue): DiscordChannelThread => {
  return {
    id: String(payload.id ?? ""),
    name: String(payload.name ?? ""),
    archived: Boolean(payload.archived),
    raw: payload,
  };
};

export class DiscordChannelAdapter implements DiscordRichChannelAdapter {
  private readonly config: DiscordApiConfig;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly lastEditAtByMessage = new Map<string, number>();

  constructor(config: DiscordApiConfig, deps: AdapterDeps = {}) {
    this.config = config;
    this.fetchFn = deps.fetchFn ?? fetch;
    this.now = deps.now ?? (() => Date.now());
    this.sleep =
      deps.sleep ??
      ((ms: number) =>
        new Promise<void>((resolve) => {
          setTimeout(resolve, ms);
        }));
  }

  public async sendMessage(
    threadId: string,
    content: string
  ): Promise<DiscordChannelMessage> {
    const sanitized = stripAnsiForDiscord(content).trim();
    const limited = sanitized.slice(0, DISCORD_LIMITS.messageContent);

    return this.sendRichMessage(threadId, {
      content: limited,
      allowed_mentions: { parse: [] },
    });
  }

  public async editMessage(
    threadId: string,
    messageId: string,
    content: string
  ): Promise<DiscordChannelMessage> {
    await this.waitForEditSlot(messageId);

    const sanitized = stripAnsiForDiscord(content).trim();
    const limited = sanitized.slice(0, DISCORD_LIMITS.messageContent);

    const payload = await this.requestJson(
      `/channels/${encodeURIComponent(threadId)}/messages/${encodeURIComponent(messageId)}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          content: limited,
          allowed_mentions: { parse: [] },
        }),
      }
    );

    return toDiscordMessage(payload);
  }

  public async editRichMessage(
    threadId: string,
    messageId: string,
    payload: DiscordMessagePayload
  ): Promise<DiscordChannelMessage> {
    await this.waitForEditSlot(messageId);

    const sanitizedContent =
      typeof payload.content === "string"
        ? stripAnsiForDiscord(payload.content).trim().slice(0, DISCORD_LIMITS.messageContent)
        : payload.content;

    const body = {
      ...payload,
      content: sanitizedContent,
      allowed_mentions: payload.allowed_mentions ?? { parse: [] },
    };

    const result = await this.requestJson(
      `/channels/${encodeURIComponent(threadId)}/messages/${encodeURIComponent(messageId)}`,
      {
        method: "PATCH",
        body: JSON.stringify(body),
      }
    );

    return toDiscordMessage(result);
  }

  public async createThread(args: {
    channelId: string;
    name: string;
    reason?: string;
    autoArchiveDurationMinutes?: 60 | 1440 | 4320 | 10080;
  }): Promise<DiscordChannelThread> {
    const payload = await this.requestJson(
      `/channels/${encodeURIComponent(args.channelId)}/threads`,
      {
        method: "POST",
        body: JSON.stringify({
          name: clampThreadName(args.name),
          type: 11,
          auto_archive_duration:
            args.autoArchiveDurationMinutes ?? this.config.defaultAutoArchiveMinutes,
        }),
        reason: args.reason,
      }
    );

    return toDiscordThread(payload);
  }

  public async renameThread(
    threadId: string,
    name: string
  ): Promise<DiscordChannelThread> {
    const payload = await this.requestJson(
      `/channels/${encodeURIComponent(threadId)}`,
      {
        method: "PATCH",
        body: JSON.stringify({ name: clampThreadName(name) }),
      }
    );

    return toDiscordThread(payload);
  }

  public async archiveThread(threadId: string): Promise<void> {
    await this.requestJson(`/channels/${encodeURIComponent(threadId)}`, {
      method: "PATCH",
      body: JSON.stringify({ archived: true, locked: false }),
    });
  }

  public async addReaction(
    threadId: string,
    messageId: string,
    emoji: string
  ): Promise<void> {
    await this.request(
      `/channels/${encodeURIComponent(threadId)}/messages/${encodeURIComponent(messageId)}/reactions/${encodeURIComponent(emoji)}/@me`,
      {
        method: "PUT",
      }
    );
  }

  public async deleteMessage(
    threadId: string,
    messageId: string
  ): Promise<void> {
    await this.request(
      `/channels/${encodeURIComponent(threadId)}/messages/${encodeURIComponent(messageId)}`,
      {
        method: "DELETE",
      }
    );
  }

  public async sendRichMessage(
    threadId: string,
    payload: DiscordMessagePayload
  ): Promise<DiscordChannelMessage> {
    const content =
      typeof payload.content === "string"
        ? stripAnsiForDiscord(payload.content)
        : "";

    const chunks = splitMessageContent(content, DISCORD_LIMITS.messageContent);
    const finalChunk = chunks.length > 0 ? chunks[chunks.length - 1] : "";

    let lastMessage: DiscordChannelMessage | null = null;

    for (const [index, chunk] of chunks.entries()) {
      const body = {
        ...payload,
        content: chunk,
        embeds: index === chunks.length - 1 ? payload.embeds : undefined,
      };

      const result = await this.requestJson(
        `/channels/${encodeURIComponent(threadId)}/messages`,
        {
          method: "POST",
          body: JSON.stringify(body),
        }
      );
      lastMessage = toDiscordMessage(result);
    }

    if (!lastMessage) {
      const result = await this.requestJson(
        `/channels/${encodeURIComponent(threadId)}/messages`,
        {
          method: "POST",
          body: JSON.stringify({
            ...payload,
            content: finalChunk,
          }),
        }
      );
      lastMessage = toDiscordMessage(result);
    }

    return lastMessage;
  }

  public async listThreadMessages(args: {
    threadId: string;
    afterMessageId?: string;
    limit?: number;
  }): Promise<DiscordApiMessage[]> {
    const limit = isFiniteNumber(args.limit) ? Math.max(1, Math.min(args.limit, 100)) : 25;
    const query = new URLSearchParams({ limit: String(limit) });

    if (args.afterMessageId) {
      query.set("after", args.afterMessageId);
    }

    const payload = await this.requestJson(
      `/channels/${encodeURIComponent(args.threadId)}/messages?${query.toString()}`,
      {
        method: "GET",
      }
    );

    if (!Array.isArray(payload)) {
      return [];
    }

    return payload.map((row) => {
      const item = row as JsonValue;
      return {
        id: String(item.id ?? ""),
        content: String(item.content ?? ""),
        timestamp:
          typeof item.timestamp === "string"
            ? item.timestamp
            : new Date().toISOString(),
        author: (item.author as { id?: string; username?: string; bot?: boolean } | undefined)
          ? {
              id: String((item.author as { id?: string }).id ?? ""),
              username: (item.author as { username?: string }).username,
              bot: (item.author as { bot?: boolean }).bot,
            }
          : undefined,
      };
    });
  }

  public async waitForThreadReply(args: {
    threadId: string;
    requesterId?: string;
    allowlist?: string[];
    afterMessageId?: string;
    timeoutMs?: number;
    pollIntervalMs?: number;
  }): Promise<DiscordThreadReply | null> {
    const timeoutMs = args.timeoutMs ?? this.config.responseTimeoutMs ?? DEFAULT_REPLY_TIMEOUT_MS;
    const pollIntervalMs = args.pollIntervalMs ?? this.config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const allowlist = (args.allowlist ?? this.config.userAllowlist ?? []).filter(Boolean);

    let afterMessageId = args.afterMessageId;
    const deadline = this.now() + timeoutMs;

    while (this.now() < deadline) {
      const messages = await this.listThreadMessages({
        threadId: args.threadId,
        afterMessageId,
        limit: 25,
      });

      if (messages.length > 0) {
        const newest = messages[0];
        if (newest?.id) {
          afterMessageId = newest.id;
        }
      }

      const chronologic = [...messages].reverse();
      for (const message of chronologic) {
        const userId = message.author?.id ?? "";
        const isBot = Boolean(message.author?.bot);
        const text = message.content.trim();

        if (!userId || isBot || text.length === 0) {
          continue;
        }

        if (args.requesterId && userId !== args.requesterId) {
          continue;
        }

        if (allowlist.length > 0 && !allowlist.includes(userId)) {
          continue;
        }

        return {
          threadId: args.threadId,
          messageId: message.id,
          userId,
          content: text,
          createdAt: message.timestamp ?? new Date().toISOString(),
        };
      }

      await this.sleep(pollIntervalMs);
    }

    return null;
  }

  private async waitForEditSlot(messageId: string): Promise<void> {
    const throttleMs = this.config.messageEditThrottleMs ?? DEFAULT_EDIT_THROTTLE_MS;
    const previous = this.lastEditAtByMessage.get(messageId);

    if (typeof previous === "number") {
      const elapsed = this.now() - previous;
      if (elapsed < throttleMs) {
        await this.sleep(throttleMs - elapsed);
      }
    }

    this.lastEditAtByMessage.set(messageId, this.now());
  }

  private async requestJson(path: string, init: RequestInitWithReason): Promise<JsonValue> {
    const response = await this.request(path, init);
    const text = await response.text();
    if (!text.trim()) {
      return {};
    }

    try {
      return JSON.parse(text) as JsonValue;
    } catch (error) {
      throw new Error(
        `Discord API invalid JSON response: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  private async request(path: string, init: RequestInitWithReason): Promise<Response> {
    const controller = new AbortController();
    const timeoutMs = this.config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const headers = new Headers(init.headers);
      headers.set("Authorization", `Bot ${this.config.botToken}`);
      headers.set("Content-Type", "application/json");

      if (init.reason) {
        headers.set("X-Audit-Log-Reason", init.reason.slice(0, 512));
      }

      const apiBaseUrl = (this.config.apiBaseUrl ?? DEFAULT_API_BASE).replace(/\/+$/, "");
      const response = await this.fetchFn(`${apiBaseUrl}${path}`, {
        ...init,
        headers,
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        const snippet = body.trim().slice(0, 500);
        throw new Error(
          `Discord API error ${response.status}: ${snippet || response.statusText}`
        );
      }

      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

type RequestInitWithReason = RequestInit & {
  reason?: string;
};

export const createDiscordChannelAdapter = (
  config: DiscordApiConfig,
  deps: AdapterDeps = {}
): DiscordRichChannelAdapter => {
  return new DiscordChannelAdapter(config, deps);
};

export type { ChannelAdapter };
