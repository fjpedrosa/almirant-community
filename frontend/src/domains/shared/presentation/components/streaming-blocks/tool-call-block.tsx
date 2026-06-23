import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ToolIcon,
  humanizeToolName,
  humanizeInputPreview,
  getToolNameColor,
  parseMcpToolName,
  getToolServerColor,
} from "./tool-icon";
import { McpIcon } from "@/components/icons/mcp-icon";

const humanizeGroupCount = (toolName: string, n: number): string => {
  if (toolName === "Read") return `${n} file${n > 1 ? "s" : ""} read`;
  if (toolName === "Glob") return `${n} file search${n > 1 ? "es" : ""}`;
  if (toolName === "Grep") return `${n} content search${n > 1 ? "es" : ""}`;
  if (toolName === "Write") return `${n} file${n > 1 ? "s" : ""} written`;
  if (toolName === "Edit") return `${n} edit${n > 1 ? "s" : ""}`;
  if (toolName === "Git") return `${n} git action${n > 1 ? "s" : ""}`;
  if (toolName === "GitHub") return `${n} GitHub action${n > 1 ? "s" : ""}`;
  const lower = toolName.toLowerCase();
  if (lower.includes("create_task") || lower.includes("create task")) return `${n} task${n > 1 ? "s" : ""} created`;
  if (lower.includes("create_feature") || lower.includes("create feature")) return `${n} feature${n > 1 ? "s" : ""}`;
  if (lower.includes("create_epic") || lower.includes("create epic")) return `${n} epic${n > 1 ? "s" : ""}`;
  return `${n} call${n > 1 ? "s" : ""}`;
};

interface ToolCallBlockProps {
  toolName: string;
  toolCallId: string;
  status: "pending" | "success" | "error";
  inputPreview?: string;
  filePath?: string;
  lineRange?: string;
  command?: string;
  description?: string;
  isLast?: boolean;
  /** When set, this block represents N merged consecutive calls of the same tool. */
  groupCount?: number;
  /** When true, show tree prefix (|-) for nested display under subagents. */
  nested?: boolean;
}

const StatusIcon: React.FC<{ status: ToolCallBlockProps["status"] }> = ({
  status,
}) => {
  switch (status) {
    case "pending":
      return null;
    case "success":
      return <Check className="size-3.5 text-green-500" />;
    case "error":
      return <X className="size-3.5 text-red-500" />;
  }
};

/** Hidden tools: spawn commands (Agent/Task — shown as SubagentBlock), Bash (noise),
 *  ToolSearch (internal schema discovery), plan mode transitions, internal task queries. */
const HIDDEN_TOOLS = new Set([
  "Agent", "Task", "Bash", "ToolSearch",
  "EnterPlanMode", "ExitPlanMode",
  "TaskGet", "TaskList", "TaskStop", "TaskOutput",
]);

export const ToolCallBlock: React.FC<ToolCallBlockProps> = ({
  toolName,
  toolCallId,
  status,
  inputPreview,
  filePath,
  command,
  description,
  isLast,
  groupCount,
  nested,
}) => {
  if (HIDDEN_TOOLS.has(toolName)) return null;

  let detail =
    filePath ??
    command ??
    description ??
    humanizeInputPreview(toolName, inputPreview);
  // Clean /workspace/repo/ prefix for readability
  if (detail) detail = detail.replace(/\/workspace\/repo\//g, "");
  const isPending = status === "pending";

  // MCP tool rendering: [McpIcon] ServerName  action  [detail] [status] [group]
  const mcpParts = parseMcpToolName(toolName);
  if (mcpParts) {
    const serverColor = getToolServerColor(mcpParts.serverRaw);
    const mcpGroupLabel = groupCount && groupCount > 1
      ? `+${groupCount - 1} more`
      : null;

    return (
      <div
        className={cn(
          "flex items-center gap-2 py-0.5 px-1 text-[0.9375rem] text-muted-foreground font-mono",
          isPending && "animate-pulse motion-reduce:animate-none",
        )}
      >
        {nested && (
          <span className="text-muted-foreground/30 select-none">
            {isLast ? "\u2514\u2500" : "\u251C\u2500"}
          </span>
        )}
        <McpIcon className={cn("size-4 flex-shrink-0", serverColor)} />
        <span className={cn("font-semibold font-sans whitespace-nowrap", serverColor)}>
          {mcpParts.serverLabel}
        </span>
        <span className="text-foreground/50 text-sm font-sans whitespace-nowrap">
          {mcpParts.actionLabel}
        </span>
        <StatusIcon status={status} />
        {mcpGroupLabel && (
          <span className="text-foreground/70 text-sm font-sans whitespace-nowrap">
            {mcpGroupLabel}
          </span>
        )}
        {detail && (
          <span className="truncate text-foreground/70 text-sm font-sans">
            {detail}
          </span>
        )}
      </div>
    );
  }

  // Built-in tool rendering
  const displayName = humanizeToolName(toolName);
  const nameColor = getToolNameColor(toolName);

  // Group label: "10 tasks created", "63 files read", etc.
  const groupLabel = groupCount && groupCount > 1
    ? ` ${humanizeGroupCount(toolName, groupCount)}`
    : null;

  return (
    <div
      className={cn(
        "flex items-center gap-2 py-0.5 px-1 text-[0.9375rem] text-muted-foreground font-mono",
        isPending && "animate-pulse motion-reduce:animate-none",
      )}
    >
      {nested && (
        <span className="text-muted-foreground/30 select-none">
          {isLast ? "\u2514\u2500" : "\u251C\u2500"}
        </span>
      )}
      <ToolIcon
        toolName={toolName}
        className={cn("size-4 flex-shrink-0", nameColor)}
      />
      <span
        className={cn(
          "font-semibold font-sans whitespace-nowrap",
          nameColor,
        )}
      >
        {displayName}
      </span>
      {groupLabel && (
        <span className="text-foreground/70 text-sm font-sans whitespace-nowrap">
          {groupLabel}
        </span>
      )}
      {detail && (
        <span className="truncate text-foreground/70 text-sm font-sans">
          {detail}
        </span>
      )}
      <StatusIcon status={status} />
    </div>
  );
};
