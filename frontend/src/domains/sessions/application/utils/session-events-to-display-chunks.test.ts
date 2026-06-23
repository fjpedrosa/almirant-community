import { describe, expect, it } from "bun:test";
import type { AgentLogChunk } from "@/domains/shared/domain/types";
import type { SessionEventRecord } from "@/domains/sessions/domain/types";
import { buildSessionDisplayChunks } from "./session-events-to-display-chunks";
import { chunksToConversationMessages } from "./chunks-to-conversation-messages";
import { parseChunksToStreamingBlocks } from "./chunk-to-block-parser";

const makeChunk = (
  overrides: Partial<AgentLogChunk> & Pick<AgentLogChunk, "id" | "seq" | "phase" | "eventType" | "message" | "timestamp">,
): AgentLogChunk => ({
  level: "info",
  ...overrides,
});

const makeSessionEvent = (
  overrides: Partial<SessionEventRecord> &
    Pick<SessionEventRecord, "id" | "agentJobId" | "sequenceNum" | "kind" | "payload" | "createdAt">,
): SessionEventRecord => ({
  provider: "codex",
  planningSessionId: null,
  ...overrides,
});

describe("buildSessionDisplayChunks", () => {
  it("uses canonical Codex events and drops the injected skill prompt from logs", () => {
    const rawChunks: AgentLogChunk[] = [
      makeChunk({
        id: "prompt",
        seq: 1,
        phase: "session",
        eventType: "prompt.sent",
        message:
          'IMPORTANT: You MUST respond in English. <skill name="runner-implement">...',
        payload: {
          prompt:
            'IMPORTANT: You MUST respond in English. <skill name="runner-implement">...',
        },
        timestamp: "2026-04-08T11:01:19.000Z",
      }),
      makeChunk({
        id: "workspace",
        seq: 2,
        phase: "workspace",
        eventType: "workspace.ready",
        message: "Workspace ready",
        timestamp: "2026-04-08T11:01:20.000Z",
      }),
      makeChunk({
        id: "raw-output",
        seq: 3,
        phase: "transcript",
        eventType: "raw_output",
        message: "Using runner-implement for A-F-398.",
        contentType: "text",
        timestamp: "2026-04-08T11:01:21.000Z",
      }),
    ];

    const sessionEvents: SessionEventRecord[] = [
      makeSessionEvent({
        id: "evt-1",
        agentJobId: "e0aea661-1478-4916-b84c-5dd86bb04b68",
        sequenceNum: 1,
        kind: "agent.text.complete",
        payload: {
          fullText: "Using runner-implement for A-F-398.",
        },
        createdAt: "2026-04-08T11:01:21.000Z",
      }),
      makeSessionEvent({
        id: "evt-2",
        agentJobId: "e0aea661-1478-4916-b84c-5dd86bb04b68",
        sequenceNum: 2,
        kind: "agent.tool_call.start",
        payload: {
          toolName: "mcp__almirant__list_new_bug_feedback",
          toolCallId: "item_2",
          inputPreview: "query: list_new_bug_feedback almirant feedback",
        },
        createdAt: "2026-04-08T11:01:22.000Z",
      }),
    ];

    const result = buildSessionDisplayChunks(rawChunks, sessionEvents, "codex");

    expect(result.some((chunk) => chunk.eventType === "prompt.sent")).toBe(false);
    expect(result.some((chunk) => chunk.phase === "transcript" && chunk.contentType === "text")).toBe(true);
    expect(result.some((chunk) => chunk.phase === "transcript" && chunk.contentType === "tool_use")).toBe(true);
  });

  it("uses canonical OpenCode events instead of raw echoed prompts", () => {
    const rawChunks: AgentLogChunk[] = [
      makeChunk({
        id: "skill",
        seq: 1,
        phase: "skills",
        eventType: "skill.validated",
        message: 'Skill "runner-implement" found in workspace',
        payload: { skillName: "runner-implement" },
        timestamp: "2026-04-27T08:23:39.000Z",
      }),
      makeChunk({
        id: "prompt",
        seq: 2,
        phase: "session",
        eventType: "prompt.sent",
        message: "Initial prompt sent",
        payload: {
          prompt:
            "IMPORTANT: You MUST respond in English. All user-facing text (summaries, descriptions, comments, PR bodies, commit messages, progress updates) must be in English.\n\n/runner-implement F-F-6",
        },
        timestamp: "2026-04-27T08:23:40.000Z",
      }),
      makeChunk({
        id: "echoed-prompt",
        seq: 3,
        phase: "transcript",
        eventType: "raw_output",
        message:
          "IMPORTANT: You MUST respond in English. All user-facing text (summaries, descriptions, comments, PR bodies, commit messages, progress updates) must be in English.\n\n/runner-implement F-F-6",
        contentType: "text",
        timestamp: "2026-04-27T08:23:40.000Z",
      }),
      makeChunk({
        id: "assistant-delta",
        seq: 4,
        phase: "transcript",
        eventType: "raw_output",
        message: "I'll load the runner-implement skill first.",
        contentType: "text",
        timestamp: "2026-04-27T08:24:03.000Z",
      }),
    ];

    const sessionEvents: SessionEventRecord[] = [
      makeSessionEvent({
        id: "evt-prompt-info",
        agentJobId: "job-opencode",
        sequenceNum: 1,
        kind: "system.info",
        payload: {
          kind: "system.info",
          message:
            "Prompt sent: `IMPORTANT: You MUST respond in English.\n\n/runner-implement F-F-6`",
        },
        provider: "opencode",
        createdAt: "2026-04-27T08:23:40.000Z",
      }),
      makeSessionEvent({
        id: "evt-agent-1",
        agentJobId: "job-opencode",
        sequenceNum: 2,
        kind: "agent.text",
        payload: { content: "I'll" },
        provider: "opencode",
        createdAt: "2026-04-27T08:24:03.000Z",
      }),
      makeSessionEvent({
        id: "evt-agent-2",
        agentJobId: "job-opencode",
        sequenceNum: 3,
        kind: "agent.text",
        payload: { content: " load the runner-implement skill first." },
        provider: "opencode",
        createdAt: "2026-04-27T08:24:03.000Z",
      }),
    ];

    const result = buildSessionDisplayChunks(rawChunks, sessionEvents, "zipu");
    const blocks = parseChunksToStreamingBlocks(result, true);

    expect(result.some((chunk) => chunk.message.includes("IMPORTANT: You MUST respond"))).toBe(false);
    expect(result.some((chunk) => chunk.eventType === "prompt.sent")).toBe(false);
    expect(blocks).toContainEqual({
      type: "info",
      content: "Loading skill: `runner-implement`",
    });
    expect(blocks.some((block) => block.type === "text" && block.content === "I'll load the runner-implement skill first.")).toBe(true);
  });

  it("drops OpenCode canonical agent text when it echoes the injected runner prompt", () => {
    const result = buildSessionDisplayChunks(
      [],
      [
        makeSessionEvent({
          id: "evt-prompt-echo",
          agentJobId: "job-opencode",
          sequenceNum: 1,
          kind: "agent.text.complete",
          payload: {
            fullText:
              "IMPORTANT: You MUST respond in Spanish. All user-facing text (summaries, descriptions, comments, PR bodies, commit messages, progress updates) must be in Spanish.\n\n/runner-implement ZC-156",
          },
          provider: "opencode",
          createdAt: "2026-05-02T13:18:27.000Z",
        }),
        makeSessionEvent({
          id: "evt-thinking",
          agentJobId: "job-opencode",
          sequenceNum: 2,
          kind: "agent.thinking",
          payload: {
            content: "The user wants me to implement the runner task.",
          },
          provider: "opencode",
          createdAt: "2026-05-02T13:18:30.000Z",
        }),
        makeSessionEvent({
          id: "evt-real-text",
          agentJobId: "job-opencode",
          sequenceNum: 3,
          kind: "agent.text.complete",
          payload: {
            fullText: "Resolviendo tareas y calculando waves...",
          },
          provider: "opencode",
          createdAt: "2026-05-02T13:18:31.000Z",
        }),
      ],
      "zipu",
    );

    expect(result.some((chunk) => chunk.message.includes("IMPORTANT: You MUST respond"))).toBe(false);
    expect(result).toHaveLength(2);
    expect(result[0]?.contentType).toBe("thinking");
    expect(result[1]?.message).toBe("Resolviendo tareas y calculando waves...");
  });

  it("drops OpenCode canonical agent text when it echoes a delegated subagent prompt", () => {
    const delegatedPrompt = `You are implementing work item ZC-156: "Añadir notas editables de operador a propuestas de Pitch Deck"

## Task Details
- **Type**: task | **Priority**: high
- **Description**: Añadir una nota editable y persistente.

## Working Directory

All work MUST happen in the current working directory (already set up by the runner).

## IMPORTANT: Do NOT commit or push

The orchestrator handles all git operations (commit, push) after your work is done.

## Codebase Context (gathered by orchestrator)

### 1. Database schema — \`backend/packages/database/src/schema.ts\`

The proposalCandidates table is defined starting at line 330.

## Instructions

1. **Implement** following the patterns described above.`;

    const result = buildSessionDisplayChunks(
      [],
      [
        makeSessionEvent({
          id: "evt-delegated-prompt",
          agentJobId: "job-opencode",
          sequenceNum: 1,
          kind: "agent.text.complete",
          payload: {
            fullText: delegatedPrompt,
          },
          provider: "opencode",
          createdAt: "2026-05-02T13:22:00.114Z",
        }),
        makeSessionEvent({
          id: "evt-thinking",
          agentJobId: "job-opencode",
          sequenceNum: 2,
          kind: "agent.thinking",
          payload: {
            content: "I'll start by reading all the files I need to modify.",
          },
          provider: "opencode",
          createdAt: "2026-05-02T13:22:02.000Z",
        }),
        makeSessionEvent({
          id: "evt-real-agent-text",
          agentJobId: "job-opencode",
          sequenceNum: 3,
          kind: "agent.text.complete",
          payload: {
            fullText:
              "I'll start by reading all the files I need to modify to understand the current code patterns.",
          },
          provider: "opencode",
          createdAt: "2026-05-02T13:22:04.000Z",
        }),
      ],
      "zipu",
    );

    expect(result.some((chunk) => chunk.message.includes("You are implementing work item"))).toBe(false);
    expect(result.some((chunk) => chunk.message.includes("## Codebase Context"))).toBe(false);
    expect(result).toHaveLength(2);
    expect(result[0]?.contentType).toBe("thinking");
    expect(result[1]?.message).toBe(
      "I'll start by reading all the files I need to modify to understand the current code patterns.",
    );
  });

  it("preserves a closing markdown fence before the next canonical text event", () => {
    const result = buildSessionDisplayChunks(
      [],
      [
        makeSessionEvent({
          id: "evt-plan-start",
          agentJobId: "job-opencode",
          sequenceNum: 87,
          kind: "agent.text",
          payload: {
            content:
              "All 4 tasks moved to Doing.\n\n```\nExecution plan:\n  Branch: almirant/ZC-E",
          },
          provider: "opencode",
          createdAt: "2026-04-30T16:20:23.000Z",
        }),
        makeSessionEvent({
          id: "evt-plan-middle",
          agentJobId: "job-opencode",
          sequenceNum: 91,
          kind: "agent.text",
          payload: {
            content:
              "-20\n  Wave 1 (parallel): 4 tasks\n    - ZC-68: pii-anonymizer.ts",
          },
          provider: "opencode",
          createdAt: "2026-04-30T16:20:23.897Z",
        }),
        makeSessionEvent({
          id: "evt-plan-end",
          agentJobId: "job-opencode",
          sequenceNum: 96,
          kind: "agent.text",
          payload: {
            content: "\n    - ZC-69: retention-job.ts\n```",
          },
          provider: "opencode",
          createdAt: "2026-04-30T16:20:25.000Z",
        }),
        makeSessionEvent({
          id: "evt-heartbeat",
          agentJobId: "job-opencode",
          sequenceNum: 97,
          kind: "heartbeat",
          payload: {},
          provider: "opencode",
          createdAt: "2026-04-30T16:20:26.000Z",
        }),
        makeSessionEvent({
          id: "evt-next-message",
          agentJobId: "job-opencode",
          sequenceNum: 106,
          kind: "agent.text",
          payload: {
            content:
              "Interesting! It looks like some of the files already exist.",
          },
          provider: "opencode",
          createdAt: "2026-04-30T16:20:34.000Z",
        }),
      ],
      "zipu",
    );

    const transcript = result
      .filter((chunk) => chunk.contentType === "text")
      .map((chunk) => chunk.message)
      .join("");

    expect(transcript).toContain("almirant/ZC-E-20");
    expect(transcript).toContain("```\nInteresting!");
    expect(transcript).not.toContain("```Interesting");
  });

  it("drops prompt.sent from legacy raw-only session displays", () => {
    const result = buildSessionDisplayChunks(
      [
        makeChunk({
          id: "prompt",
          seq: 1,
          phase: "session",
          eventType: "prompt.sent",
          message: "Initial prompt sent",
          timestamp: "2026-04-27T08:23:40.000Z",
        }),
        makeChunk({
          id: "assistant",
          seq: 2,
          phase: "transcript",
          eventType: "raw_output",
          message: "Visible assistant text",
          contentType: "text",
          timestamp: "2026-04-27T08:24:03.000Z",
        }),
      ],
      [],
      "zipu",
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.message).toBe("Visible assistant text");
  });

  it("normaliza tool calls MCP genericas en el historial de Codex", () => {
    const chunks = buildSessionDisplayChunks(
      [],
      [
        makeSessionEvent({
          id: "evt-mcp-generic",
          agentJobId: "job-mcp-generic",
          sequenceNum: 1,
          kind: "agent.tool_call.start",
          payload: {
            toolName: "mcp_tool",
            toolCallId: "mcp-generic-1",
            inputPreview: JSON.stringify({
              server: "almirant",
              tool: "move_work_item",
              arguments: { taskId: "A-321" },
            }),
          },
          createdAt: "2026-04-12T12:00:00.000Z",
        }),
      ],
      "codex",
    );

    const blocks = parseChunksToStreamingBlocks(chunks, false);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      type: "tool_call",
      toolName: "mcp__almirant__move_work_item",
      toolCallId: "mcp-generic-1",
      status: "success",
    });
  });

  it("keeps non-heuristic Codex command_execution text as bash output chunks instead of assistant transcript text", () => {
    const result = buildSessionDisplayChunks(
      [],
      [
        makeSessionEvent({
          id: "evt-bash-start",
          agentJobId: "job-1",
          sequenceNum: 1,
          kind: "agent.bash.execute",
          payload: {
            toolCallId: "cmd-1",
            command: "/bin/bash -lc 'git status --short --branch'",
          },
          createdAt: "2026-04-12T01:00:00.000Z",
        }),
        makeSessionEvent({
          id: "evt-bash-text",
          agentJobId: "job-1",
          sequenceNum: 2,
          kind: "agent.text.complete",
          payload: {
            fullText:
              "$ /bin/bash -lc 'git status --short --branch'\n## main...origin/main",
            metadata: {
              source: "command_execution",
              toolCallId: "cmd-1",
            },
          },
          createdAt: "2026-04-12T01:00:01.000Z",
        }),
      ],
      "codex",
    );

    expect(result).toHaveLength(2);
    expect(result[0]?.eventType).toBe("agent.bash.execute");
    expect(result[0]?.payload?.command).toBe("/bin/bash -lc 'git status --short --branch'");
    expect(result[1]?.eventType).toBe("agent.bash.output");
    expect(result[1]?.payload?.output).toBe("## main...origin/main");
    expect(result.some((chunk) => chunk.contentType === "text")).toBe(false);
  });

  it("rehydrates historical Codex bash transcript text into bash output blocks", () => {
    const result = buildSessionDisplayChunks(
      [],
      [
        makeSessionEvent({
          id: "evt-bash-text-legacy",
          agentJobId: "job-legacy",
          sequenceNum: 10,
          kind: "agent.text.complete",
          payload: {
            fullText: "$ /bin/bash -lc 'git worktree list'\n/workspace/repo  48514ef [main]\n",
          },
          createdAt: "2026-04-12T09:19:07.061Z",
        }),
        makeSessionEvent({
          id: "evt-bash-start-legacy",
          agentJobId: "job-legacy",
          sequenceNum: 11,
          kind: "agent.tool_call.start",
          payload: {
            toolName: "Bash",
            toolCallId: "cmd-legacy-1",
            inputPreview: "/bin/bash -lc 'git worktree list'",
          },
          createdAt: "2026-04-12T09:19:07.061Z",
        }),
        makeSessionEvent({
          id: "evt-bash-execute-legacy",
          agentJobId: "job-legacy",
          sequenceNum: 12,
          kind: "agent.bash.execute",
          payload: {
            toolCallId: "cmd-legacy-1",
            command: "/bin/bash -lc 'git worktree list'",
          },
          createdAt: "2026-04-12T09:19:07.061Z",
        }),
      ],
      "codex",
    );

    expect(result.some((chunk) => chunk.contentType === "text")).toBe(false);
    expect(result.some((chunk) => chunk.eventType === "agent.bash.execute")).toBe(true);
    expect(result.some((chunk) => chunk.eventType === "agent.bash.output")).toBe(true);
    const outputChunk = result.find((chunk) => chunk.eventType === "agent.bash.output");
    expect(outputChunk?.payload?.toolCallId).toBe("cmd-legacy-1");
    expect(outputChunk?.payload?.output).toContain("/workspace/repo  48514ef [main]");
  });

  it("suppresses historical transcript lines when a later aliased bash tool call matches by sequence", () => {
    const chunks = buildSessionDisplayChunks(
      [],
      [
        makeSessionEvent({
          id: "evt-git-remote-text",
          agentJobId: "job-remote",
          sequenceNum: 1,
          kind: "agent.text.complete",
          payload: {
            fullText:
              "$ /bin/bash -lc 'git remote get-url origin'\\nhttps://github.com/almirant-ai/almirant\\n",
          },
          createdAt: "2026-04-12T11:20:00.000Z",
        }),
        makeSessionEvent({
          id: "evt-git-remote-start",
          agentJobId: "job-remote",
          sequenceNum: 2,
          kind: "agent.tool_call.start",
          payload: {
            toolName: "Bash",
            toolCallId: "cmd-remote-1",
            inputPreview: "/bin/bash -lc 'git remote get-url origin'",
          },
          createdAt: "2026-04-12T11:20:01.000Z",
        }),
        makeSessionEvent({
          id: "evt-git-remote-execute",
          agentJobId: "job-remote",
          sequenceNum: 3,
          kind: "agent.bash.execute",
          payload: {
            toolCallId: "cmd-remote-1",
            command: "/bin/bash -lc 'git remote get-url origin'",
          },
          createdAt: "2026-04-12T11:20:02.000Z",
        }),
      ],
      "codex",
    );

    const blocks = parseChunksToStreamingBlocks(chunks, false);
    expect(
      blocks.some(
        (block) =>
          block.type === "tool_call" &&
          block.toolName === "Git" &&
          block.toolCallId === "cmd-remote-1" &&
          block.inputPreview === "Remote URL",
      ),
    ).toBe(true);

  });

  it("synthesizes a bash block from tool_call.result when Codex never emitted the start event and no heuristic applies", () => {
    const result = buildSessionDisplayChunks(
      [],
      [
        makeSessionEvent({
          id: "evt-bash-result",
          agentJobId: "e0aea661-1478-4916-b84c-5dd86bb04b68",
          sequenceNum: 10,
          kind: "agent.tool_call.result",
          payload: {
            toolName: "Bash",
            toolCallId: "item_13",
            success: true,
            outputPreview: "$ git status --short --branch\n## main...origin/main",
          },
          createdAt: "2026-04-08T11:05:00.000Z",
        }),
      ],
      "codex",
    );

    expect(result).toHaveLength(2);
    expect(result[0]?.eventType).toBe("agent.bash.execute");
    expect(result[0]?.payload?.toolCallId).toBe("item_13");
    expect(result[0]?.payload?.command).toBe("git status --short --branch");
    expect(result[1]?.eventType).toBe("agent.bash.output");
    expect(result[1]?.payload?.output).toBe("## main...origin/main");
  });

  it("heuristically renders grep command_execution as a Grep tool call instead of bash console output", () => {
    const chunks = buildSessionDisplayChunks(
      [],
      [
        makeSessionEvent({
          id: "evt-grep-start",
          agentJobId: "job-grep",
          sequenceNum: 1,
          kind: "agent.tool_call.start",
          payload: {
            toolName: "Bash",
            toolCallId: "cmd-grep-1",
            inputPreview:
              '/bin/bash -lc "grep -RIn \\"pendingQuestion\\" frontend/src/domains/planning --include=\'*.ts\'"',
          },
          createdAt: "2026-04-12T11:00:00.000Z",
        }),
        makeSessionEvent({
          id: "evt-grep-execute",
          agentJobId: "job-grep",
          sequenceNum: 2,
          kind: "agent.bash.execute",
          payload: {
            toolCallId: "cmd-grep-1",
            command:
              '/bin/bash -lc "grep -RIn \\"pendingQuestion\\" frontend/src/domains/planning --include=\'*.ts\'"',
          },
          createdAt: "2026-04-12T11:00:01.000Z",
        }),
        makeSessionEvent({
          id: "evt-grep-output",
          agentJobId: "job-grep",
          sequenceNum: 3,
          kind: "agent.text.complete",
          payload: {
            fullText:
              '$ /bin/bash -lc "grep -RIn \\"pendingQuestion\\" frontend/src/domains/planning --include=\'*.ts\'"\nfrontend/src/domains/planning/foo.ts:10: pendingQuestion',
            metadata: {
              source: "command_execution",
              toolCallId: "cmd-grep-1",
            },
          },
          createdAt: "2026-04-12T11:00:02.000Z",
        }),
      ],
      "codex",
    );

    expect(chunks.some((chunk) => chunk.eventType === "agent.bash.execute")).toBe(false);
    expect(chunks.some((chunk) => chunk.eventType === "agent.bash.output")).toBe(false);

    const blocks = parseChunksToStreamingBlocks(chunks, false);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      type: "tool_call",
      toolName: "Grep",
      toolCallId: "cmd-grep-1",
      status: "success",
      inputPreview: "pendingQuestion",
    });
  });

  it("heuristically renders sed -n reads as Read tool calls", () => {
    const chunks = buildSessionDisplayChunks(
      [],
      [
        makeSessionEvent({
          id: "evt-read-start",
          agentJobId: "job-read",
          sequenceNum: 1,
          kind: "agent.tool_call.start",
          payload: {
            toolName: "Bash",
            toolCallId: "cmd-read-1",
            inputPreview:
              '/bin/bash -lc "sed -n \'900,1105p\' frontend/src/domains/planning/application/hooks/use-planning-session.ts"',
          },
          createdAt: "2026-04-12T11:10:00.000Z",
        }),
        makeSessionEvent({
          id: "evt-read-execute",
          agentJobId: "job-read",
          sequenceNum: 2,
          kind: "agent.bash.execute",
          payload: {
            toolCallId: "cmd-read-1",
            command:
              '/bin/bash -lc "sed -n \'900,1105p\' frontend/src/domains/planning/application/hooks/use-planning-session.ts"',
          },
          createdAt: "2026-04-12T11:10:01.000Z",
        }),
      ],
      "codex",
    );

    const blocks = parseChunksToStreamingBlocks(chunks, false);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      type: "tool_call",
      toolName: "Read",
      toolCallId: "cmd-read-1",
      status: "success",
      inputPreview:
        "frontend/src/domains/planning/application/hooks/use-planning-session.ts:900-1105",
    });
  });

  it("heuristically renders Codex nl -ba reads as Read tool calls", () => {
    const command =
      "nl -ba frontend/src/components/marketing/navbar-floating.tsx | sed -n '1,220p'";
    const chunks = buildSessionDisplayChunks(
      [],
      [
        makeSessionEvent({
          id: "evt-nl-start",
          agentJobId: "job-nl",
          sequenceNum: 1,
          kind: "agent.tool_call.start",
          payload: {
            toolName: "Bash",
            toolCallId: "cmd-nl-1",
            inputPreview: command,
          },
          createdAt: "2026-04-12T11:11:00.000Z",
        }),
        makeSessionEvent({
          id: "evt-nl-execute",
          agentJobId: "job-nl",
          sequenceNum: 2,
          kind: "agent.bash.execute",
          payload: {
            toolCallId: "cmd-nl-1",
            command,
          },
          createdAt: "2026-04-12T11:11:01.000Z",
        }),
        makeSessionEvent({
          id: "evt-nl-output",
          agentJobId: "job-nl",
          sequenceNum: 3,
          kind: "agent.text.complete",
          payload: {
            fullText: `$ ${command}\n     1\t"use client";`,
            metadata: {
              source: "command_execution",
              toolCallId: "cmd-nl-1",
            },
          },
          createdAt: "2026-04-12T11:11:02.000Z",
        }),
      ],
      "codex",
    );

    expect(chunks.some((chunk) => chunk.eventType === "agent.bash.execute")).toBe(false);
    expect(chunks.some((chunk) => chunk.eventType === "agent.bash.output")).toBe(false);

    const blocks = parseChunksToStreamingBlocks(chunks, false);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      type: "tool_call",
      toolName: "Read",
      toolCallId: "cmd-nl-1",
      status: "success",
      inputPreview: "frontend/src/components/marketing/navbar-floating.tsx",
    });
  });

  it("heuristically renders shell file existence reads as Read tool calls", () => {
    const command = "test -f ../package.json && sed -n '1,220p' ../package.json";
    const chunks = buildSessionDisplayChunks(
      [],
      [
        makeSessionEvent({
          id: "evt-test-file-start",
          agentJobId: "job-test-file",
          sequenceNum: 1,
          kind: "agent.tool_call.start",
          payload: {
            toolName: "Bash",
            toolCallId: "cmd-test-file-1",
            inputPreview: command,
          },
          createdAt: "2026-04-12T11:12:00.000Z",
        }),
        makeSessionEvent({
          id: "evt-test-file-execute",
          agentJobId: "job-test-file",
          sequenceNum: 2,
          kind: "agent.bash.execute",
          payload: {
            toolCallId: "cmd-test-file-1",
            command,
          },
          createdAt: "2026-04-12T11:12:01.000Z",
        }),
      ],
      "codex",
    );

    const blocks = parseChunksToStreamingBlocks(chunks, false);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      type: "tool_call",
      toolName: "Read",
      toolCallId: "cmd-test-file-1",
      status: "success",
      inputPreview: "../package.json",
    });
  });

  it("renders FileChange tool starts as Edit tool calls in session detail", () => {
    const chunks = buildSessionDisplayChunks(
      [],
      [
        makeSessionEvent({
          id: "evt-file-start",
          agentJobId: "job-file",
          sequenceNum: 1,
          kind: "agent.tool_call.start",
          payload: {
            toolName: "FileChange",
            toolCallId: "fc-1",
            inputPreview: "update: frontend/src/domains/sessions/application/utils/session-events-to-display-chunks.ts",
          },
          createdAt: "2026-04-12T11:20:00.000Z",
        }),
        makeSessionEvent({
          id: "evt-file-edit",
          agentJobId: "job-file",
          sequenceNum: 2,
          kind: "agent.file.edit",
          payload: {
            toolCallId: "fc-1",
            filePath: "frontend/src/domains/sessions/application/utils/session-events-to-display-chunks.ts",
          },
          createdAt: "2026-04-12T11:20:01.000Z",
        }),
      ],
      "codex",
    );

    const blocks = parseChunksToStreamingBlocks(chunks, false);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      type: "tool_call",
      toolName: "Edit",
      toolCallId: "fc-1",
      status: "success",
      inputPreview:
        "frontend/src/domains/sessions/application/utils/session-events-to-display-chunks.ts",
    });
  });

  it("uses heuristic fallback for Bash tool_call.result-only Glob events", () => {
    const chunks = buildSessionDisplayChunks(
      [],
      [
        makeSessionEvent({
          id: "evt-bash-glob-result",
          agentJobId: "job-glob",
          sequenceNum: 1,
          kind: "agent.tool_call.result",
          payload: {
            toolName: "Bash",
            toolCallId: "cmd-glob-1",
            success: true,
            outputPreview:
              "$ /bin/bash -lc 'rg --files frontend/src'\nfrontend/src/app/page.tsx",
          },
          createdAt: "2026-04-12T11:30:00.000Z",
        }),
      ],
      "codex",
    );

    const blocks = parseChunksToStreamingBlocks(chunks, false);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      type: "tool_call",
      toolName: "Glob",
      toolCallId: "cmd-glob-1",
      status: "success",
      inputPreview: "frontend/src",
    });
  });

  it("keeps agent.thinking as thinking chunks so the transcript can collapse them", () => {
    const result = buildSessionDisplayChunks(
      [],
      [
        makeSessionEvent({
          id: "evt-thinking",
          agentJobId: "job-1",
          sequenceNum: 1,
          kind: "agent.thinking",
          payload: {
            content: "I should inspect the file before editing it.",
          },
          createdAt: "2026-04-08T11:01:00.000Z",
        }),
      ],
      "codex",
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.contentType).toBe("thinking");
    expect(result[0]?.message).toContain("inspect the file");
  });

  it("collapses 1800 consecutive agent.text deltas into a single text chunk", () => {
    const events: SessionEventRecord[] = [];
    let textConcat = "";
    for (let i = 0; i < 1800; i += 1) {
      const fragment = `delta-${i} `;
      textConcat += fragment;
      events.push(
        makeSessionEvent({
          id: `evt-text-${i}`,
          agentJobId: "job-opencode-text-storm",
          sequenceNum: i + 1,
          kind: "agent.text",
          payload: { content: fragment },
          createdAt: new Date(2026, 3, 8, 11, 0, i % 60).toISOString(),
          provider: "zipu",
        }),
      );
    }

    const result = buildSessionDisplayChunks([], events, "zipu");

    const textChunks = result.filter(
      (chunk) =>
        chunk.contentType === "text" &&
        (chunk.eventType === "agent.text" || chunk.eventType === "agent.text.complete"),
    );
    expect(textChunks.length).toBe(1);
    expect(textChunks[0]?.message).toBe(textConcat);
  });

  it("collapses 3890 consecutive agent.thinking deltas into a single thinking chunk", () => {
    const events: SessionEventRecord[] = [];
    let thinkingConcat = "";
    for (let i = 0; i < 3890; i += 1) {
      const fragment = `t${i} `;
      thinkingConcat += fragment;
      events.push(
        makeSessionEvent({
          id: `evt-thinking-${i}`,
          agentJobId: "job-opencode-thinking-storm",
          sequenceNum: i + 1,
          kind: "agent.thinking",
          payload: { content: fragment },
          createdAt: new Date(2026, 3, 8, 11, 0, i % 60).toISOString(),
          provider: "zipu",
        }),
      );
    }

    const result = buildSessionDisplayChunks([], events, "zipu");

    const thinkingChunks = result.filter(
      (chunk) =>
        chunk.contentType === "thinking" && chunk.eventType === "agent.thinking",
    );
    expect(thinkingChunks.length).toBe(1);
    expect(thinkingChunks[0]?.message).toBe(thinkingConcat);
  });

  // ---------------------------------------------------------------------------
  // Regression: 383d0e9 caused multi-window text streams to be emitted as
  // multiple consecutive `agent.text.complete` events, each holding the
  // deltas of a single coalesce window — never the full message. The pre-fix
  // collapse logic walks the run from the end and uses the LAST
  // `agent.text.complete` as `finalText`, dropping every earlier fragment.
  // Symptom in the UI: "Loading skill" → replaced by "13/13: Retrying ..."
  // with everything in between lost (PR body for example-org/example-repo#32
  // was truncated mid-table for the same reason).
  //
  // Post-fix the runner emits delta-only windows as `agent.text`, which the
  // collapse path concatenates without ambiguity. These tests pin that
  // contract from the frontend side so a future regression of the runner
  // semantics is caught here too.
  // ---------------------------------------------------------------------------
  it("concatenates consecutive agent.text events from successive coalescer flushes (regression: opencode UX fragmenting)", () => {
    const events: SessionEventRecord[] = [
      makeSessionEvent({
        id: "evt-frag-1",
        agentJobId: "job-opencode-fragmenting",
        sequenceNum: 1,
        kind: "agent.text",
        payload: { content: "Loading skill " },
        createdAt: "2026-04-30T15:40:00.000Z",
        provider: "zipu",
      }),
      makeSessionEvent({
        id: "evt-frag-2",
        agentJobId: "job-opencode-fragmenting",
        sequenceNum: 2,
        kind: "agent.text",
        payload: { content: "(+more+iog+test). " },
        createdAt: "2026-04-30T15:40:01.000Z",
        provider: "zipu",
      }),
      makeSessionEvent({
        id: "evt-frag-3",
        agentJobId: "job-opencode-fragmenting",
        sequenceNum: 3,
        kind: "agent.text",
        payload: {
          content:
            "13/13: Retrying other tests with longer timeout...",
        },
        createdAt: "2026-04-30T15:40:02.000Z",
        provider: "zipu",
      }),
    ];

    const result = buildSessionDisplayChunks([], events, "zipu");
    const textChunks = result.filter(
      (chunk) =>
        chunk.contentType === "text" &&
        (chunk.eventType === "agent.text" ||
          chunk.eventType === "agent.text.complete"),
    );

    expect(textChunks).toHaveLength(1);
    expect(textChunks[0]?.message).toBe(
      "Loading skill (+more+iog+test). 13/13: Retrying other tests with longer timeout...",
    );
  });

  it("does not collapse text deltas across an interleaved tool_call boundary", () => {
    const events: SessionEventRecord[] = [
      makeSessionEvent({
        id: "evt-text-a",
        agentJobId: "job-mixed",
        sequenceNum: 1,
        kind: "agent.text",
        payload: { content: "before " },
        createdAt: "2026-04-08T11:01:00.000Z",
        provider: "zipu",
      }),
      makeSessionEvent({
        id: "evt-text-b",
        agentJobId: "job-mixed",
        sequenceNum: 2,
        kind: "agent.text",
        payload: { content: "tool " },
        createdAt: "2026-04-08T11:01:01.000Z",
        provider: "zipu",
      }),
      makeSessionEvent({
        id: "evt-tool",
        agentJobId: "job-mixed",
        sequenceNum: 3,
        kind: "agent.tool_call.start",
        payload: {
          toolName: "Read",
          toolCallId: "call-1",
          inputPreview: "/some/file.ts",
        },
        createdAt: "2026-04-08T11:01:02.000Z",
        provider: "zipu",
      }),
      makeSessionEvent({
        id: "evt-text-c",
        agentJobId: "job-mixed",
        sequenceNum: 4,
        kind: "agent.text",
        payload: { content: "after" },
        createdAt: "2026-04-08T11:01:03.000Z",
        provider: "zipu",
      }),
    ];

    const result = buildSessionDisplayChunks([], events, "zipu");

    const textChunks = result.filter(
      (chunk) =>
        chunk.contentType === "text" &&
        (chunk.eventType === "agent.text" || chunk.eventType === "agent.text.complete"),
    );
    expect(textChunks.length).toBe(2);
    expect(textChunks[0]?.message).toBe("before tool ");
    expect(textChunks[1]?.message).toBe("after");
  });

  it("keeps text and thinking as separate chunks when they run contiguously", () => {
    const events: SessionEventRecord[] = [
      makeSessionEvent({
        id: "evt-thinking-1",
        agentJobId: "job-mixed-kind",
        sequenceNum: 1,
        kind: "agent.thinking",
        payload: { content: "Let me " },
        createdAt: "2026-04-08T11:01:00.000Z",
        provider: "zipu",
      }),
      makeSessionEvent({
        id: "evt-thinking-2",
        agentJobId: "job-mixed-kind",
        sequenceNum: 2,
        kind: "agent.thinking",
        payload: { content: "review the file." },
        createdAt: "2026-04-08T11:01:01.000Z",
        provider: "zipu",
      }),
      makeSessionEvent({
        id: "evt-text-1",
        agentJobId: "job-mixed-kind",
        sequenceNum: 3,
        kind: "agent.text",
        payload: { content: "Sure, " },
        createdAt: "2026-04-08T11:01:02.000Z",
        provider: "zipu",
      }),
      makeSessionEvent({
        id: "evt-text-2",
        agentJobId: "job-mixed-kind",
        sequenceNum: 4,
        kind: "agent.text",
        payload: { content: "I will help." },
        createdAt: "2026-04-08T11:01:03.000Z",
        provider: "zipu",
      }),
    ];

    const result = buildSessionDisplayChunks([], events, "zipu");

    const thinkingChunks = result.filter(
      (chunk) =>
        chunk.contentType === "thinking" && chunk.eventType === "agent.thinking",
    );
    const textChunks = result.filter(
      (chunk) =>
        chunk.contentType === "text" &&
        (chunk.eventType === "agent.text" || chunk.eventType === "agent.text.complete"),
    );

    expect(thinkingChunks.length).toBe(1);
    expect(thinkingChunks[0]?.message).toBe("Let me review the file.");
    expect(textChunks.length).toBe(1);
    expect(textChunks[0]?.message).toBe("Sure, I will help.");
  });

  it("mapea agent.summary canónico a un chunk transcript con payload text+section", () => {
    const result = buildSessionDisplayChunks(
      [],
      [
        makeSessionEvent({
          id: "evt-summary-en",
          agentJobId: "job-summary",
          sequenceNum: 50,
          kind: "agent.summary",
          payload: {
            text: "- Implementé el evento canónico\n- Cableé render frontend",
            section: "Summary",
          },
          createdAt: "2026-04-30T10:00:00.000Z",
        }),
      ],
      "claude-code",
    );

    const summaryChunk = result.find(
      (chunk) => chunk.eventType === "agent.summary",
    );
    expect(summaryChunk).toBeDefined();
    expect(summaryChunk?.phase).toBe("transcript");
    expect(summaryChunk?.payload?.text).toBe(
      "- Implementé el evento canónico\n- Cableé render frontend",
    );
    expect(summaryChunk?.payload?.section).toBe("Summary");
  });

  it("renderiza badges de subagente con check + tarjeta de summary cuando llegan los eventos canónicos esperados (regresión post-60aa854)", () => {
    const events: SessionEventRecord[] = [
      makeSessionEvent({
        id: "evt-text-intro",
        agentJobId: "job-claude-code",
        sequenceNum: 1,
        kind: "agent.text",
        payload: { content: "Voy a delegar la búsqueda a un subagente." },
        provider: "claude-code",
        createdAt: "2026-04-30T10:00:00.000Z",
      }),
      makeSessionEvent({
        id: "evt-spawn",
        agentJobId: "job-claude-code",
        sequenceNum: 2,
        kind: "agent.subagent.spawn",
        payload: {
          subagentId: "tool-use-1",
          description: "Find regression cause",
          subagentType: "code-explorer",
          isBackground: false,
        },
        provider: "claude-code",
        createdAt: "2026-04-30T10:00:01.000Z",
      }),
      makeSessionEvent({
        id: "evt-complete",
        agentJobId: "job-claude-code",
        sequenceNum: 3,
        kind: "agent.subagent.complete",
        payload: { subagentId: "tool-use-1", success: true },
        provider: "claude-code",
        createdAt: "2026-04-30T10:00:30.000Z",
      }),
      makeSessionEvent({
        id: "evt-summary",
        agentJobId: "job-claude-code",
        sequenceNum: 4,
        kind: "agent.summary",
        payload: {
          text: "- Cambié X\n- Añadí tests",
          section: "Summary",
        },
        provider: "claude-code",
        createdAt: "2026-04-30T10:00:35.000Z",
      }),
    ];

    const chunks = buildSessionDisplayChunks([], events, "claude-code");
    const blocks = parseChunksToStreamingBlocks(chunks, false);

    const subagentBlock = blocks.find((block) => block.type === "subagent");
    expect(subagentBlock).toBeDefined();
    if (subagentBlock?.type === "subagent") {
      expect(subagentBlock.description).toBe("Find regression cause");
      expect(subagentBlock.subagentType).toBe("code-explorer");
      expect(subagentBlock.status).toBe("done");
    }

    const summaryBlock = blocks.find((block) => block.type === "summary");
    expect(summaryBlock).toBeDefined();
    if (summaryBlock?.type === "summary") {
      expect(summaryBlock.section).toBe("Summary");
      expect(summaryBlock.text).toContain("- Cambié X");
      expect(summaryBlock.text).toContain("- Añadí tests");
    }

    // Order: subagent badge appears before final summary card.
    const subagentIndex = blocks.findIndex((block) => block.type === "subagent");
    const summaryIndex = blocks.findIndex((block) => block.type === "summary");
    expect(subagentIndex).toBeGreaterThanOrEqual(0);
    expect(summaryIndex).toBeGreaterThan(subagentIndex);
  });

  it("strips standalone backtick text fragments before assistant text blocks", () => {
    const chunks = buildSessionDisplayChunks(
      [],
      [
        makeSessionEvent({
          id: "evt-thinking",
          agentJobId: "job-backtick",
          sequenceNum: 1,
          kind: "agent.thinking",
          payload: {
            content: "I should resolve context first.",
          },
          createdAt: "2026-04-08T11:01:00.000Z",
        }),
        makeSessionEvent({
          id: "evt-text",
          agentJobId: "job-backtick",
          sequenceNum: 2,
          kind: "agent.text.complete",
          payload: {
            fullText:
              "`\n\nVoy a resolver el contexto para la épica ZC-E-10.",
          },
          createdAt: "2026-04-08T11:01:01.000Z",
        }),
      ],
      "zipu",
    );

    const blocks = parseChunksToStreamingBlocks(chunks, false);
    const textBlock = blocks.find((block) => block.type === "text");

    expect(textBlock).toEqual({
      type: "text",
      content: "Voy a resolver el contexto para la épica ZC-E-10.",
    });
    expect(
      blocks.some((block) => block.type === "text" && block.content.includes("`")),
    ).toBe(false);
  });
});

describe("chunksToConversationMessages", () => {
  it("extracts the user-visible portion of a skill-injected prompt", () => {
    const chunks: AgentLogChunk[] = [
      makeChunk({
        id: "prompt",
        seq: 1,
        phase: "session",
        eventType: "prompt.sent",
        message:
          'IMPORTANT: You MUST respond in English.\n\n<skill name="ideate">\ninternal skill instructions\n</skill>\n\n<previous_conversation>\nUser: earlier question\n\nAssistant: earlier answer\n</previous_conversation>\n\nNecesito investigar por que el prompt no llega completo.',
        payload: {
          prompt:
            'IMPORTANT: You MUST respond in English.\n\n<skill name="ideate">\ninternal skill instructions\n</skill>\n\n<previous_conversation>\nUser: earlier question\n\nAssistant: earlier answer\n</previous_conversation>\n\nNecesito investigar por que el prompt no llega completo.',
        },
        timestamp: "2026-04-08T11:01:19.000Z",
      }),
      makeChunk({
        id: "assistant",
        seq: 2,
        phase: "transcript",
        eventType: "agent.text.complete",
        message: "Using runner-implement for A-F-398.",
        contentType: "text",
        timestamp: "2026-04-08T11:01:21.000Z",
      }),
    ];

    const messages = chunksToConversationMessages(chunks);

    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe("user");
    expect(messages[0]?.content).toBe(
      "Necesito investigar por que el prompt no llega completo.",
    );
    expect(messages[1]?.role).toBe("assistant");
    expect(messages[1]?.content).toContain("Using runner-implement");
  });

  it("strips dangling backtick boundary lines from assistant messages", () => {
    const messages = chunksToConversationMessages([
      makeChunk({
        id: "assistant",
        seq: 1,
        phase: "transcript",
        eventType: "agent.text.complete",
        message: "`\n\nEncontradas 3 tareas pendientes.",
        contentType: "text",
        timestamp: "2026-04-08T11:01:21.000Z",
      }),
    ]);

    expect(messages).toHaveLength(1);
    expect(messages[0]?.content).toBe("Encontradas 3 tareas pendientes.");
  });
});
