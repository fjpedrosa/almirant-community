"use client";

import { useState } from "react";
import { ChevronRight, ChevronDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { ToolIcon, humanizeToolName, humanizeInputPreview, getToolNameColor, parseMcpToolName, getToolServerColor } from "./tool-icon";
import { McpIcon } from "@/components/icons/mcp-icon";
import type { StreamingBlock } from "@/domains/shared/domain/streaming-block-types";

/** Tools hidden from burst summary display. */
const HIDDEN_TOOLS = new Set([
  "Bash", "ToolSearch",
  "EnterPlanMode", "ExitPlanMode",
  "TaskGet", "TaskList", "TaskStop", "TaskOutput",
]);

/** Map tool names to appropriate count labels. */
const getCountLabel = (toolName: string): string => {
  const labels: Record<string, string> = {
    Read: "files read",
    Grep: "content searches",
    Glob: "file searches",
    Edit: "edits",
    Write: "files written",
    Git: "git actions",
    GitHub: "GitHub actions",
    Install: "dependency installs",
    Test: "test runs",
    Lint: "lint runs",
    TypeCheck: "type checks",
    Env: "environment checks",
    ToolSearch: "searches",
  };
  if (labels[toolName]) return labels[toolName];
  const lower = toolName.toLowerCase();
  if (lower.includes("create_task") || lower.includes("create task")) return "tasks created";
  if (lower.includes("create_feature") || lower.includes("create feature")) return "features";
  if (lower.includes("create_epic") || lower.includes("create epic")) return "epics";
  return "calls";
};

interface ActivityBurstGroup {
  toolName: string;
  count: number;
  blocks: StreamingBlock[];
}

interface ActivityBurstBlockProps {
  groups: ActivityBurstGroup[];
  parentSubagent?: { description: string; subagentType?: string };
}

/** Single tool call line with tree branch. */
const ToolLine: React.FC<{
  block: StreamingBlock;
  isLast: boolean;
}> = ({ block, isLast }) => {
  if (block.type !== "tool_call") return null;
  const mcpParts = parseMcpToolName(block.toolName);
  const nameColor = mcpParts ? getToolServerColor(mcpParts.serverRaw) : getToolNameColor(block.toolName);
  const displayName = humanizeToolName(block.toolName);
  let detail = block.filePath ?? block.command ?? block.description ?? humanizeInputPreview(block.toolName, block.inputPreview) ?? undefined;
  if (detail) detail = detail.replace(/\/workspace\/repo\//g, "");

  return (
    <div className="relative ml-6">
      <div className={cn("absolute left-0 top-0 w-px bg-muted-foreground/60", isLast ? "h-3" : "bottom-0")} />
      <div className="absolute left-0 top-3 w-4 h-px bg-muted-foreground/60" />
      <div className="flex items-center gap-1.5 py-0.5 pl-5">
        {mcpParts ? (
          <McpIcon className={cn("size-4 flex-shrink-0", nameColor)} />
        ) : (
          <ToolIcon toolName={block.toolName} className={cn("size-4 flex-shrink-0", nameColor)} />
        )}
        {mcpParts ? (
          <>
            <span className={cn("font-sans text-sm font-semibold whitespace-nowrap", nameColor)}>
              {mcpParts.serverLabel}
            </span>
            <span className="text-foreground/50 text-sm font-sans whitespace-nowrap">
              {mcpParts.actionLabel}
            </span>
          </>
        ) : (
          <span className={cn("font-sans text-sm font-medium whitespace-nowrap", nameColor)}>
            {displayName}
          </span>
        )}
        {detail && (
          <span className="truncate text-sm font-sans text-foreground/70">{detail}</span>
        )}
        <Check className="size-3 text-green-500/60 flex-shrink-0" />
      </div>
    </div>
  );
};

/** A tool type group — e.g. "Read 63 files read" — click to expand. */
const ToolGroupRow: React.FC<{
  group: ActivityBurstGroup;
  isLast: boolean;
  flat?: boolean;
}> = ({ group, isLast, flat }) => {
  const [expanded, setExpanded] = useState(false);
  const mcpParts = parseMcpToolName(group.toolName);
  const nameColor = mcpParts ? getToolServerColor(mcpParts.serverRaw) : getToolNameColor(group.toolName);
  const displayName = humanizeToolName(group.toolName);
  const countLabel = getCountLabel(group.toolName);

  const renderIcon = () =>
    mcpParts ? (
      <McpIcon className={cn("size-4 flex-shrink-0", nameColor)} />
    ) : (
      <ToolIcon toolName={group.toolName} className={cn("size-4 flex-shrink-0", nameColor)} />
    );

  const renderLabel = () =>
    mcpParts ? (
      <>
        <span className={cn("font-semibold font-sans whitespace-nowrap", nameColor)}>
          {mcpParts.serverLabel}
        </span>
        <span className="text-foreground/50 text-sm font-sans whitespace-nowrap">
          {mcpParts.actionLabel}
        </span>
      </>
    ) : (
      <span className={cn("font-semibold font-sans whitespace-nowrap", nameColor)}>
        {displayName}
      </span>
    );

  // Single call — flat line
  if (group.count === 1) {
    const block = group.blocks[0];
    if (!block || block.type !== "tool_call") return null;
    const detail = block.filePath ?? block.command ?? block.description ?? humanizeInputPreview(block.toolName, block.inputPreview) ?? undefined;
    const cleanDetail = detail?.replace(/\/workspace\/repo\//g, "");

    return (
      <div className={cn("relative", !flat && "ml-6")}>
        {!flat && <div className={cn("absolute left-0 top-0 w-px bg-muted-foreground/60", isLast ? "h-3.5" : "bottom-0")} />}
        {!flat && <div className="absolute left-0 top-3.5 w-4 h-px bg-muted-foreground/60" />}
        <div className={cn("flex items-center gap-2 py-0.5", !flat && "pl-5")}>
          {renderIcon()}
          {renderLabel()}
          {cleanDetail && (
            <span className="truncate text-sm font-sans text-foreground/70">{cleanDetail}</span>
          )}
          <Check className="size-3.5 text-green-500/60 flex-shrink-0" />
        </div>
      </div>
    );
  }

  // Multiple calls — collapsible
  return (
    <div className={cn("relative", !flat && "ml-6")}>
      {!flat && <div className={cn("absolute left-0 top-0 w-px bg-muted-foreground/60", isLast && !expanded ? "h-3.5" : "bottom-0")} />}
      {!flat && <div className="absolute left-0 top-3.5 w-4 h-px bg-muted-foreground/60" />}
      <div
        className={cn("flex items-center gap-2 py-1.5 cursor-pointer hover:bg-muted/30 rounded min-h-[32px]", !flat && "pl-5")}
        onClick={() => setExpanded(!expanded)}
      >
        {expanded
          ? <ChevronDown className="size-3.5 text-foreground/60 flex-shrink-0" />
          : <ChevronRight className="size-3.5 text-foreground/60 flex-shrink-0" />
        }
        {renderIcon()}
        {renderLabel()}
        <span className="text-sm text-foreground/70">
          {group.count} {countLabel}
        </span>
      </div>
      {expanded && group.blocks.map((block, idx) => (
        <ToolLine
          key={block.type === "tool_call" ? block.toolCallId : `block-${idx}`}
          block={block}
          isLast={idx === group.blocks.length - 1}
        />
      ))}
    </div>
  );
};

export const ActivityBurstBlock: React.FC<ActivityBurstBlockProps> = ({
  groups,
}) => {
  const visibleGroups = groups.filter((g) => !HIDDEN_TOOLS.has(g.toolName));
  if (visibleGroups.length === 0) return null;

  // Single group — render flat without tree branch
  if (visibleGroups.length === 1) {
    return (
      <div className="py-0.5">
        <ToolGroupRow group={visibleGroups[0]} isLast flat />
      </div>
    );
  }

  // Multiple independent tool groups — render flat (no tree branches)
  // Tree branches are only appropriate inside subagent nested views.
  return (
    <div className="py-0.5">
      {visibleGroups.map((group) => (
        <ToolGroupRow
          key={group.toolName}
          group={group}
          isLast
          flat
        />
      ))}
    </div>
  );
};
