// backend/packages/remote-agent/src/channels/discord/dashboard.ts

import type { DiscordEmbed, DiscordMessagePayload } from "./types";
import { DISCORD_LIMITS } from "./types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DashboardActionStatus = "running" | "completed" | "error";

export type DashboardAction = {
  tool: string;
  summary: string;
  status: DashboardActionStatus;
  timestamp: number;
};

export type DashboardStatus = "running" | "completed" | "incomplete" | "failed" | "cancelled";

export type DashboardState = {
  title: string;
  description: string;
  model: string;
  startedAt: number;
  status: DashboardStatus;
  currentAction?: DashboardAction;
  recentActions: DashboardAction[]; // completed actions, newest first, max 8
  tokens: { in: number; out: number };
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createDashboardState = (params: {
  title: string;
  description?: string;
  model: string;
}): DashboardState => ({
  title: params.title,
  description: params.description ?? "",
  model: params.model,
  startedAt: Date.now(),
  status: "running",
  currentAction: undefined,
  recentActions: [],
  tokens: { in: 0, out: 0 },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MAX_RECENT_ACTIONS = 8;

const clamp = (value: string, max: number): string => {
  if (value.length <= max) return value;
  if (max <= 1) return value.slice(0, max);
  return `${value.slice(0, max - 1)}…`;
};

const formatDurationMs = (ms: number): string => {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
};

const formatTokenCount = (value: number): string => {
  if (!Number.isFinite(value) || value === 0) return "0";
  return value.toLocaleString("en-US");
};

const shortenPath = (path: string, maxLen = 50): string => {
  if (path.length <= maxLen) return path;
  return `...${path.slice(-(maxLen - 3))}`;
};

const statusColor = (status: DashboardStatus): number => {
  switch (status) {
    case "completed":
      return 0x57f287; // green
    case "incomplete":
      return 0xfee75c; // yellow
    case "failed":
      return 0xed4245; // red
    case "cancelled":
      return 0xfee75c; // yellow
    default:
      return 0x5865f2; // blue (running)
  }
};

const statusLabel = (status: DashboardStatus): string => {
  switch (status) {
    case "completed":
      return "Completed";
    case "incomplete":
      return "Incomplete";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    default:
      return "Running";
  }
};

// ---------------------------------------------------------------------------
// State mutation helpers
// ---------------------------------------------------------------------------

export const dashboardSetToolRunning = (
  state: DashboardState,
  tool: string,
  summary: string,
): void => {
  state.currentAction = { tool, summary, status: "running", timestamp: Date.now() };
};

export const dashboardCompleteCurrentTool = (
  state: DashboardState,
  tool: string,
  summary: string,
  error = false,
): void => {
  state.recentActions.unshift({
    tool,
    summary,
    status: error ? "error" : "completed",
    timestamp: Date.now(),
  });
  if (state.recentActions.length > MAX_RECENT_ACTIONS) {
    state.recentActions.length = MAX_RECENT_ACTIONS;
  }
  // Clear current if it matches this tool (a new tool might have started in parallel)
  if (state.currentAction?.tool === tool) {
    state.currentAction = undefined;
  }
};

export const dashboardAddTokens = (
  state: DashboardState,
  input: number,
  output: number,
): void => {
  state.tokens.in += input;
  state.tokens.out += output;
};

// ---------------------------------------------------------------------------
// Tool action formatter
// ---------------------------------------------------------------------------

const extractString = (obj: Record<string, unknown> | undefined, ...keys: string[]): string => {
  if (!obj) return "";
  for (const key of keys) {
    const val = obj[key];
    if (typeof val === "string" && val.length > 0) return val;
  }
  return "";
};

export const parseToolInput = (raw: unknown): Record<string, unknown> | undefined => {
  if (typeof raw === "object" && raw !== null) return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }
  return undefined;
};

export const formatToolAction = (
  toolName: string,
  input?: Record<string, unknown>,
): string => {
  const name = toolName.toLowerCase();

  // File operations
  if (name === "read" || name.endsWith("_read") || name === "oc-read") {
    const file = extractString(input, "file_path", "path", "filePath");
    return file ? `read ${shortenPath(file)}` : "read file";
  }
  if (name === "write" || name.endsWith("_write") || name === "oc-write") {
    const file = extractString(input, "file_path", "path", "filePath");
    return file ? `write ${shortenPath(file)}` : "write file";
  }
  if (name === "edit" || name.endsWith("_edit") || name === "oc-edit") {
    const file = extractString(input, "file_path", "path", "filePath");
    return file ? `edit ${shortenPath(file)}` : "edit file";
  }

  // Bash
  if (name === "bash" || name.endsWith("_bash") || name === "oc-bash") {
    const cmd = extractString(input, "command", "cmd");
    return cmd ? `bash \`${cmd.slice(0, 80)}\`` : "bash command";
  }

  // Search
  if (name === "glob" || name.endsWith("_glob") || name === "oc-glob") {
    const pattern = extractString(input, "pattern");
    return pattern ? `glob ${pattern}` : "glob search";
  }
  if (name === "grep" || name.endsWith("_grep") || name === "oc-grep") {
    const pattern = extractString(input, "pattern");
    return pattern ? `grep \`${pattern.slice(0, 60)}\`` : "grep search";
  }

  // Agents / skills
  if (name === "task" || name.endsWith("_task") || name === "oc-task") {
    const desc = extractString(input, "description", "prompt");
    return desc ? `subagent: ${desc.slice(0, 60)}` : "spawn subagent";
  }
  if (name === "skill" || name.endsWith("_skill") || name === "oc-skill") {
    const skill = extractString(input, "skill", "name");
    return skill ? `skill: ${skill}` : "invoke skill";
  }

  // MCP tools (e.g. mcp__almirant__list_work_items)
  if (name.startsWith("mcp__") || name.startsWith("mcp_")) {
    const parts = name.split(/_{2,}/);
    const server = parts[1] ?? "";
    const tool = parts.slice(2).join("/");
    return tool ? `mcp ${server}/${tool}` : `mcp ${server}`;
  }

  // Fallback
  return toolName.length > 60 ? `${toolName.slice(0, 57)}...` : toolName;
};

// ---------------------------------------------------------------------------
// Embed renderer
// ---------------------------------------------------------------------------

export const renderDashboardEmbed = (state: DashboardState): DiscordMessagePayload => {
  const elapsed = formatDurationMs(Date.now() - state.startedAt);
  const color = statusColor(state.status);

  const lines: string[] = [];

  // Current action
  if (state.currentAction) {
    lines.push(`**Current:** ${state.currentAction.summary}`);
    lines.push("");
  }

  // Recent actions
  if (state.recentActions.length > 0) {
    lines.push("**Recent activity**");
    for (const action of state.recentActions) {
      const icon = action.status === "error" ? "\u274c" : "\u2022";
      lines.push(`${icon} ${action.summary}`);
    }
  }

  const description =
    lines.length > 0
      ? lines.join("\n")
      : "Waiting for agent activity...";

  const tokenStr =
    state.tokens.in > 0 || state.tokens.out > 0
      ? `${formatTokenCount(state.tokens.in)} in / ${formatTokenCount(state.tokens.out)} out`
      : "n/a";

  const embed: DiscordEmbed = {
    title: clamp(state.title, DISCORD_LIMITS.embedTitle),
    description: clamp(description, DISCORD_LIMITS.embedDescription),
    color,
    fields: [
      { name: "Status", value: statusLabel(state.status), inline: true },
      { name: "Duration", value: elapsed, inline: true },
      { name: "Model", value: clamp(state.model, DISCORD_LIMITS.embedFieldValue), inline: true },
      { name: "Tokens", value: tokenStr, inline: true },
    ],
    footer: state.description
      ? { text: clamp(state.description, 200) }
      : undefined,
    timestamp: new Date().toISOString(),
  };

  return {
    embeds: [embed],
    allowed_mentions: { parse: [] },
  };
};
