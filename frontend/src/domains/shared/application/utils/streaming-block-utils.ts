import type { StreamingBlock, GroupedBlock } from "../../domain/streaming-block-types";

/** Tool names that represent agent/subagent invocations (skipped when nesting under subagents). */
const AGENT_TOOL_NAMES = new Set(["Agent", "Task"]);

/**
 * Groups streaming blocks for optimized rendering.
 *
 * First pass: Groups consecutive subagent blocks with their nested tool calls.
 * Second pass: Detects activity bursts (consecutive tool blocks grouped by type).
 *
 * @param blocks - Flat array of streaming blocks
 * @returns Grouped blocks for rendering
 */
export const groupStreamingBlocks = (blocks: StreamingBlock[]): GroupedBlock[] => {
  const result: GroupedBlock[] = [];
  let i = 0;

  while (i < blocks.length) {
    const block = blocks[i];

    if (block.type === "subagent") {
      // Start collecting a subagent group
      const group: GroupedBlock & { kind: "subagent-group" } = {
        kind: "subagent-group",
        subagents: [],
        startIndex: i,
      };

      while (i < blocks.length) {
        const current = blocks[i];

        if (current.type === "subagent") {
          group.subagents.push({
            subagentId: current.subagentId,
            description: current.description,
            isBackground: current.isBackground,
            status: current.status,
            subagentType: current.subagentType,
            nestedToolCalls: [],
          });
          i++;
        } else if (
          current.type === "tool_call" &&
          group.subagents.length > 0
        ) {
          const lastAgent = group.subagents[group.subagents.length - 1];

          // Only nest tool calls under a RUNNING subagent.
          // When the last subagent is "done", tool calls belong to the parent
          // agent and should render individually (not hidden inside the group).
          if (lastAgent.status === "done") {
            break;
          }

          // Skip Agent/Task tools — the subagent block already represents them
          if (AGENT_TOOL_NAMES.has(current.toolName)) {
            i++;
            continue;
          }
          lastAgent.nestedToolCalls.push({
            toolName: current.toolName,
            toolCallId: current.toolCallId,
            status: current.status,
            description: current.description,
            filePath: current.filePath,
            command: current.command,
            inputPreview: current.inputPreview,
          });
          i++;
        } else {
          // Non-subagent, non-tool_call block — end the group
          break;
        }
      }

      result.push(group);
    } else {
      result.push({ kind: "block", block, index: i });
      i++;
    }
  }

  // Second pass: detect activity bursts (consecutive tool blocks grouped by type)
  // Bash blocks are excluded entirely from bursts
  const BURST_TOOL_TYPES = new Set(["tool_call", "file_read", "file_change"]);

  const getNormalizedKey = (block: StreamingBlock): string | null => {
    switch (block.type) {
      case "tool_call":
        // Skip Bash tool calls entirely
        if (block.toolName === "Bash") return null;
        return block.toolName;
      case "file_read":
        return "Read";
      case "file_change":
        return block.operation === "write" ? "Write" : "Edit";
      default:
        return null;
    }
  };

  const merged: GroupedBlock[] = [];
  let j = 0;

  while (j < result.length) {
    const item = result[j];

    // Check if this is a tool block that can be part of a burst
    if (item.kind === "block" && BURST_TOOL_TYPES.has(item.block.type)) {
      // Collect consecutive tool blocks (excluding Bash)
      const burstBlocks: Array<{ block: StreamingBlock; index: number }> = [];
      const burstStartIndex = item.index;

      while (j < result.length) {
        const current = result[j];
        if (current.kind === "block" && BURST_TOOL_TYPES.has(current.block.type)) {
          const key = getNormalizedKey(current.block);
          // Skip Bash blocks (key is null), but continue looking for more tool blocks
          if (key !== null) {
            burstBlocks.push({ block: current.block, index: current.index });
          }
          j++;
        } else {
          // Non-tool block encountered, end the burst
          break;
        }
      }

      // If we have 2+ tool blocks, create an activity burst
      if (burstBlocks.length >= 2) {
        // Group by normalized key
        const groupMap = new Map<string, StreamingBlock[]>();
        for (const { block } of burstBlocks) {
          const key = getNormalizedKey(block);
          if (key) {
            if (!groupMap.has(key)) {
              groupMap.set(key, []);
            }
            groupMap.get(key)!.push(block);
          }
        }

        const groups = Array.from(groupMap.entries()).map(([toolName, blocks]) => ({
          toolName,
          count: blocks.length,
          blocks,
        }));

        merged.push({ kind: "activity-burst", groups, startIndex: burstStartIndex });
      } else if (burstBlocks.length === 1) {
        // Single tool block, keep as individual
        merged.push({ kind: "block", block: burstBlocks[0].block, index: burstBlocks[0].index });
      }
      // If burstBlocks.length === 0, all were Bash blocks, skip them
    } else {
      merged.push(item);
      j++;
    }
  }

  return merged;
};
