import { describe, test, expect } from "bun:test";
import { mapClaudeToCanonical } from "./canonical-mapper.js";
import type { CanonicalEvent } from "@almirant/shim-server";

const SESSION = "test-canonical-session";

// ---- Event factory helpers ----

const textDelta = (text: string) => ({
  type: "stream_event",
  event: {
    type: "content_block_delta",
    delta: { type: "text_delta", text },
  },
});

const thinkingDelta = (thinking: string) => ({
  type: "stream_event",
  event: {
    type: "content_block_delta",
    delta: { type: "thinking_delta", thinking },
  },
});

const toolBlockStart = (name: string, id: string) => ({
  type: "stream_event",
  event: {
    type: "content_block_start",
    content_block: { type: "tool_use", name, id },
  },
});

const inputJsonDelta = (partial_json: string) => ({
  type: "stream_event",
  event: {
    type: "content_block_delta",
    delta: { type: "input_json_delta", partial_json },
  },
});

const blockStop = () => ({
  type: "stream_event",
  event: { type: "content_block_stop" },
});

const assistantEvent = (content: Array<Record<string, unknown>>) => ({
  type: "assistant",
  message: { role: "assistant", content },
});

const assistantText = (fullText: string) =>
  assistantEvent([{ type: "text", text: fullText }]);

const resultEvent = (text: string) => ({
  type: "result",
  result: text,
});

const askUserQuestion = (
  question:
    | string
    | Array<{ question: string; options?: string[] }>,
  options: string[] = [],
) =>
  assistantEvent([
    {
      type: "tool_use",
      name: "AskUserQuestion",
      id: "ask-1",
      input: {
        questions:
          typeof question === "string"
            ? [{ question, options }]
            : question,
      },
    },
  ]);

// ---- Extraction helpers ----

const eventsOfKind = (events: CanonicalEvent[], kind: string): CanonicalEvent[] =>
  events.filter((e) => e.kind === kind);

const firstOfKind = (events: CanonicalEvent[], kind: string): CanonicalEvent | undefined =>
  events.find((e) => e.kind === kind);

describe("mapClaudeToCanonical", () => {
  // NOTE: Tests rely on module-level state. They run sequentially,
  // simulating a realistic session lifecycle.

  describe("text streaming", () => {
    test("text_delta produces agent.text", () => {
      const result = mapClaudeToCanonical(SESSION, textDelta("Hello"));
      const texts = eventsOfKind(result.events, "agent.text");
      expect(texts).toHaveLength(1);
      expect((texts[0] as { kind: "agent.text"; content: string }).content).toBe("Hello");
    });

    test("thinking_delta produces agent.thinking", () => {
      const result = mapClaudeToCanonical(SESSION, thinkingDelta("Let me think..."));
      const thoughts = eventsOfKind(result.events, "agent.thinking");
      expect(thoughts).toHaveLength(1);
      expect((thoughts[0] as { kind: "agent.thinking"; content: string }).content).toBe("Let me think...");
    });
  });

  describe("dedup: assistant skipped when hasStreamedContent=true", () => {
    test("assistant text is skipped after stream_event was seen", () => {
      // hasStreamedContent is already true from previous tests
      const result = mapClaudeToCanonical(SESSION, assistantText("Hello"));
      const texts = eventsOfKind(result.events, "agent.text");
      expect(texts).toHaveLength(0);
    });
  });

  describe("tool call lifecycle", () => {
    test("content_block_start tool_use produces agent.tool_call.start", () => {
      const result = mapClaudeToCanonical(SESSION, toolBlockStart("Read", "tc-read-1"));
      const starts = eventsOfKind(result.events, "agent.tool_call.start");
      expect(starts).toHaveLength(1);
      const start = starts[0] as { kind: "agent.tool_call.start"; toolName: string; toolCallId: string };
      expect(start.toolName).toBe("Read");
      expect(start.toolCallId).toBe("tc-read-1");
    });

    test("content_block_stop with Read input produces agent.file.read", () => {
      // Send input_json_delta chunks
      mapClaudeToCanonical(SESSION, inputJsonDelta('{"file_path":'));
      mapClaudeToCanonical(SESSION, inputJsonDelta('"/src/index.ts"}'));

      const result = mapClaudeToCanonical(SESSION, blockStop());
      const reads = eventsOfKind(result.events, "agent.file.read");
      expect(reads).toHaveLength(1);
      const read = reads[0] as { kind: "agent.file.read"; toolCallId: string; filePath: string };
      expect(read.toolCallId).toBe("tc-read-1");
      expect(read.filePath).toBe("/src/index.ts");
    });

    test("content_block_stop with Bash input produces agent.bash.execute", () => {
      mapClaudeToCanonical(SESSION, toolBlockStart("Bash", "tc-bash-1"));
      mapClaudeToCanonical(SESSION, inputJsonDelta('{"command":"ls -la","description":"List files"}'));

      const result = mapClaudeToCanonical(SESSION, blockStop());
      const bashes = eventsOfKind(result.events, "agent.bash.execute");
      expect(bashes).toHaveLength(1);
      const bash = bashes[0] as { kind: "agent.bash.execute"; toolCallId: string; command: string; description?: string };
      expect(bash.toolCallId).toBe("tc-bash-1");
      expect(bash.command).toBe("ls -la");
      expect(bash.description).toBe("List files");
    });

    test("content_block_stop with Agent/Task input produces agent.subagent.spawn", () => {
      mapClaudeToCanonical(SESSION, toolBlockStart("Task", "tc-task-1"));
      mapClaudeToCanonical(
        SESSION,
        inputJsonDelta('{"description":"Analyze codebase","run_in_background":false}'),
      );

      const result = mapClaudeToCanonical(SESSION, blockStop());
      const spawns = eventsOfKind(result.events, "agent.subagent.spawn");
      expect(spawns).toHaveLength(1);
      const spawn = spawns[0] as {
        kind: "agent.subagent.spawn";
        subagentId: string;
        description: string;
        isBackground: boolean;
      };
      expect(spawn.subagentId).toBe("tc-task-1");
      expect(spawn.description).toBe("Analyze codebase");
      expect(spawn.isBackground).toBe(false);
    });
  });

  describe("AskUserQuestion", () => {
    test("AskUserQuestion produces agent.question", () => {
      const result = mapClaudeToCanonical(
        SESSION,
        askUserQuestion("Which approach?", ["Option A", "Option B"]),
      );
      const questions = eventsOfKind(result.events, "agent.question");
      expect(questions).toHaveLength(1);
      const q = questions[0] as {
        kind: "agent.question";
        questionText: string;
        options?: string[];
      };
      expect(q.questionText).toBe("Which approach?");
      expect(q.options).toEqual(["Option A", "Option B"]);
      expect(result.requiresInput).toBe(true);
    });

    test("AskUserQuestion preserves structured grouped questions", () => {
      const result = mapClaudeToCanonical(
        SESSION,
        askUserQuestion([
          { question: "Pregunta 1", options: ["Opción 1A", "Opción 1B"] },
          { question: "Pregunta 2", options: ["Opción 2A"] },
        ]),
      );

      const questions = eventsOfKind(result.events, "agent.question");
      expect(questions).toHaveLength(1);
      const q = questions[0] as {
        kind: "agent.question";
        questionText: string;
        options?: string[];
        questions?: Array<{ text: string; options: string[] }>;
      };

      expect(q.questionText).toBe("Pregunta 1\nPregunta 2");
      expect(q.questions).toEqual([
        { text: "Pregunta 1", options: ["Opción 1A", "Opción 1B"] },
        { text: "Pregunta 2", options: ["Opción 2A"] },
      ]);
    });
  });

  describe("result event", () => {
    test("result produces agent.text.complete and session.idle", () => {
      const result = mapClaudeToCanonical(SESSION, resultEvent("Final output"));
      const completes = eventsOfKind(result.events, "agent.text.complete");
      expect(completes).toHaveLength(1);
      expect(
        (completes[0] as { kind: "agent.text.complete"; fullText: string }).fullText,
      ).toBe("Final output");

      const idles = eventsOfKind(result.events, "session.idle");
      expect(idles).toHaveLength(1);
      const idle = idles[0] as {
        kind: "session.idle";
        hasBackgroundAgents: boolean;
        isPlanningJob: boolean;
      };
      expect(idle.hasBackgroundAgents).toBe(false);
      expect(idle.isPlanningJob).toBe(false);
    });
  });

  describe("REGRESSION: hasStreamedContent persists across result", () => {
    test("assistant event after result does NOT emit duplicate text", () => {
      // After the result event in previous test, hasStreamedContent should still be true.
      // An assistant snapshot arriving before stream_event deltas in the next turn
      // must be skipped to avoid duplication.
      const r = mapClaudeToCanonical(SESSION, assistantText("## Phase 2"));
      const texts = eventsOfKind(r.events, "agent.text");
      expect(texts).toHaveLength(0);
    });

    test("stream_event deltas in next turn still work", () => {
      const r = mapClaudeToCanonical(SESSION, textDelta("## Phase 2"));
      const texts = eventsOfKind(r.events, "agent.text");
      expect(texts).toHaveLength(1);
      expect((texts[0] as { kind: "agent.text"; content: string }).content).toBe("## Phase 2");
    });
  });

  describe("multi-turn subagent completion on session.idle", () => {
    test("active subagents complete on session.idle", () => {
      // Spawn a subagent
      mapClaudeToCanonical(SESSION, toolBlockStart("Task", "tc-sub-2"));
      mapClaudeToCanonical(SESSION, inputJsonDelta('{"description":"Sub task"}'));
      mapClaudeToCanonical(SESSION, blockStop());

      // Now end the turn — subagent should be auto-completed
      const result = mapClaudeToCanonical(SESSION, resultEvent("Done"));
      const completions = eventsOfKind(result.events, "agent.subagent.complete");
      expect(completions).toHaveLength(1);
      const completion = completions[0] as {
        kind: "agent.subagent.complete";
        subagentId: string;
        success: boolean;
      };
      expect(completion.subagentId).toBe("tc-sub-2");
      expect(completion.success).toBe(true);
    });
  });

  describe("error events", () => {
    test("error event produces session.error", () => {
      const result = mapClaudeToCanonical(SESSION, {
        type: "error",
        error: "Something went wrong",
      });
      const errors = eventsOfKind(result.events, "session.error");
      expect(errors).toHaveLength(1);
      expect(
        (errors[0] as { kind: "session.error"; message: string }).message,
      ).toBe("Something went wrong");
    });
  });

  describe("Edit tool", () => {
    test("content_block_stop with Edit input produces agent.file.edit", () => {
      mapClaudeToCanonical(SESSION, toolBlockStart("Edit", "tc-edit-1"));
      mapClaudeToCanonical(
        SESSION,
        inputJsonDelta('{"file_path":"/src/app.ts","old_string":"foo","new_string":"bar"}'),
      );

      const result = mapClaudeToCanonical(SESSION, blockStop());
      const edits = eventsOfKind(result.events, "agent.file.edit");
      expect(edits).toHaveLength(1);
      const edit = edits[0] as { kind: "agent.file.edit"; toolCallId: string; filePath: string };
      expect(edit.toolCallId).toBe("tc-edit-1");
      expect(edit.filePath).toBe("/src/app.ts");
    });
  });

  describe("Write tool", () => {
    test("content_block_stop with Write input produces agent.file.write", () => {
      mapClaudeToCanonical(SESSION, toolBlockStart("Write", "tc-write-1"));
      mapClaudeToCanonical(
        SESSION,
        inputJsonDelta('{"file_path":"/src/new-file.ts","content":"export const x = 1;"}'),
      );

      const result = mapClaudeToCanonical(SESSION, blockStop());
      const writes = eventsOfKind(result.events, "agent.file.write");
      expect(writes).toHaveLength(1);
      const write = writes[0] as { kind: "agent.file.write"; toolCallId: string; filePath: string };
      expect(write.toolCallId).toBe("tc-write-1");
      expect(write.filePath).toBe("/src/new-file.ts");
    });
  });

  // ---- system event subtypes (contract verified live against claude-code 2.1.198) ----
  //
  // 2.1.198 introduces `system:thinking_tokens` (progress heartbeat, ~3 per turn)
  // and keeps `system:status` (status:"requesting") and hook_started/hook_response
  // subtypes seen since 2.1.119. None of these mark session readiness — only
  // `system:init` may emit session.connected. Emitting session.connected for
  // every informational subtype would flood consumers mid-turn.
  describe("system event subtypes (claude-code 2.1.198)", () => {
    test("system:init produces session.connected with metadata", () => {
      const result = mapClaudeToCanonical(SESSION, {
        type: "system",
        subtype: "init",
        model: "claude-sonnet-5",
        claude_code_version: "2.1.198",
        permissionMode: "bypassPermissions",
        tools: ["Bash", "Read", "Write"],
      });
      const connected = eventsOfKind(result.events, "session.connected");
      expect(connected).toHaveLength(1);
      const meta = (connected[0] as { metadata?: Record<string, unknown> }).metadata;
      expect(meta?.model).toBe("claude-sonnet-5");
      expect(meta?.claudeCodeVersion).toBe("2.1.198");
      expect(meta?.toolCount).toBe(3);
    });

    test("system:thinking_tokens does NOT emit session.connected (2.1.198 payload)", () => {
      // Exact shape captured live from claude-code 2.1.198
      const result = mapClaudeToCanonical(SESSION, {
        type: "system",
        subtype: "thinking_tokens",
        estimated_tokens: 184,
        estimated_tokens_delta: 134,
        uuid: "c8031c9a-826e-4d71-8827-77e29ca98589",
        session_id: "6d98c855-5272-4155-80e7-a34b773dfe3f",
      });
      expect(eventsOfKind(result.events, "session.connected")).toHaveLength(0);
      expect(result.events).toHaveLength(0);
    });

    test("system:status does NOT emit session.connected (payload since 2.1.119)", () => {
      const result = mapClaudeToCanonical(SESSION, {
        type: "system",
        subtype: "status",
        status: "requesting",
        uuid: "86f4b5a6-7fa1-428c-b60f-5cf1c16565c8",
        session_id: "b20b662c-c950-45f3-b4ee-37348d996845",
      });
      expect(eventsOfKind(result.events, "session.connected")).toHaveLength(0);
      expect(result.events).toHaveLength(0);
    });

    test("system:hook_started / hook_response do NOT emit session.connected", () => {
      const started = mapClaudeToCanonical(SESSION, {
        type: "system",
        subtype: "hook_started",
        hook_id: "h1",
        hook_name: "PreToolUse",
        hook_event: "PreToolUse",
      });
      const response = mapClaudeToCanonical(SESSION, {
        type: "system",
        subtype: "hook_response",
        hook_id: "h1",
        outcome: "success",
        exit_code: 0,
      });
      expect(started.events).toHaveLength(0);
      expect(response.events).toHaveLength(0);
    });
  });

  describe("rate_limit_event (top-level type, present in 2.1.119 and 2.1.198)", () => {
    test("rate_limit_event is ignored without emitting session.error", () => {
      const result = mapClaudeToCanonical(SESSION, {
        type: "rate_limit_event",
        rate_limit_info: {
          status: "allowed",
          resetsAt: 1782990000,
          rateLimitType: "five_hour",
        },
      });
      expect(result.events).toHaveLength(0);
    });
  });
});
