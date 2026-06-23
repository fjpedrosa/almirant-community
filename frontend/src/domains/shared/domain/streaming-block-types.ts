// Streaming block types for AI planning chat
// These types define the discriminated union for various block types rendered during streaming.

/**
 * Discriminated union representing different block types in a streaming chat.
 * Used by the planning session hook and various presentation components.
 */
export type StreamingBlock =
  | { type: "thinking"; content: string }
  | { type: "text"; content: string }
  /** Lifecycle info messages (skill loading, warnings). Not duplicated in messages. */
  | { type: "info"; content: string }
  | { type: "tool_call"; toolName: string; toolCallId: string; status: "pending" | "success" | "error"; inputPreview?: string; filePath?: string; lineRange?: string; command?: string; description?: string }
  | { type: "file_read"; filePath: string; lineRange?: string }
  | { type: "file_change"; filePath: string; operation: "write" | "edit" }
  | { type: "bash"; toolCallId?: string; command: string; description?: string; output?: string }
  | { type: "subagent"; subagentId: string; description: string; isBackground: boolean; status: "running" | "done"; subagentType?: string }
  | { type: "summary"; text: string; section: "Summary" | "Resumen" }
  | { type: "session-reconnect"; timestamp: string };

/**
 * Represents a group of streaming blocks with the same tool name.
 * Used by ActivityBurstBlock to display collapsed tool usage.
 */
export interface ActivityBurstGroup {
  toolName: string;
  count: number;
  blocks: StreamingBlock[];
}

/**
 * Discriminated union for grouped streaming blocks.
 * The groupStreamingBlocks() function transforms a flat array of StreamingBlock
 * into this grouped representation for optimized rendering.
 */
export type GroupedBlock =
  | { kind: "block"; block: StreamingBlock; index: number }
  | { kind: "subagent-group"; subagents: Array<{
      subagentId: string;
      description: string;
      isBackground: boolean;
      status: "running" | "done";
      subagentType?: string;
      nestedToolCalls: Array<{
        toolName: string;
        toolCallId: string;
        status: "pending" | "success" | "error";
        description?: string;
        filePath?: string;
        command?: string;
        inputPreview?: string;
      }>;
    }>; startIndex: number }
  | { kind: "tool-group"; toolName: string; count: number; lastBlock: StreamingBlock & { type: "tool_call" }; startIndex: number }
  | { kind: "activity-burst"; groups: ActivityBurstGroup[]; startIndex: number };
