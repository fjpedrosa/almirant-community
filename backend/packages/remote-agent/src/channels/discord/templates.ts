import type { DiscordEmbed, DiscordMessagePayload, ThreadCloseSummary, ThreadOpenSummary } from "./types";
import { DISCORD_LIMITS } from "./types";

const clamp = (value: string, max: number): string => {
  if (value.length <= max) return value;
  if (max <= 1) return value.slice(0, max);
  return `${value.slice(0, max - 1)}…`;
};

const formatDuration = (durationMs?: number): string => {
  if (typeof durationMs !== "number" || Number.isNaN(durationMs)) {
    return "n/a";
  }
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
};

const statusColor = (status: ThreadCloseSummary["status"]): number => {
  if (status === "completed") return 0x57f287;
  if (status === "incomplete") return 0xfee75c;
  if (status === "failed") return 0xed4245;
  return 0xfee75c;
};

const statusLabel = (status: ThreadCloseSummary["status"]): string => {
  if (status === "completed") return "Completed";
  if (status === "incomplete") return "Incomplete";
  if (status === "failed") return "Failed";
  return "Completed with warnings";
};

const openEmbed = (summary: ThreadOpenSummary): DiscordEmbed => ({
  title: clamp("Remote Agent session started", DISCORD_LIMITS.embedTitle),
  description: clamp(
    `Skill: ${summary.skill}\nTasks: ${summary.taskIds.join(", ") || "n/a"}`,
    DISCORD_LIMITS.embedDescription
  ),
  color: 0x5865f2,
  fields: [
    {
      name: "Model",
      value: clamp(summary.model ?? "n/a", DISCORD_LIMITS.embedFieldValue),
      inline: true,
    },
    {
      name: "Branch",
      value: clamp(summary.branch ?? "n/a", DISCORD_LIMITS.embedFieldValue),
      inline: true,
    },
  ],
  timestamp: new Date().toISOString(),
});

const closeEmbed = (summary: ThreadCloseSummary): DiscordEmbed => ({
  title: clamp(`Session ${statusLabel(summary.status)}`, DISCORD_LIMITS.embedTitle),
  description: clamp(summary.notes ?? "Execution finished.", DISCORD_LIMITS.embedDescription),
  color: statusColor(summary.status),
  fields: [
    {
      name: "Duration",
      value: clamp(formatDuration(summary.durationMs), DISCORD_LIMITS.embedFieldValue),
      inline: true,
    },
    {
      name: "Tokens",
      value: clamp(
        typeof summary.tokensUsed === "number"
          ? summary.tokensUsed.toLocaleString("en-US")
          : "n/a",
        DISCORD_LIMITS.embedFieldValue
      ),
      inline: true,
    },
    {
      name: "Files",
      value: clamp(
        typeof summary.filesChanged === "number"
          ? String(summary.filesChanged)
          : "n/a",
        DISCORD_LIMITS.embedFieldValue
      ),
      inline: true,
    },
    {
      name: "PR",
      value: clamp(summary.prUrl ?? "n/a", DISCORD_LIMITS.embedFieldValue),
      inline: false,
    },
  ],
  timestamp: new Date().toISOString(),
});

export const buildThreadOpenMessage = (
  summary: ThreadOpenSummary
): DiscordMessagePayload => {
  const mention = summary.requesterId ? `<@${summary.requesterId}>` : "";
  const content = mention
    ? `${mention} session started for ${summary.taskIds.join(", ")}`
    : `Session started for ${summary.taskIds.join(", ")}`;

  return {
    content,
    embeds: [openEmbed(summary)],
    allowed_mentions: summary.requesterId
      ? {
          parse: [],
          users: [summary.requesterId],
        }
      : { parse: [] },
  };
};

export const buildThreadCloseMessage = (
  summary: ThreadCloseSummary
): DiscordMessagePayload => {
  return {
    embeds: [closeEmbed(summary)],
    allowed_mentions: { parse: [] },
  };
};
