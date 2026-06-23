import { describe, it, expect, beforeEach } from "bun:test";
import {
  mapOpenCodeToCanonical,
  createCanonicalContext,
  type OpenCodeCanonicalContext,
} from "./canonical-mapper.js";

describe("mapOpenCodeToCanonical", () => {
  let ctx: OpenCodeCanonicalContext;
  const sid = "test-session";

  beforeEach(() => {
    ctx = createCanonicalContext();
  });

  // ---- Text deltas ----

  it("first text delta (no previous) emits agent.text with full content", () => {
    const result = mapOpenCodeToCanonical(sid, "message.part.delta", {
      delta: "Hello",
      partType: "text",
      partId: "p1",
    }, ctx);

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toEqual({ kind: "agent.text", content: "Hello" });
  });

  it("text delta with growing snapshot emits only incremental content", () => {
    // First delta
    mapOpenCodeToCanonical(sid, "message.part.delta", {
      delta: "Hello",
      partType: "text",
      partId: "p1",
    }, ctx);

    // Second delta — snapshot grew
    const result = mapOpenCodeToCanonical(sid, "message.part.delta", {
      delta: "Hello world",
      partType: "text",
      partId: "p1",
    }, ctx);

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toEqual({ kind: "agent.text", content: " world" });
  });

  it("text delta with changed text emits agent.text.complete", () => {
    // First delta
    mapOpenCodeToCanonical(sid, "message.part.delta", {
      delta: "Hello",
      partType: "text",
      partId: "p1",
    }, ctx);

    // Second delta — completely different text (doesn't start with previous)
    const result = mapOpenCodeToCanonical(sid, "message.part.delta", {
      delta: "Goodbye world",
      partType: "text",
      partId: "p1",
    }, ctx);

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toEqual({ kind: "agent.text.complete", fullText: "Goodbye world" });
  });

  it("empty delta emits no events", () => {
    const result = mapOpenCodeToCanonical(sid, "message.part.delta", {
      delta: "",
      partType: "text",
      partId: "p1",
    }, ctx);

    expect(result.events).toHaveLength(0);
  });

  it("repeated identical snapshot emits no events", () => {
    mapOpenCodeToCanonical(sid, "message.part.delta", {
      delta: "Hello",
      partType: "text",
      partId: "p1",
    }, ctx);

    const result = mapOpenCodeToCanonical(sid, "message.part.delta", {
      delta: "Hello",
      partType: "text",
      partId: "p1",
    }, ctx);

    expect(result.events).toHaveLength(0);
  });

  // ---- Thinking / reasoning ----

  it("reasoning partType maps to agent.thinking", () => {
    const result = mapOpenCodeToCanonical(sid, "message.part.delta", {
      delta: "Let me think...",
      partType: "reasoning",
      partId: "p2",
    }, ctx);

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toEqual({ kind: "agent.thinking", content: "Let me think..." });
  });

  it("thinking partType maps to agent.thinking", () => {
    const result = mapOpenCodeToCanonical(sid, "message.part.delta", {
      delta: "Analyzing...",
      partType: "thinking",
      partId: "p3",
    }, ctx);

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toEqual({ kind: "agent.thinking", content: "Analyzing..." });
  });

  it("reasoning delta with changed text emits agent.thinking (not text.complete)", () => {
    mapOpenCodeToCanonical(sid, "message.part.delta", {
      delta: "First thought",
      partType: "reasoning",
      partId: "p2",
    }, ctx);

    const result = mapOpenCodeToCanonical(sid, "message.part.delta", {
      delta: "Different thought",
      partType: "reasoning",
      partId: "p2",
    }, ctx);

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toEqual({ kind: "agent.thinking", content: "Different thought" });
  });

  it("uses OpenCode part.type metadata for later field:text deltas", () => {
    mapOpenCodeToCanonical(sid, "message.part.updated", {
      sessionID: sid,
      partID: "reasoning-real-shape",
      part: {
        id: "reasoning-real-shape",
        sessionID: sid,
        messageID: "msg-1",
        type: "reasoning",
        text: "",
        time: { start: 1 },
      },
      time: 1,
    }, ctx);

    const result = mapOpenCodeToCanonical(sid, "message.part.delta", {
      sessionID: sid,
      messageID: "msg-1",
      partID: "reasoning-real-shape",
      field: "text",
      delta: "I need to inspect the event contract.",
    }, ctx);

    expect(result.events).toEqual([
      {
        kind: "agent.thinking",
        content: "I need to inspect the event contract.",
      },
    ]);
  });

  // ---- Snapshots per partId ----

  it("snapshots are tracked independently per partId", () => {
    // First part
    mapOpenCodeToCanonical(sid, "message.part.delta", {
      delta: "AAA",
      partType: "text",
      partId: "part-a",
    }, ctx);

    // Second part — independent
    mapOpenCodeToCanonical(sid, "message.part.delta", {
      delta: "BBB",
      partType: "text",
      partId: "part-b",
    }, ctx);

    // Extend first part — should only emit incremental from "AAA"
    const resultA = mapOpenCodeToCanonical(sid, "message.part.delta", {
      delta: "AAACCC",
      partType: "text",
      partId: "part-a",
    }, ctx);

    expect(resultA.events).toHaveLength(1);
    expect(resultA.events[0]).toEqual({ kind: "agent.text", content: "CCC" });

    // Extend second part — should only emit incremental from "BBB"
    const resultB = mapOpenCodeToCanonical(sid, "message.part.delta", {
      delta: "BBBDDD",
      partType: "text",
      partId: "part-b",
    }, ctx);

    expect(resultB.events).toHaveLength(1);
    expect(resultB.events[0]).toEqual({ kind: "agent.text", content: "DDD" });
  });

  // ---- session.idle ----

  it("session.idle emits canonical session.idle and clears snapshots", () => {
    // Build up some snapshots
    mapOpenCodeToCanonical(sid, "message.part.delta", {
      delta: "Hello",
      partType: "text",
      partId: "p1",
    }, ctx);
    expect(ctx.partSnapshots.size).toBe(1);

    const result = mapOpenCodeToCanonical(sid, "session.idle", {}, ctx);

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toEqual({
      kind: "session.idle",
      hasBackgroundAgents: false,
      isPlanningJob: false,
    });
    expect(result.terminal).toBe(true);
    expect(ctx.partSnapshots.size).toBe(0);
  });

  it("session.status type:idle behaves same as session.idle", () => {
    mapOpenCodeToCanonical(sid, "message.part.delta", {
      delta: "Some text",
      partType: "text",
      partId: "p1",
    }, ctx);

    const result = mapOpenCodeToCanonical(sid, "session.status", {
      type: "idle",
    }, ctx);

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toEqual({
      kind: "session.idle",
      hasBackgroundAgents: false,
      isPlanningJob: false,
    });
    expect(result.terminal).toBe(true);
    expect(ctx.partSnapshots.size).toBe(0);
  });

  it("session.status with non-idle type emits no events", () => {
    const result = mapOpenCodeToCanonical(sid, "session.status", {
      type: "running",
    }, ctx);

    expect(result.events).toHaveLength(0);
  });

  // ---- Multi-turn: snapshots reset on idle ----

  it("multi-turn: snapshots reset on idle, new turn starts fresh", () => {
    // Turn 1
    mapOpenCodeToCanonical(sid, "message.part.delta", {
      delta: "Turn one text",
      partType: "text",
      partId: "p1",
    }, ctx);

    // Idle resets
    mapOpenCodeToCanonical(sid, "session.idle", {}, ctx);

    // Turn 2 — same partId, should treat as new (no previous snapshot)
    const result = mapOpenCodeToCanonical(sid, "message.part.delta", {
      delta: "Turn two text",
      partType: "text",
      partId: "p1",
    }, ctx);

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toEqual({ kind: "agent.text", content: "Turn two text" });
  });

  // ---- question.asked ----

  it("question.asked emits agent.question with options", () => {
    const result = mapOpenCodeToCanonical(sid, "question.asked", {
      text: "Which file?",
      options: ["file-a.ts", "file-b.ts"],
    }, ctx);

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toEqual({
      kind: "agent.question",
      questionText: "Which file?",
      options: ["file-a.ts", "file-b.ts"],
    });
    expect(result.requiresInput).toBe(true);
  });

  it("question.asked uses question field as fallback for text", () => {
    const result = mapOpenCodeToCanonical(sid, "question.asked", {
      question: "Continue?",
    }, ctx);

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toEqual({
      kind: "agent.question",
      questionText: "Continue?",
      options: undefined,
    });
  });

  it("question.asked with object options extracts labels", () => {
    const result = mapOpenCodeToCanonical(sid, "question.asked", {
      text: "Choose:",
      options: [
        { label: "Yes", value: "y" },
        { label: "No", value: "n", description: "Cancel operation" },
      ],
    }, ctx);

    expect(result.events).toHaveLength(1);
    const event = result.events[0] as { kind: string; options: string[] };
    expect(event.options).toEqual(["Yes", "No::Cancel operation"]);
  });

  // ---- session.error ----

  it("session.error emits canonical session.error", () => {
    const result = mapOpenCodeToCanonical(sid, "session.error", {
      message: "Rate limited",
    }, ctx);

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toEqual({
      kind: "session.error",
      message: "Rate limited",
      recoverable: false,
    });
  });

  it("session.error uses error field as fallback", () => {
    const result = mapOpenCodeToCanonical(sid, "session.error", {
      error: "Connection failed",
    }, ctx);

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toEqual({
      kind: "session.error",
      message: "Connection failed",
      recoverable: false,
    });
  });

  // ---- tool_use delta ----

  it("tool_use delta accumulates buffer (no canonical event until complete)", () => {
    const result1 = mapOpenCodeToCanonical(sid, "message.part.delta", {
      delta: '{"name":"Read"',
      partType: "tool_use",
      partId: "t1",
    }, ctx);

    expect(result1.events).toHaveLength(0);
    expect(ctx.toolUseBuffers.get("t1")).toBe('{"name":"Read"');
  });

  it("tool_use delta emits tool events when JSON is complete", () => {
    // Partial
    mapOpenCodeToCanonical(sid, "message.part.delta", {
      delta: '{"name":"Read"',
      partType: "tool_use",
      partId: "t1",
    }, ctx);

    // Complete
    const result = mapOpenCodeToCanonical(sid, "message.part.delta", {
      delta: '{"name":"Read","id":"tc-1","input":{"file_path":"/foo/bar.ts"}}',
      partType: "tool_use",
      partId: "t1",
    }, ctx);

    expect(result.events.length).toBeGreaterThanOrEqual(1);

    const startEvent = result.events.find((e) => e.kind === "agent.tool_call.start");
    expect(startEvent).toBeDefined();
    expect(startEvent).toMatchObject({
      kind: "agent.tool_call.start",
      toolName: "Read",
      toolCallId: "tc-1",
    });

    const fileReadEvent = result.events.find((e) => e.kind === "agent.file.read");
    expect(fileReadEvent).toBeDefined();
    expect(fileReadEvent).toMatchObject({
      kind: "agent.file.read",
      toolCallId: "tc-1",
      filePath: "/foo/bar.ts",
    });
  });

  it("tool_use buffer is cleared after successful parse", () => {
    mapOpenCodeToCanonical(sid, "message.part.delta", {
      delta: '{"name":"Bash","id":"tc-2","input":{"command":"ls"}}',
      partType: "tool_use",
      partId: "t2",
    }, ctx);

    expect(ctx.toolUseBuffers.has("t2")).toBe(false);
  });

  // ---- message.part.updated ----

  it("message.part.updated for text emits agent.text.complete", () => {
    const result = mapOpenCodeToCanonical(sid, "message.part.updated", {
      partType: "text",
      partId: "p1",
      part: { text: "Full snapshot text" },
    }, ctx);

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toEqual({
      kind: "agent.text.complete",
      fullText: "Full snapshot text",
    });
  });

  it("message.part.updated updates partSnapshots for subsequent deltas", () => {
    mapOpenCodeToCanonical(sid, "message.part.updated", {
      partType: "text",
      partId: "p1",
      part: { text: "Snapshot" },
    }, ctx);

    expect(ctx.partSnapshots.get("p1")).toBe("Snapshot");

    // Next delta extends from snapshot
    const result = mapOpenCodeToCanonical(sid, "message.part.delta", {
      delta: "Snapshot more",
      partType: "text",
      partId: "p1",
    }, ctx);

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toEqual({ kind: "agent.text", content: " more" });
  });

  it("message.part.updated for thinking emits nothing", () => {
    const result = mapOpenCodeToCanonical(sid, "message.part.updated", {
      partType: "reasoning",
      partId: "p2",
      part: { text: "Some thinking" },
    }, ctx);

    expect(result.events).toHaveLength(0);
  });

  // ---- Ignored events ----

  it("server.heartbeat emits no canonical events", () => {
    const result = mapOpenCodeToCanonical(sid, "server.heartbeat", {}, ctx);
    expect(result.events).toHaveLength(0);
  });

  it("unknown event types emit no canonical events", () => {
    const result = mapOpenCodeToCanonical(sid, "some.unknown.event", {}, ctx);
    expect(result.events).toHaveLength(0);
  });

  // ---- PartId resolution ----

  it("falls back to messageID:field when no partId", () => {
    mapOpenCodeToCanonical(sid, "message.part.delta", {
      delta: "First",
      partType: "text",
      messageID: "msg-1",
      field: "content",
    }, ctx);

    expect(ctx.partSnapshots.has("msg-1:content")).toBe(true);

    const result = mapOpenCodeToCanonical(sid, "message.part.delta", {
      delta: "First extended",
      partType: "text",
      messageID: "msg-1",
      field: "content",
    }, ctx);

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toEqual({ kind: "agent.text", content: " extended" });
  });

  // ---- Tool_use buffers cleared on idle ----

  it("session.idle clears tool_use buffers", () => {
    mapOpenCodeToCanonical(sid, "message.part.delta", {
      delta: '{"name":"Read"',
      partType: "tool_use",
      partId: "t1",
    }, ctx);

    expect(ctx.toolUseBuffers.size).toBe(1);

    mapOpenCodeToCanonical(sid, "session.idle", {}, ctx);

    expect(ctx.toolUseBuffers.size).toBe(0);
  });

  // ---- ToolPart via message.part.updated ----

  describe("ToolPart (message.part.updated type:tool)", () => {
    it("pending state emits agent.tool_call.start", () => {
      const result = mapOpenCodeToCanonical(sid, "message.part.updated", {
        partId: "tp-1",
        part: {
          type: "tool",
          tool: "Read",
          callID: "tc-100",
          state: {
            status: "pending",
            input: { file_path: "/foo/bar.ts" },
            raw: '{"file_path":"/foo/bar.ts"}',
          },
        },
      }, ctx);

      const startEvent = result.events.find((e) => e.kind === "agent.tool_call.start");
      expect(startEvent).toBeDefined();
      expect(startEvent).toMatchObject({
        kind: "agent.tool_call.start",
        toolName: "Read",
        toolCallId: "tc-100",
      });
      expect(ctx.activeTools.has("tc-100")).toBe(true);
    });

    it("running state emits tool_call.start + tool-specific events", () => {
      const result = mapOpenCodeToCanonical(sid, "message.part.updated", {
        partId: "tp-2",
        part: {
          type: "tool",
          tool: "Read",
          callID: "tc-101",
          state: {
            status: "running",
            input: { file_path: "/src/index.ts" },
            time: { start: 1000 },
          },
        },
      }, ctx);

      const startEvent = result.events.find((e) => e.kind === "agent.tool_call.start");
      expect(startEvent).toBeDefined();
      expect(startEvent).toMatchObject({ toolName: "Read", toolCallId: "tc-101" });

      const fileRead = result.events.find((e) => e.kind === "agent.file.read");
      expect(fileRead).toBeDefined();
      expect(fileRead).toMatchObject({ filePath: "/src/index.ts" });
    });

    it("running Bash emits agent.bash.execute", () => {
      const result = mapOpenCodeToCanonical(sid, "message.part.updated", {
        partId: "tp-3",
        part: {
          type: "tool",
          tool: "Bash",
          callID: "tc-102",
          state: {
            status: "running",
            input: { command: "ls -la", description: "List files" },
            time: { start: 1000 },
          },
        },
      }, ctx);

      const bash = result.events.find((e) => e.kind === "agent.bash.execute");
      expect(bash).toBeDefined();
      expect(bash).toMatchObject({ command: "ls -la", description: "List files" });
    });

    it("normalizes real OpenCode lowercase bash tools to Claude-like canonical events", () => {
      const result = mapOpenCodeToCanonical(sid, "message.part.updated", {
        sessionID: sid,
        partID: "tp-real-bash",
        part: {
          id: "tp-real-bash",
          sessionID: sid,
          messageID: "msg-1",
          type: "tool",
          tool: "bash",
          callID: "call-bash-real",
          state: {
            status: "running",
            input: {
              command: "bun test services/runner/docker/opencode-shim/src/canonical-mapper.test.ts",
              description: "Run OpenCode mapper tests",
            },
            time: { start: 1 },
          },
        },
      }, ctx);

      expect(result.events).toEqual([
        {
          kind: "agent.tool_call.start",
          toolName: "Bash",
          toolCallId: "call-bash-real",
          inputPreview:
            "command: bun test services/runner/docker/opencode-shim/src/canonical-mapper.test.ts",
        },
        {
          kind: "agent.bash.execute",
          toolCallId: "call-bash-real",
          command: "bun test services/runner/docker/opencode-shim/src/canonical-mapper.test.ts",
          description: "Run OpenCode mapper tests",
        },
      ]);
    });

    it("normalizes real OpenCode camelCase file paths for read/edit tools", () => {
      const read = mapOpenCodeToCanonical(sid, "message.part.updated", {
        sessionID: sid,
        partID: "tp-real-read",
        part: {
          id: "tp-real-read",
          sessionID: sid,
          messageID: "msg-1",
          type: "tool",
          tool: "read",
          callID: "call-read-real",
          state: {
            status: "running",
            input: {
              filePath: "services/runner/docker/opencode-shim/src/canonical-mapper.ts",
              offset: 5,
              limit: 15,
            },
            time: { start: 1 },
          },
        },
      }, ctx);

      const edit = mapOpenCodeToCanonical(sid, "message.part.updated", {
        sessionID: sid,
        partID: "tp-real-edit",
        part: {
          id: "tp-real-edit",
          sessionID: sid,
          messageID: "msg-1",
          type: "tool",
          tool: "edit",
          callID: "call-edit-real",
          state: {
            status: "running",
            input: {
              filePath: "services/runner/docker/opencode-shim/src/canonical-mapper.ts",
            },
            time: { start: 2 },
          },
        },
      }, ctx);

      expect(read.events).toContainEqual({
        kind: "agent.file.read",
        toolCallId: "call-read-real",
        filePath: "services/runner/docker/opencode-shim/src/canonical-mapper.ts",
        lineRange: "5-15",
      });
      expect(edit.events).toContainEqual({
        kind: "agent.file.edit",
        toolCallId: "call-edit-real",
        filePath: "services/runner/docker/opencode-shim/src/canonical-mapper.ts",
      });
    });

    it("completed state emits agent.tool_call.result success", () => {
      // First: pending
      mapOpenCodeToCanonical(sid, "message.part.updated", {
        partId: "tp-4",
        part: {
          type: "tool",
          tool: "Read",
          callID: "tc-103",
          state: { status: "pending", input: { file_path: "/a.ts" }, raw: "" },
        },
      }, ctx);

      // Then: completed
      const result = mapOpenCodeToCanonical(sid, "message.part.updated", {
        partId: "tp-4",
        part: {
          type: "tool",
          tool: "Read",
          callID: "tc-103",
          state: {
            status: "completed",
            input: { file_path: "/a.ts" },
            output: "file contents here",
            title: "Read /a.ts",
            metadata: {},
            time: { start: 1000, end: 1500 },
          },
        },
      }, ctx);

      const resultEvent = result.events.find((e) => e.kind === "agent.tool_call.result");
      expect(resultEvent).toBeDefined();
      expect(resultEvent).toMatchObject({
        toolCallId: "tc-103",
        toolName: "Read",
        success: true,
      });
      expect(ctx.activeTools.has("tc-103")).toBe(false);
    });

    it("error state emits agent.tool_call.result failure", () => {
      const result = mapOpenCodeToCanonical(sid, "message.part.updated", {
        partId: "tp-5",
        part: {
          type: "tool",
          tool: "Bash",
          callID: "tc-104",
          state: {
            status: "error",
            input: { command: "fail" },
            error: "Command not found",
            time: { start: 1000, end: 1100 },
          },
        },
      }, ctx);

      const resultEvent = result.events.find((e) => e.kind === "agent.tool_call.result");
      expect(resultEvent).toBeDefined();
      expect(resultEvent).toMatchObject({
        toolCallId: "tc-104",
        toolName: "Bash",
        success: false,
        outputPreview: "Command not found",
      });
    });

    it("Agent tool emits subagent.spawn on running and subagent.complete on completed", () => {
      // Running
      const r1 = mapOpenCodeToCanonical(sid, "message.part.updated", {
        partId: "tp-6",
        part: {
          type: "tool",
          tool: "Agent",
          callID: "tc-105",
          state: {
            status: "running",
            input: { description: "Explore codebase", subagent_type: "Explore" },
            time: { start: 1000 },
          },
        },
      }, ctx);

      const spawn = r1.events.find((e) => e.kind === "agent.subagent.spawn");
      expect(spawn).toBeDefined();
      expect(spawn).toMatchObject({
        subagentId: "tc-105",
        description: "Explore codebase",
        subagentType: "Explore",
      });

      // Completed
      const r2 = mapOpenCodeToCanonical(sid, "message.part.updated", {
        partId: "tp-6",
        part: {
          type: "tool",
          tool: "Agent",
          callID: "tc-105",
          state: {
            status: "completed",
            input: { description: "Explore codebase" },
            output: "Found 5 files",
            title: "Explore",
            metadata: {},
            time: { start: 1000, end: 2000 },
          },
        },
      }, ctx);

      const complete = r2.events.find((e) => e.kind === "agent.subagent.complete");
      expect(complete).toBeDefined();
      expect(complete).toMatchObject({ subagentId: "tc-105", success: true });
    });

    it("completed without prior pending still emits start + result", () => {
      const result = mapOpenCodeToCanonical(sid, "message.part.updated", {
        partId: "tp-7",
        part: {
          type: "tool",
          tool: "Write",
          callID: "tc-106",
          state: {
            status: "completed",
            input: { file_path: "/new.ts" },
            output: "written",
            title: "Write",
            metadata: {},
            time: { start: 1000, end: 1200 },
          },
        },
      }, ctx);

      const start = result.events.find((e) => e.kind === "agent.tool_call.start");
      expect(start).toBeDefined();
      expect(start).toMatchObject({ toolName: "Write", toolCallId: "tc-106" });

      const fileWrite = result.events.find((e) => e.kind === "agent.file.write");
      expect(fileWrite).toBeDefined();
      expect(fileWrite).toMatchObject({ filePath: "/new.ts" });

      const resultEvt = result.events.find((e) => e.kind === "agent.tool_call.result");
      expect(resultEvt).toBeDefined();
      expect(resultEvt).toMatchObject({ success: true });
    });
  });

  // ---- AgentPart ----

  describe("AgentPart (message.part.updated type:agent)", () => {
    it("emits agent.subagent.spawn", () => {
      const result = mapOpenCodeToCanonical(sid, "message.part.updated", {
        partId: "ap-1",
        part: {
          type: "agent",
          name: "code-reviewer",
          source: "claude-sonnet",
        },
      }, ctx);

      expect(result.events).toHaveLength(1);
      expect(result.events[0]).toMatchObject({
        kind: "agent.subagent.spawn",
        subagentId: "ap-1",
        description: "code-reviewer",
        isBackground: false,
        subagentType: "claude-sonnet",
      });
    });
  });

  // ---- SubtaskPart ----

  describe("SubtaskPart (message.part.updated type:subtask)", () => {
    it("emits agent.subagent.spawn with description and agent", () => {
      const result = mapOpenCodeToCanonical(sid, "message.part.updated", {
        partId: "sp-1",
        part: {
          type: "subtask",
          prompt: "Analyze the database schema",
          description: "Schema analysis",
          agent: "database-architect",
          model: "claude-opus",
        },
      }, ctx);

      expect(result.events).toHaveLength(1);
      expect(result.events[0]).toMatchObject({
        kind: "agent.subagent.spawn",
        subagentId: "sp-1",
        description: "Schema analysis",
        subagentType: "database-architect",
      });
    });

    it("falls back to prompt when description is absent", () => {
      const result = mapOpenCodeToCanonical(sid, "message.part.updated", {
        partId: "sp-2",
        part: {
          type: "subtask",
          prompt: "Fix the login bug",
          agent: "error-detective",
        },
      }, ctx);

      expect(result.events[0]).toMatchObject({
        description: "Fix the login bug",
        subagentType: "error-detective",
      });
    });
  });

  // ---- StepStartPart / StepFinishPart ----

  describe("StepParts (message.part.updated)", () => {
    it("step-start emits agent.step", () => {
      const result = mapOpenCodeToCanonical(sid, "message.part.updated", {
        partId: "ss-1",
        part: { type: "step-start", snapshot: {} },
      }, ctx);

      expect(result.events).toHaveLength(1);
      expect(result.events[0]).toEqual({
        kind: "agent.step",
        description: "LLM step started",
      });
    });

    it("step-finish emits agent.step with summary", () => {
      const result = mapOpenCodeToCanonical(sid, "message.part.updated", {
        partId: "sf-1",
        part: {
          type: "step-finish",
          reason: "end_turn",
          tokens: { input: 1000, output: 500 },
          cost: 0.0234,
        },
      }, ctx);

      expect(result.events).toHaveLength(1);
      const event = result.events[0] as { kind: string; description: string };
      expect(event.kind).toBe("agent.step");
      expect(event.description).toContain("end_turn");
      expect(event.description).toContain("1500 tokens");
      expect(event.description).toContain("$0.0234");
    });
  });

  // ---- FilePart ----

  describe("FilePart (message.part.updated type:file)", () => {
    it("emits agent.file.read with url", () => {
      const result = mapOpenCodeToCanonical(sid, "message.part.updated", {
        partId: "fp-1",
        part: {
          type: "file",
          mime: "text/plain",
          url: "/workspace/src/index.ts",
          filename: "index.ts",
        },
      }, ctx);

      expect(result.events).toHaveLength(1);
      expect(result.events[0]).toMatchObject({
        kind: "agent.file.read",
        filePath: "/workspace/src/index.ts",
      });
    });
  });

  // ---- PatchPart ----

  describe("PatchPart (message.part.updated type:patch)", () => {
    it("emits agent.file.edit for each file", () => {
      const result = mapOpenCodeToCanonical(sid, "message.part.updated", {
        partId: "pp-1",
        part: {
          type: "patch",
          hash: "abc123",
          files: [
            { path: "/src/a.ts", name: "a.ts" },
            { path: "/src/b.ts", name: "b.ts" },
          ],
        },
      }, ctx);

      expect(result.events).toHaveLength(2);
      expect(result.events[0]).toMatchObject({ kind: "agent.file.edit", filePath: "/src/a.ts" });
      expect(result.events[1]).toMatchObject({ kind: "agent.file.edit", filePath: "/src/b.ts" });
    });
  });

  // ---- RetryPart ----

  describe("RetryPart (message.part.updated type:retry)", () => {
    it("emits agent.step with retry info", () => {
      const result = mapOpenCodeToCanonical(sid, "message.part.updated", {
        partId: "rp-1",
        part: {
          type: "retry",
          attempt: 2,
          error: { message: "Rate limited" },
        },
      }, ctx);

      expect(result.events).toHaveLength(1);
      const event = result.events[0] as { kind: string; description: string };
      expect(event.kind).toBe("agent.step");
      expect(event.description).toContain("Retry attempt 2");
      expect(event.description).toContain("Rate limited");
    });
  });

  // ---- CompactionPart ----

  describe("CompactionPart (message.part.updated type:compaction)", () => {
    it("emits agent.step about compaction", () => {
      const result = mapOpenCodeToCanonical(sid, "message.part.updated", {
        partId: "cp-1",
        part: { type: "compaction", auto: true },
      }, ctx);

      expect(result.events).toHaveLength(1);
      expect(result.events[0]).toMatchObject({
        kind: "agent.step",
        description: "Context compaction performed",
      });
    });
  });

  // ---- permission.asked ----

  describe("permission.asked", () => {
    it("emits agent.permission.request with tool name", () => {
      const result = mapOpenCodeToCanonical(sid, "permission.asked", {
        id: "perm-1",
        tool: "Bash",
        patterns: ["*.sh", "deploy/*"],
      }, ctx);

      expect(result.events).toHaveLength(1);
      expect(result.events[0]).toMatchObject({
        kind: "agent.permission.request",
        toolName: "Bash",
        description: "Bash: *.sh, deploy/*",
      });
      expect(result.requiresInput).toBe(true);
    });

    it("uses toolName field as fallback", () => {
      const result = mapOpenCodeToCanonical(sid, "permission.asked", {
        toolName: "Write",
      }, ctx);

      expect(result.events[0]).toMatchObject({
        kind: "agent.permission.request",
        toolName: "Write",
      });
    });
  });

  // ---- file.edited ----

  describe("file.edited", () => {
    it("emits agent.file.edit", () => {
      const result = mapOpenCodeToCanonical(sid, "file.edited", {
        file: "/workspace/src/app.ts",
      }, ctx);

      expect(result.events).toHaveLength(1);
      expect(result.events[0]).toMatchObject({
        kind: "agent.file.edit",
        filePath: "/workspace/src/app.ts",
      });
    });
  });

  // ---- session.idle completes active tools and subagents ----

  describe("session.idle with active tools and subagents", () => {
    it("completes pending tool calls on idle", () => {
      // Simulate a running tool
      mapOpenCodeToCanonical(sid, "message.part.updated", {
        partId: "tp-idle-1",
        part: {
          type: "tool",
          tool: "Read",
          callID: "tc-idle-1",
          state: {
            status: "running",
            input: { file_path: "/x.ts" },
            time: { start: 1000 },
          },
        },
      }, ctx);

      expect(ctx.activeTools.size).toBe(1);

      const result = mapOpenCodeToCanonical(sid, "session.idle", {}, ctx);

      const toolResult = result.events.find((e) => e.kind === "agent.tool_call.result");
      expect(toolResult).toBeDefined();
      expect(toolResult).toMatchObject({
        toolCallId: "tc-idle-1",
        toolName: "Read",
        success: true,
      });

      expect(ctx.activeTools.size).toBe(0);
    });

    it("completes active subagents on idle", () => {
      // Simulate a subagent spawn via AgentPart
      mapOpenCodeToCanonical(sid, "message.part.updated", {
        partId: "sub-idle-1",
        part: {
          type: "agent",
          name: "researcher",
        },
      }, ctx);

      const result = mapOpenCodeToCanonical(sid, "session.idle", {}, ctx);

      const subComplete = result.events.find((e) => e.kind === "agent.subagent.complete");
      expect(subComplete).toBeDefined();
      expect(subComplete).toMatchObject({
        subagentId: "sub-idle-1",
        success: true,
      });
    });

    it("clears emittedToolIds on idle", () => {
      mapOpenCodeToCanonical(sid, "message.part.updated", {
        partId: "tp-eid-1",
        part: {
          type: "tool",
          tool: "Read",
          callID: "tc-eid-1",
          state: { status: "pending", input: {}, raw: "" },
        },
      }, ctx);

      expect(ctx.emittedToolIds.size).toBe(1);

      mapOpenCodeToCanonical(sid, "session.idle", {}, ctx);

      expect(ctx.emittedToolIds.size).toBe(0);
    });
  });

  // ---- ReasoningPart ----

  describe("ReasoningPart (message.part.updated type:reasoning)", () => {
    it("updates partSnapshots but emits no events", () => {
      const result = mapOpenCodeToCanonical(sid, "message.part.updated", {
        partId: "rp-1",
        part: {
          type: "reasoning",
          text: "Let me think about this...",
        },
      }, ctx);

      expect(result.events).toHaveLength(0);
      expect(ctx.partSnapshots.get("rp-1")).toBe("Let me think about this...");
    });
  });

  // ---- Ignored events ----

  describe("ignored events", () => {
    const ignoredEvents = [
      "session.created", "session.updated", "session.deleted",
      "session.diff", "session.compacted",
      "message.removed", "message.part.removed",
      "question.replied", "question.rejected",
      "permission.replied",
      "file.watcher.updated", "command.executed",
      "installation.updated", "lsp.updated",
    ];

    for (const eventType of ignoredEvents) {
      it(`${eventType} emits no events`, () => {
        const result = mapOpenCodeToCanonical(sid, eventType, {}, ctx);
        expect(result.events).toHaveLength(0);
      });
    }
  });
});
