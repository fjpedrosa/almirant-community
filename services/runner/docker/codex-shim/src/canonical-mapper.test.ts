import { describe, expect, it, beforeEach } from "bun:test";
import {
  mapCodexToCanonical,
  type CodexCanonicalMappingContext,
} from "./canonical-mapper.js";

const SESSION_ID = "test-session-001";

const makeContext = (): CodexCanonicalMappingContext => ({
  messageSnapshots: new Map(),
  emittedToolCallIds: new Set(),
});

describe("mapCodexToCanonical", () => {
  let ctx: CodexCanonicalMappingContext;

  beforeEach(() => {
    ctx = makeContext();
  });

  // ---- agent_message updated ----

  describe("agent_message updated", () => {
    it("emits agent.text delta for growing text", () => {
      const event1 = {
        type: "item.updated",
        item: { id: "msg-1", type: "agent_message", text: "Hello" },
      };
      const result1 = mapCodexToCanonical(SESSION_ID, event1, ctx);
      expect(result1.events).toEqual([{ kind: "agent.text", content: "Hello" }]);

      const event2 = {
        type: "item.updated",
        item: { id: "msg-1", type: "agent_message", text: "Hello world" },
      };
      const result2 = mapCodexToCanonical(SESSION_ID, event2, ctx);
      expect(result2.events).toEqual([{ kind: "agent.text", content: " world" }]);
    });

    it("emits agent.text.complete when text does not extend previous snapshot", () => {
      // Set initial snapshot
      ctx.messageSnapshots.set("msg-1", "Hello");
      const event = {
        type: "item.updated",
        item: { id: "msg-1", type: "agent_message", text: "Goodbye" },
      };
      const result = mapCodexToCanonical(SESSION_ID, event, ctx);
      expect(result.events).toEqual([
        { kind: "agent.text.complete", fullText: "Goodbye" },
      ]);
    });

    it("emits no events when text is unchanged (dedup)", () => {
      ctx.messageSnapshots.set("msg-1", "Same text");
      const event = {
        type: "item.updated",
        item: { id: "msg-1", type: "agent_message", text: "Same text" },
      };
      const result = mapCodexToCanonical(SESSION_ID, event, ctx);
      expect(result.events).toEqual([]);
    });

    it("emits no events when item has no text", () => {
      const event = {
        type: "item.updated",
        item: { id: "msg-1", type: "agent_message", text: "" },
      };
      const result = mapCodexToCanonical(SESSION_ID, event, ctx);
      expect(result.events).toEqual([]);
    });
  });

  // ---- agent_message completed ----

  describe("agent_message completed", () => {
    it("emits agent.text.complete with full text", () => {
      const event = {
        type: "item.completed",
        item: { id: "msg-1", type: "agent_message", text: "Final answer" },
      };
      const result = mapCodexToCanonical(SESSION_ID, event, ctx);
      expect(result.events).toEqual([
        { kind: "agent.text.complete", fullText: "Final answer" },
      ]);
    });

    it("updates the snapshot on completion", () => {
      const event = {
        type: "item.completed",
        item: { id: "msg-2", type: "agent_message", text: "Done" },
      };
      mapCodexToCanonical(SESSION_ID, event, ctx);
      expect(ctx.messageSnapshots.get("msg-2")).toBe("Done");
    });
  });

  // ---- reasoning updated ----

  describe("reasoning updated", () => {
    it("emits agent.thinking delta for growing text", () => {
      const event1 = {
        type: "item.updated",
        item: { id: "reason-1", type: "reasoning", text: "Let me" },
      };
      const result1 = mapCodexToCanonical(SESSION_ID, event1, ctx);
      expect(result1.events).toEqual([
        { kind: "agent.thinking", content: "Let me" },
      ]);

      const event2 = {
        type: "item.updated",
        item: { id: "reason-1", type: "reasoning", text: "Let me think" },
      };
      const result2 = mapCodexToCanonical(SESSION_ID, event2, ctx);
      expect(result2.events).toEqual([
        { kind: "agent.thinking", content: " think" },
      ]);
    });

    it("emits full thinking content on non-incremental change", () => {
      ctx.messageSnapshots.set("reason-1", "First thought");
      const event = {
        type: "item.updated",
        item: { id: "reason-1", type: "reasoning", text: "New thought" },
      };
      const result = mapCodexToCanonical(SESSION_ID, event, ctx);
      expect(result.events).toEqual([
        { kind: "agent.thinking", content: "New thought" },
      ]);
    });
  });

  // ---- command_execution updated ----

  describe("command_execution updated", () => {
    it("emits bash start plus agent.text delta for growing command text", () => {
      const event1 = {
        type: "item.updated",
        item: { id: "cmd-1", type: "command_execution", text: "$ ls" },
      };
      const result1 = mapCodexToCanonical(SESSION_ID, event1, ctx);
      expect(result1.events).toEqual([
        {
          kind: "agent.tool_call.start",
          toolName: "Bash",
          toolCallId: "cmd-1",
          inputPreview: "ls",
        },
        {
          kind: "agent.bash.execute",
          toolCallId: "cmd-1",
          command: "ls",
        },
        {
          kind: "agent.text",
          content: "$ ls",
          metadata: {
            source: "command_execution",
            toolCallId: "cmd-1",
          },
        },
      ]);

      const event2 = {
        type: "item.updated",
        item: { id: "cmd-1", type: "command_execution", text: "$ ls\nfile.txt" },
      };
      const result2 = mapCodexToCanonical(SESSION_ID, event2, ctx);
      expect(result2.events).toEqual([
        {
          kind: "agent.bash.output",
          toolCallId: "cmd-1",
          output: "file.txt",
        },
        {
          kind: "agent.text",
          content: "\nfile.txt",
          metadata: {
            source: "command_execution",
            toolCallId: "cmd-1",
          },
        },
      ]);
    });

    it("emits agent.text.complete on non-incremental change", () => {
      ctx.messageSnapshots.set("cmd-1", "$ ls");
      ctx.emittedToolCallIds.add("cmd-1");
      const event = {
        type: "item.updated",
        item: { id: "cmd-1", type: "command_execution", text: "$ cat foo.txt" },
      };
      const result = mapCodexToCanonical(SESSION_ID, event, ctx);
      expect(result.events).toEqual([
        {
          kind: "agent.text.complete",
          fullText: "$ cat foo.txt",
          metadata: {
            source: "command_execution",
            toolCallId: "cmd-1",
          },
        },
      ]);
    });
  });

  // ---- command_execution completed ----

  describe("command_execution completed", () => {
    it("emits the missing bash start and result from completed text-only events", () => {
      const event = {
        type: "item.completed",
        item: { id: "cmd-2", type: "command_execution", text: "$ echo done\ndone" },
      };
      const result = mapCodexToCanonical(SESSION_ID, event, ctx);
      expect(result.events).toEqual([
        {
          kind: "agent.tool_call.start",
          toolName: "Bash",
          toolCallId: "cmd-2",
          inputPreview: "echo done",
        },
        {
          kind: "agent.bash.execute",
          toolCallId: "cmd-2",
          command: "echo done",
        },
        {
          kind: "agent.bash.output",
          toolCallId: "cmd-2",
          output: "done",
        },
        {
          kind: "agent.text.complete",
          fullText: "$ echo done\ndone",
          metadata: {
            source: "command_execution",
            toolCallId: "cmd-2",
          },
        },
        {
          kind: "agent.tool_call.result",
          toolCallId: "cmd-2",
          toolName: "Bash",
          success: true,
          outputPreview: "$ echo done\ndone",
        },
      ]);
    });
  });

  describe("mcp_tool_call", () => {
    it("builds a structured MCP tool name from official Codex SDK fields", () => {
      const event = {
        type: "item.updated",
        item: {
          id: "mcp-1",
          type: "mcp_tool_call",
          server: "almirant",
          tool: "claim_next_bug_feedback",
          arguments: { claimer: "scheduled" },
          status: "in_progress",
        },
      };

      const result = mapCodexToCanonical(SESSION_ID, event, ctx);

      expect(result.events).toEqual([
        {
          kind: "agent.tool_call.start",
          toolName: "mcp__almirant__claim_next_bug_feedback",
          toolCallId: "mcp-1",
          inputPreview: "{\"claimer\":\"scheduled\"}",
        },
      ]);
    });

    it("extracts MCP result previews from structured Codex SDK payloads", () => {
      const event = {
        type: "item.completed",
        item: {
          id: "mcp-2",
          type: "mcp_tool_call",
          server: "almirant",
          tool: "list_new_bug_feedback",
          arguments: { limit: 1 },
          status: "completed",
          result: {
            content: [
              { type: "text", text: "1 bug found" },
            ],
            structured_content: { count: 1 },
          },
        },
      };

      const result = mapCodexToCanonical(SESSION_ID, event, ctx);

      expect(result.events).toEqual([
        {
          kind: "agent.tool_call.start",
          toolName: "mcp__almirant__list_new_bug_feedback",
          toolCallId: "mcp-2",
          inputPreview: "{\"limit\":1}",
        },
        {
          kind: "agent.tool_call.result",
          toolCallId: "mcp-2",
          toolName: "mcp__almirant__list_new_bug_feedback",
          success: true,
          outputPreview: "1 bug found",
        },
      ]);
    });
  });

  describe("web_search", () => {
    it("emits canonical tool_call events instead of transcript text", () => {
      const event = {
        type: "item.completed",
        item: {
          id: "web-1",
          type: "web_search",
          query: "latest bun test docs",
        },
      };

      const result = mapCodexToCanonical(SESSION_ID, event, ctx);

      expect(result.events).toEqual([
        {
          kind: "agent.tool_call.start",
          toolName: "WebSearch",
          toolCallId: "web-1",
          inputPreview: "latest bun test docs",
        },
        {
          kind: "agent.tool_call.result",
          toolCallId: "web-1",
          toolName: "WebSearch",
          success: true,
          outputPreview: "latest bun test docs",
        },
      ]);
    });
  });

  describe("file_change completed", () => {
    it("recovers Codex SDK change arrays and emits the specialized file event", () => {
      const event = {
        type: "item.completed",
        item: {
          id: "fc-1",
          type: "file_change",
          changes: [
            {
              path: "frontend/src/domains/sessions/application/hooks/use-session-detail.ts",
              kind: "update",
            },
          ],
          status: "completed",
        },
      };
      const result = mapCodexToCanonical(SESSION_ID, event, ctx);
      expect(result.events).toEqual([
        {
          kind: "agent.tool_call.start",
          toolName: "FileChange",
          toolCallId: "fc-1",
          inputPreview:
            "update: frontend/src/domains/sessions/application/hooks/use-session-detail.ts",
        },
        {
          kind: "agent.file.edit",
          toolCallId: "fc-1",
          filePath:
            "frontend/src/domains/sessions/application/hooks/use-session-detail.ts",
        },
        {
          kind: "agent.tool_call.result",
          toolCallId: "fc-1",
          toolName: "FileChange",
          success: true,
          outputPreview:
            "File update: frontend/src/domains/sessions/application/hooks/use-session-detail.ts",
        },
      ]);
    });
  });

  // ---- turn.completed ----

  describe("turn.completed", () => {
    it("emits session.idle and marks terminal", () => {
      const event = { type: "turn.completed" };
      const result = mapCodexToCanonical(SESSION_ID, event, ctx);
      expect(result.events).toEqual([
        {
          kind: "session.idle",
          hasBackgroundAgents: false,
          isPlanningJob: false,
        },
      ]);
      expect(result.terminal).toBe(true);
    });

    it("handles 'completed' alias", () => {
      const event = { type: "completed" };
      const result = mapCodexToCanonical(SESSION_ID, event, ctx);
      expect(result.events).toHaveLength(1);
      expect(result.events[0]).toHaveProperty("kind", "session.idle");
      expect(result.terminal).toBe(true);
    });
  });

  // ---- turn.failed ----

  describe("turn.failed", () => {
    it("emits session.error + session.idle and marks terminal", () => {
      const event = { type: "turn.failed", message: "Out of tokens" };
      const result = mapCodexToCanonical(SESSION_ID, event, ctx);
      expect(result.events).toHaveLength(2);
      expect(result.events[0]).toEqual({
        kind: "session.error",
        message: "Out of tokens",
        recoverable: false,
      });
      expect(result.events[1]).toEqual({
        kind: "session.idle",
        hasBackgroundAgents: false,
        isPlanningJob: false,
      });
      expect(result.terminal).toBe(true);
    });

    it("handles 'error' type alias", () => {
      const event = { type: "error", error: { message: "API limit reached" } };
      const result = mapCodexToCanonical(SESSION_ID, event, ctx);
      expect(result.events).toHaveLength(2);
      expect(result.events[0]).toEqual({
        kind: "session.error",
        message: "API limit reached",
        recoverable: false,
      });
      expect(result.terminal).toBe(true);
    });

    it("uses default error message when none provided", () => {
      const event = { type: "turn.failed" };
      const result = mapCodexToCanonical(SESSION_ID, event, ctx);
      expect(result.events[0]).toEqual({
        kind: "session.error",
        message: "Codex runtime error",
        recoverable: false,
      });
    });
  });

  // ---- approval ----

  describe("approval events", () => {
    it("emits agent.question", () => {
      const event = {
        type: "approval.requested",
        reason: "Run shell command?",
        options: ["yes", "no"],
      };
      const result = mapCodexToCanonical(SESSION_ID, event, ctx);
      expect(result.events).toEqual([
        {
          kind: "agent.question",
          questionText: "Run shell command?",
          options: ["yes", "no"],
        },
      ]);
      expect(result.requiresInput).toBe(true);
    });

    it("uses default question text and options when not provided", () => {
      const event = { type: "approval.needed" };
      const result = mapCodexToCanonical(SESSION_ID, event, ctx);
      expect(result.events).toEqual([
        {
          kind: "agent.question",
          questionText: "Approval requested by Codex",
          options: ["allow", "deny"],
        },
      ]);
    });
  });

  // ---- generic error ----

  describe("generic error events", () => {
    it("emits session.error for events with 'error' in type", () => {
      const event = { type: "runtime.error", message: "Something broke" };
      const result = mapCodexToCanonical(SESSION_ID, event, ctx);
      expect(result.events).toEqual([
        {
          kind: "session.error",
          message: "Something broke",
          recoverable: true,
        },
      ]);
      expect(result.terminal).toBeUndefined();
    });
  });

  // ---- Snapshot deduplication ----

  describe("snapshot dedup", () => {
    it("emits nothing when the same text is received twice", () => {
      const event = {
        type: "item.updated",
        item: { id: "msg-1", type: "agent_message", text: "Repeated" },
      };
      mapCodexToCanonical(SESSION_ID, event, ctx);

      const result = mapCodexToCanonical(SESSION_ID, event, ctx);
      expect(result.events).toEqual([]);
    });
  });

  // ---- Independent snapshot tracking per itemId ----

  describe("per-itemId snapshot tracking", () => {
    it("tracks snapshots independently for different itemIds", () => {
      const event1 = {
        type: "item.updated",
        item: { id: "msg-A", type: "agent_message", text: "Alpha" },
      };
      const event2 = {
        type: "item.updated",
        item: { id: "msg-B", type: "agent_message", text: "Beta" },
      };

      const result1 = mapCodexToCanonical(SESSION_ID, event1, ctx);
      expect(result1.events).toEqual([{ kind: "agent.text", content: "Alpha" }]);

      const result2 = mapCodexToCanonical(SESSION_ID, event2, ctx);
      expect(result2.events).toEqual([{ kind: "agent.text", content: "Beta" }]);

      // Extend msg-A independently
      const event1b = {
        type: "item.updated",
        item: { id: "msg-A", type: "agent_message", text: "Alpha extended" },
      };
      const result1b = mapCodexToCanonical(SESSION_ID, event1b, ctx);
      expect(result1b.events).toEqual([
        { kind: "agent.text", content: " extended" },
      ]);

      // msg-B snapshot should be unaffected
      expect(ctx.messageSnapshots.get("msg-B")).toBe("Beta");
    });
  });

  // ---- Unknown events ----

  describe("unknown events", () => {
    it("returns empty events for unrecognized event types", () => {
      const event = { type: "some.unknown.event", data: {} };
      const result = mapCodexToCanonical(SESSION_ID, event, ctx);
      expect(result.events).toEqual([]);
    });
  });
});
