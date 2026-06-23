import { buildThreadCloseMessage, buildThreadOpenMessage } from "./templates";
import type {
  ThreadCloseSummary,
  ThreadLifecycleStatus,
  ThreadManagerLikeAdapter,
  ThreadOpenSummary,
} from "./types";
import { DISCORD_LIMITS } from "./types";

type CreateJobThreadInput = {
  channelId: string;
  skill: string;
  taskIds: string[];
  requesterId?: string;
  model?: string;
  branch?: string;
  reason?: string;
  autoArchiveDurationMinutes?: 60 | 1440 | 4320 | 10080;
};

type RenameOnCompletionInput = {
  threadId: string;
  baseName: string;
  status: ThreadLifecycleStatus;
};

const clampThreadName = (name: string): string => {
  const normalized = name.trim().replace(/\s+/g, " ");
  if (normalized.length <= DISCORD_LIMITS.threadName) {
    return normalized;
  }
  return `${normalized.slice(0, DISCORD_LIMITS.threadName - 1)}…`;
};

const statusPrefix = (status: ThreadLifecycleStatus): string => {
  if (status === "completed") return "✅";
  if (status === "incomplete") return "⚠️";
  if (status === "failed") return "❌";
  return "⏸️";
};

export class DiscordThreadManager {
  private readonly adapter: ThreadManagerLikeAdapter;

  constructor(adapter: ThreadManagerLikeAdapter) {
    this.adapter = adapter;
  }

  public buildThreadName(skill: string, taskIds: string[]): string {
    const compactTaskIds = taskIds.filter(Boolean).join("-");
    const raw = compactTaskIds.length > 0 ? `🔧 Implementando ${compactTaskIds}` : `🔧 ${skill}`;
    return clampThreadName(raw);
  }

  public async createJobThread(input: CreateJobThreadInput) {
    const name = this.buildThreadName(input.skill, input.taskIds);
    const thread = await this.adapter.createThread({
      channelId: input.channelId,
      name,
      reason: input.reason,
      autoArchiveDurationMinutes: input.autoArchiveDurationMinutes,
    });

    const openSummary: ThreadOpenSummary = {
      skill: input.skill,
      taskIds: input.taskIds,
      requesterId: input.requesterId,
      model: input.model,
      branch: input.branch,
    };

    await this.adapter.sendRichMessage(thread.id, buildThreadOpenMessage(openSummary));

    return thread;
  }

  public async renameOnCompletion(input: RenameOnCompletionInput) {
    const prefixed = clampThreadName(
      `${statusPrefix(input.status)} ${input.baseName}`
    );
    return this.adapter.renameThread(input.threadId, prefixed);
  }

  public async postClosingSummary(
    threadId: string,
    summary: ThreadCloseSummary
  ) {
    await this.adapter.sendRichMessage(threadId, buildThreadCloseMessage(summary));
  }

  public async archive(threadId: string): Promise<void> {
    await this.adapter.archiveThread(threadId);
  }
}

export const createDiscordThreadManager = (
  adapter: ThreadManagerLikeAdapter
): DiscordThreadManager => new DiscordThreadManager(adapter);
