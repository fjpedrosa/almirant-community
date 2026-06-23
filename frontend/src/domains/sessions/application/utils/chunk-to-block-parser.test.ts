import { describe, expect, it } from "bun:test";
import type { AgentLogChunk } from "@/domains/shared/domain/types";
import { parseChunksToStreamingBlocks } from "./chunk-to-block-parser";

const makeChunk = (
  overrides: Partial<AgentLogChunk> & Pick<AgentLogChunk, "id" | "seq" | "phase" | "eventType" | "message" | "timestamp">,
): AgentLogChunk => ({
  level: "info",
  ...overrides,
});

describe("parseChunksToStreamingBlocks shared shell presentation", () => {
  it("no muestra un reconnect falso durante el arranque inicial de la sesion", () => {
    const blocks = parseChunksToStreamingBlocks(
      [
        makeChunk({
          id: "session-created",
          seq: 1,
          phase: "session",
          eventType: "session.created",
          message: "",
          timestamp: "2026-04-14T12:00:00.000Z",
        }),
        makeChunk({
          id: "session-connected",
          seq: 2,
          phase: "session",
          eventType: "session.connected",
          message: "",
          timestamp: "2026-04-14T12:00:01.000Z",
        }),
      ],
      false,
    );

    expect(blocks).toHaveLength(0);
  });

  it("muestra reconnect solo despues de una interrupcion real de la sesion", () => {
    const blocks = parseChunksToStreamingBlocks(
      [
        makeChunk({
          id: "session-created",
          seq: 1,
          phase: "session",
          eventType: "session.created",
          message: "",
          timestamp: "2026-04-14T12:00:00.000Z",
        }),
        makeChunk({
          id: "session-connected-initial",
          seq: 2,
          phase: "session",
          eventType: "session.connected",
          message: "",
          timestamp: "2026-04-14T12:00:01.000Z",
        }),
        makeChunk({
          id: "session-closed",
          seq: 3,
          phase: "session",
          eventType: "session.closed",
          message: "",
          timestamp: "2026-04-14T12:00:05.000Z",
        }),
        makeChunk({
          id: "session-connected-retry",
          seq: 4,
          phase: "session",
          eventType: "session.connected",
          message: "",
          timestamp: "2026-04-14T12:00:07.000Z",
        }),
      ],
      false,
    );

    expect(blocks).toEqual([
      {
        type: "session-reconnect",
        timestamp: "2026-04-14T12:00:07.000Z",
      },
    ]);
  });

  it("maps git bash commands to Git tool calls across providers", () => {
    const blocks = parseChunksToStreamingBlocks(
      [
        makeChunk({
          id: "tool-use-git",
          seq: 1,
          phase: "transcript",
          eventType: "tool_use",
          message: "/bin/bash -lc 'git status --short'",
          contentType: "tool_use",
          payload: {
            toolName: "Bash",
            toolCallId: "git-1",
            inputPreview: "/bin/bash -lc 'git status --short'",
          },
          timestamp: "2026-04-12T12:00:00.000Z",
        }),
        makeChunk({
          id: "bash-git-exec",
          seq: 2,
          phase: "transcript",
          eventType: "agent.bash.execute",
          message: "/bin/bash -lc 'git status --short'",
          payload: {
            toolCallId: "git-1",
            command: "/bin/bash -lc 'git status --short'",
          },
          timestamp: "2026-04-12T12:00:01.000Z",
        }),
        makeChunk({
          id: "bash-git-output",
          seq: 3,
          phase: "transcript",
          eventType: "agent.bash.output",
          message: " M frontend/src/example.ts",
          payload: {
            toolCallId: "git-1",
            output: " M frontend/src/example.ts",
          },
          timestamp: "2026-04-12T12:00:02.000Z",
        }),
      ],
      false,
    );

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      type: "tool_call",
      toolName: "Git",
      toolCallId: "git-1",
      status: "success",
      inputPreview: "Status",
    });
  });

  it("maps GitHub CLI bash commands to GitHub tool calls", () => {
    const blocks = parseChunksToStreamingBlocks(
      [
        makeChunk({
          id: "bash-gh-exec",
          seq: 1,
          phase: "transcript",
          eventType: "agent.bash.execute",
          message: "/bin/bash -lc 'gh pr create --base main --head branch'",
          payload: {
            toolCallId: "gh-1",
            command: "/bin/bash -lc 'gh pr create --base main --head branch'",
          },
          timestamp: "2026-04-12T12:10:00.000Z",
        }),
      ],
      false,
    );

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      type: "tool_call",
      toolName: "GitHub",
      toolCallId: "gh-1",
      status: "success",
      inputPreview: "Create PR",
    });
  });

  it("maps quoted GitHub CLI shell wrappers to GitHub tool calls", () => {
    const quotedCommand = `/bin/bash -lc 'gh pr create --base main --head branch --body $'"'body'"''`;
    const blocks = parseChunksToStreamingBlocks(
      [
        makeChunk({
          id: "bash-gh-quoted-exec",
          seq: 1,
          phase: "transcript",
          eventType: "agent.bash.execute",
          message: quotedCommand,
          payload: {
            toolCallId: "gh-quoted-1",
            command: quotedCommand,
          },
          timestamp: "2026-04-12T12:20:00.000Z",
        }),
      ],
      false,
    );

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      type: "tool_call",
      toolName: "GitHub",
      toolCallId: "gh-quoted-1",
      status: "success",
      inputPreview: "Create PR",
    });
  });

  it("maps environment grep commands to Env tool calls", () => {
    const blocks = parseChunksToStreamingBlocks(
      [
        makeChunk({
          id: "bash-env-exec",
          seq: 1,
          phase: "transcript",
          eventType: "agent.bash.execute",
          message: "/bin/bash -lc \"env | grep -E '^(GH|GITHUB)_'\"",
          payload: {
            toolCallId: "env-1",
            command: "/bin/bash -lc \"env | grep -E '^(GH|GITHUB)_'\"",
          },
          timestamp: "2026-04-12T12:30:00.000Z",
        }),
      ],
      false,
    );

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      type: "tool_call",
      toolName: "Env",
      toolCallId: "env-1",
      status: "success",
      inputPreview: "GitHub variables",
    });
  });

  it("maps environment echo commands and date commands to compact tool calls", () => {
    const blocks = parseChunksToStreamingBlocks(
      [
        makeChunk({
          id: "bash-env-echo",
          seq: 1,
          phase: "transcript",
          eventType: "agent.bash.execute",
          message:
            'echo "ALMIRANT_PROVIDER=$ALMIRANT_PROVIDER" && echo "ALMIRANT_PR_URL=$ALMIRANT_PR_URL"',
          payload: {
            toolCallId: "env-echo-1",
            command:
              'echo "ALMIRANT_PROVIDER=$ALMIRANT_PROVIDER" && echo "ALMIRANT_PR_URL=$ALMIRANT_PR_URL"',
          },
          timestamp: "2026-04-12T12:35:00.000Z",
        }),
        makeChunk({
          id: "bash-date",
          seq: 2,
          phase: "transcript",
          eventType: "agent.bash.execute",
          message: 'date -u +"%Y-%m-%dT%H:%M:%SZ"',
          payload: {
            toolCallId: "date-1",
            command: 'date -u +"%Y-%m-%dT%H:%M:%SZ"',
          },
          timestamp: "2026-04-12T12:36:00.000Z",
        }),
      ],
      false,
    );

    expect(blocks).toEqual([
      {
        type: "tool_call",
        toolName: "Env",
        toolCallId: "env-echo-1",
        status: "success",
        inputPreview: "Almirant variables",
      },
      {
        type: "tool_call",
        toolName: "Date",
        toolCallId: "date-1",
        status: "success",
        inputPreview: "UTC time",
      },
    ]);
  });

  it("maps bun validation commands to dedicated pseudo-tools", () => {
    const blocks = parseChunksToStreamingBlocks(
      [
        makeChunk({
          id: "bash-install",
          seq: 1,
          phase: "transcript",
          eventType: "agent.bash.execute",
          message: "/bin/bash -lc 'bun install'",
          payload: {
            toolCallId: "install-1",
            command: "/bin/bash -lc 'bun install'",
          },
          timestamp: "2026-04-12T12:40:00.000Z",
        }),
        makeChunk({
          id: "bash-test",
          seq: 2,
          phase: "transcript",
          eventType: "agent.bash.execute",
          message:
            "/bin/bash -lc 'bun test frontend/src/domains/planning/application/hooks/use-planning-session-reducer.test.ts'",
          payload: {
            toolCallId: "test-1",
            command:
              "/bin/bash -lc 'bun test frontend/src/domains/planning/application/hooks/use-planning-session-reducer.test.ts'",
          },
          timestamp: "2026-04-12T12:41:00.000Z",
        }),
        makeChunk({
          id: "bash-typecheck",
          seq: 3,
          phase: "transcript",
          eventType: "agent.bash.execute",
          message: "/bin/bash -lc 'bun run type-check'",
          payload: {
            toolCallId: "typecheck-1",
            command: "/bin/bash -lc 'bun run type-check'",
          },
          timestamp: "2026-04-12T12:42:00.000Z",
        }),
        makeChunk({
          id: "bash-lint",
          seq: 4,
          phase: "transcript",
          eventType: "agent.bash.execute",
          message:
            "/bin/bash -lc 'bunx eslint frontend/src/domains/planning/application/hooks/use-planning-session.ts frontend/src/domains/planning/application/hooks/use-planning-session-reducer.test.ts'",
          payload: {
            toolCallId: "lint-1",
            command:
              "/bin/bash -lc 'bunx eslint frontend/src/domains/planning/application/hooks/use-planning-session.ts frontend/src/domains/planning/application/hooks/use-planning-session-reducer.test.ts'",
          },
          timestamp: "2026-04-12T12:43:00.000Z",
        }),
        makeChunk({
          id: "bash-local-eslint",
          seq: 5,
          phase: "transcript",
          eventType: "agent.bash.execute",
          message:
            "./node_modules/.bin/eslint src/lib/research/ 2>&1 | tail -20",
          payload: {
            toolCallId: "lint-2",
            command:
              "./node_modules/.bin/eslint src/lib/research/ 2>&1 | tail -20",
          },
          timestamp: "2026-04-12T12:44:00.000Z",
        }),
      ],
      false,
    );

    expect(blocks).toEqual([
      {
        type: "tool_call",
        toolName: "Install",
        toolCallId: "install-1",
        status: "success",
        inputPreview: "Dependencies",
      },
      {
        type: "tool_call",
        toolName: "Test",
        toolCallId: "test-1",
        status: "success",
        inputPreview:
          "frontend/src/domains/planning/application/hooks/use-planning-session-reducer.test.ts",
      },
      {
        type: "tool_call",
        toolName: "TypeCheck",
        toolCallId: "typecheck-1",
        status: "success",
        inputPreview: "Project",
      },
      {
        type: "tool_call",
        toolName: "Lint",
        toolCallId: "lint-1",
        status: "success",
        inputPreview: "2 files",
      },
      {
        type: "tool_call",
        toolName: "Lint",
        toolCallId: "lint-2",
        status: "success",
        inputPreview: "src/lib/research/",
      },
    ]);
  });

  it("maps Codex bunx tsx test commands to Test tool calls", () => {
    const blocks = parseChunksToStreamingBlocks(
      [
        makeChunk({
          id: "bash-bunx-tsx-test",
          seq: 1,
          phase: "transcript",
          eventType: "agent.bash.execute",
          message: "bun x tsx --test tests/db/types/vector.test.ts",
          payload: {
            toolCallId: "test-tsx-1",
            command: "bun x tsx --test tests/db/types/vector.test.ts",
          },
          timestamp: "2026-05-02T19:35:00.000Z",
        }),
      ],
      false,
    );

    expect(blocks).toEqual([
      {
        type: "tool_call",
        toolName: "Test",
        toolCallId: "test-tsx-1",
        status: "success",
        inputPreview: "tests/db/types/vector.test.ts",
      },
    ]);
  });

  it("maps shell path existence checks to Read tool calls instead of raw bash", () => {
    const blocks = parseChunksToStreamingBlocks(
      [
        makeChunk({
          id: "bash-test-node-modules",
          seq: 1,
          phase: "transcript",
          eventType: "agent.bash.execute",
          message: 'test -d node_modules; echo "node_modules=$?"',
          payload: {
            toolCallId: "path-check-1",
            command: 'test -d node_modules; echo "node_modules=$?"',
          },
          timestamp: "2026-05-02T19:36:00.000Z",
        }),
      ],
      false,
    );

    expect(blocks).toEqual([
      {
        type: "tool_call",
        toolName: "Read",
        toolCallId: "path-check-1",
        status: "success",
        inputPreview: "node_modules",
      },
    ]);
  });

  it("maps ls inspection commands to Read tool calls", () => {
    const blocks = parseChunksToStreamingBlocks(
      [
        makeChunk({
          id: "bash-ls-file",
          seq: 1,
          phase: "transcript",
          eventType: "agent.bash.execute",
          message: "ls /workspace/repo/package.json",
          payload: {
            toolCallId: "ls-file-1",
            command: "ls /workspace/repo/package.json",
          },
          timestamp: "2026-04-12T12:45:00.000Z",
        }),
        makeChunk({
          id: "bash-ls-dir",
          seq: 2,
          phase: "transcript",
          eventType: "agent.bash.execute",
          message:
            "ls -la /workspace/repo/src/lib/research/ 2>/dev/null || echo \"Directory does not exist\"",
          payload: {
            toolCallId: "ls-dir-1",
            command:
              "ls -la /workspace/repo/src/lib/research/ 2>/dev/null || echo \"Directory does not exist\"",
          },
          timestamp: "2026-04-12T12:46:00.000Z",
        }),
      ],
      false,
    );

    expect(blocks).toEqual([
      {
        type: "tool_call",
        toolName: "Read",
        toolCallId: "ls-file-1",
        status: "success",
        inputPreview: "/workspace/repo/package.json",
      },
      {
        type: "tool_call",
        toolName: "Read",
        toolCallId: "ls-dir-1",
        status: "success",
        inputPreview: "/workspace/repo/src/lib/research/",
      },
    ]);
  });

  it("maps numbered file inspection commands to Read tool calls", () => {
    const blocks = parseChunksToStreamingBlocks(
      [
        makeChunk({
          id: "bash-nl-file",
          seq: 1,
          phase: "transcript",
          eventType: "agent.bash.execute",
          message:
            "nl -ba frontend/src/domains/sessions/presentation/components/session-transcript.tsx | sed -n '1,220p'",
          payload: {
            toolCallId: "nl-file-1",
            command:
              "nl -ba frontend/src/domains/sessions/presentation/components/session-transcript.tsx | sed -n '1,220p'",
          },
          timestamp: "2026-04-12T12:47:00.000Z",
        }),
      ],
      false,
    );

    expect(blocks).toEqual([
      {
        type: "tool_call",
        toolName: "Read",
        toolCallId: "nl-file-1",
        status: "success",
        inputPreview:
          "frontend/src/domains/sessions/presentation/components/session-transcript.tsx",
      },
    ]);
  });

  it("maps shell file existence inspection commands with follow-up reads to Read tool calls", () => {
    const blocks = parseChunksToStreamingBlocks(
      [
        makeChunk({
          id: "bash-test-file",
          seq: 1,
          phase: "transcript",
          eventType: "agent.bash.execute",
          message: "test -f ../package.json && sed -n '1,220p' ../package.json",
          payload: {
            toolCallId: "test-file-1",
            command: "test -f ../package.json && sed -n '1,220p' ../package.json",
          },
          timestamp: "2026-04-12T12:49:00.000Z",
        }),
      ],
      false,
    );

    expect(blocks).toEqual([
      {
        type: "tool_call",
        toolName: "Read",
        toolCallId: "test-file-1",
        status: "success",
        inputPreview: "../package.json",
      },
    ]);
  });

  it("hides anonymous mcp_tool calls that have no preview or metadata", () => {
    const blocks = parseChunksToStreamingBlocks(
      [
        makeChunk({
          id: "mcp-anon",
          seq: 1,
          phase: "transcript",
          eventType: "tool_use",
          message: "",
          contentType: "tool_use",
          payload: {
            toolName: "mcp_tool",
            toolCallId: "mcp-1",
          },
          timestamp: "2026-04-12T12:50:00.000Z",
        }),
      ],
      false,
    );

    expect(blocks).toHaveLength(0);
  });

  it("hides raw Bash tool_use placeholders when no shell command is available", () => {
    const blocks = parseChunksToStreamingBlocks(
      [
        makeChunk({
          id: "bash-placeholder",
          seq: 1,
          phase: "transcript",
          eventType: "tool_use",
          message: JSON.stringify({
            name: "Bash",
            id: "bash-placeholder-1",
          }),
          contentType: "tool_use",
          timestamp: "2026-04-12T12:50:30.000Z",
        }),
      ],
      false,
    );

    expect(blocks).toHaveLength(0);
  });

  it("hides legacy Codex todo_list text markers", () => {
    const blocks = parseChunksToStreamingBlocks(
      [
        makeChunk({
          id: "todo-list-marker",
          seq: 1,
          phase: "transcript",
          eventType: "agent.text",
          contentType: "text",
          message: "[todo_list]",
          timestamp: "2026-05-02T19:37:00.000Z",
        }),
      ],
      false,
    );

    expect(blocks).toHaveLength(0);
  });

  it("normalizes Claude Code generic MCP tool calls for Almirant actions", () => {
    const blocks = parseChunksToStreamingBlocks(
      [
        makeChunk({
          id: "claude-mcp-tool",
          seq: 1,
          phase: "transcript",
          eventType: "raw_output",
          message: JSON.stringify({
            name: "mcp_tool",
            id: "mcp-1",
            input: {
              server: "almirant",
              tool: "move_work_item",
              arguments: {
                taskId: "ZC-18",
                column: "In Progress",
              },
            },
          }),
          contentType: "tool_use",
          timestamp: "2026-04-28T18:40:00.000Z",
        }),
      ],
      true,
    );

    expect(blocks).toEqual([
      {
        type: "tool_call",
        toolName: "mcp__almirant__move_work_item",
        toolCallId: "mcp-1",
        status: "success",
        inputPreview: "taskId: ZC-18",
      },
    ]);
  });

  it("maps Bash JSON-RPC MCP tool calls to MCP tool blocks", () => {
    const staleIds = [
      "3863627d-7087-4a91-bc98-ff104a016a3c",
      "bcb3194b-c0b5-47a3-bc9b-ff18e4e4551a",
      "bfb85f89-edc3-4d32-be9e-0b7c0060554f",
      "dd91f86c-f47e-4d15-9044-27b1e2ce0615",
      "ebdac043-a3e8-4ffa-ae00-21226ca881c0",
      "af9441f2-4d06-48b1-9dde-1617124191b8",
      "7f5841d4-5f87-4477-b564-2127f8259d91",
      "e11486d5-eec3-4486-958d-16370661c220",
      "27b3ea07-fa60-4950-8a0a-254af6361fd1",
    ];
    const command = `
MCP_URL=$(jq -r '.mcpServers.almirant.url' /workspace/repo/.mcp.json)
AUTH=$(jq -r '.mcpServers.almirant.headers.Authorization' /workspace/repo/.mcp.json)
STALE_IDS=${JSON.stringify(staleIds)}
curl -s -X POST "$MCP_URL" \\
  -H "Authorization: $AUTH" \\
  -H "Content-Type: application/json" \\
  -d "{\\"jsonrpc\\":\\"2.0\\",\\"id\\":6,\\"method\\":\\"tools/call\\",\\"params\\":{\\"name\\":\\"batch_move_work_items\\",\\"arguments\\":{\\"workItemIds\\":$STALE_IDS,\\"boardColumnId\\":\\"fc18d11a-52ee-4f42-b9aa-304480be9307\\",\\"setAiProcessing\\":true,\\"aiProvider\\":\\"zai\\"}}}"`;

    const blocks = parseChunksToStreamingBlocks(
      [
        makeChunk({
          id: "bash-mcp-call",
          seq: 1,
          phase: "transcript",
          eventType: "agent.bash.execute",
          message: command,
          payload: {
            toolCallId: "bash-mcp-1",
            command,
          },
          timestamp: "2026-04-28T18:50:00.000Z",
        }),
      ],
      false,
    );

    expect(blocks).toEqual([
      {
        type: "tool_call",
        toolName: "mcp__almirant__batch_move_work_items",
        toolCallId: "bash-mcp-1",
        status: "success",
        inputPreview: "9 items",
      },
    ]);
  });

  it("maps Bash JSON-RPC MCP schema checks to the inspected MCP tool", () => {
    const command = `
MCP_URL=$(jq -r '.mcpServers.almirant.url' /workspace/repo/.mcp.json)
AUTH=$(jq -r '.mcpServers.almirant.headers.Authorization' /workspace/repo/.mcp.json)
curl -s -X POST "$MCP_URL" \\
  -H "Authorization: $AUTH" \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | jq '.result.tools[] | select(.name == "batch_move_work_items") | .inputSchema'`;

    const blocks = parseChunksToStreamingBlocks(
      [
        makeChunk({
          id: "bash-mcp-schema",
          seq: 1,
          phase: "transcript",
          eventType: "agent.bash.execute",
          message: command,
          payload: {
            toolCallId: "bash-mcp-schema-1",
            command,
          },
          timestamp: "2026-04-28T18:51:00.000Z",
        }),
      ],
      false,
    );

    expect(blocks).toEqual([
      {
        type: "tool_call",
        toolName: "mcp__almirant__batch_move_work_items",
        toolCallId: "bash-mcp-schema-1",
        status: "success",
        inputPreview: "Schema",
      },
    ]);
  });

  it("maps Bash JSON-RPC MCP tools/list calls to MCP list tools blocks", () => {
    const command = `
MCP_URL=$(jq -r '.mcpServers.almirant.url' /workspace/repo/.mcp.json)
AUTH=$(jq -r '.mcpServers.almirant.headers.Authorization' /workspace/repo/.mcp.json)
curl -s -X POST "$MCP_URL" \\
  -H "Authorization: $AUTH" \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | jq -r '.result.tools[].name'`;

    const blocks = parseChunksToStreamingBlocks(
      [
        makeChunk({
          id: "bash-mcp-list",
          seq: 1,
          phase: "transcript",
          eventType: "agent.bash.execute",
          message: command,
          payload: {
            toolCallId: "bash-mcp-list-1",
            command,
          },
          timestamp: "2026-04-28T18:52:00.000Z",
        }),
      ],
      false,
    );

    expect(blocks).toEqual([
      {
        type: "tool_call",
        toolName: "mcp__almirant__list_tools",
        toolCallId: "bash-mcp-list-1",
        status: "success",
        inputPreview: "List tools",
      },
    ]);
  });

  it("marks background subagents as done from orchestrator progress text while the session is live", () => {
    const chunks: AgentLogChunk[] = [
      makeChunk({
        id: "zc-1-spawn",
        seq: 1,
        phase: "transcript",
        eventType: "subagent.spawn",
        message: "Implement ZC-1 YC adapter",
        payload: { subagentId: "agent-zc-1", isBackground: true },
        timestamp: "2026-04-28T17:40:00.000Z",
      }),
      makeChunk({
        id: "zc-3-spawn",
        seq: 2,
        phase: "transcript",
        eventType: "subagent.spawn",
        message: "Implement ZC-3 YC filters",
        payload: { subagentId: "agent-zc-3", isBackground: true },
        timestamp: "2026-04-28T17:40:01.000Z",
      }),
      makeChunk({
        id: "zc-4-spawn",
        seq: 3,
        phase: "transcript",
        eventType: "subagent.spawn",
        message: "Implement ZC-4 YC adapter tests",
        payload: { subagentId: "agent-zc-4", isBackground: true },
        timestamp: "2026-04-28T17:40:02.000Z",
      }),
      makeChunk({
        id: "zc-2-spawn",
        seq: 4,
        phase: "transcript",
        eventType: "subagent.spawn",
        message: "Implement ZC-2 taxonomy update",
        payload: { subagentId: "agent-zc-2", isBackground: true },
        timestamp: "2026-04-28T17:40:03.000Z",
      }),
      makeChunk({
        id: "zc-5-spawn",
        seq: 5,
        phase: "transcript",
        eventType: "subagent.spawn",
        message: "Implement ZC-5 ingest CLI script",
        payload: { subagentId: "agent-zc-5", isBackground: true },
        timestamp: "2026-04-28T17:40:04.000Z",
      }),
      makeChunk({
        id: "zc-3-done",
        seq: 6,
        phase: "transcript",
        eventType: "raw_output",
        contentType: "thinking",
        message: "ZC-3 agent completed successfully. Let me track this and wait for the other agents to complete.",
        timestamp: "2026-04-28T17:41:00.000Z",
      }),
      makeChunk({
        id: "zc-2-done",
        seq: 7,
        phase: "transcript",
        eventType: "raw_output",
        contentType: "thinking",
        message: "ZC-2 agent completed successfully. Now I'm waiting for ZC-1, ZC-4, and ZC-5.",
        timestamp: "2026-04-28T17:41:30.000Z",
      }),
      makeChunk({
        id: "zc-5-done",
        seq: 8,
        phase: "transcript",
        eventType: "raw_output",
        contentType: "thinking",
        message: "ZC-5 completed successfully. Now waiting for ZC-1 and ZC-4.",
        timestamp: "2026-04-28T17:42:00.000Z",
      }),
      makeChunk({
        id: "zc-1-done",
        seq: 9,
        phase: "transcript",
        eventType: "raw_output",
        contentType: "thinking",
        message: "ZC-1 completed successfully. Now only ZC-4 is left from sub-batch 1.",
        timestamp: "2026-04-28T17:42:30.000Z",
      }),
    ];

    const blocks = parseChunksToStreamingBlocks(chunks, true);
    const subagents = blocks.filter(
      (block): block is Extract<typeof block, { type: "subagent" }> =>
        block.type === "subagent",
    );

    expect(subagents).toHaveLength(5);
    expect(
      Object.fromEntries(
        subagents.map((subagent) => [subagent.description.match(/ZC-\d+/)?.[0], subagent.status]),
      ),
    ).toEqual({
      "ZC-1": "done",
      "ZC-2": "done",
      "ZC-3": "done",
      "ZC-4": "running",
      "ZC-5": "done",
    });
  });

  it("marks all background subagents in a completed TodoWrite sub-batch as done", () => {
    const todoWrite = JSON.stringify({
      name: "TodoWrite",
      id: "todo-1",
      input: {
        todos: [
          {
            activeForm: "Executing Wave 1 Sub-batch 1 (5 agents)",
            content: "Wave 1 Sub-batch 1: ZC-1, ZC-3, ZC-4, ZC-2, ZC-5",
            status: "completed",
          },
        ],
      },
    });

    const blocks = parseChunksToStreamingBlocks(
      [
        ...["ZC-1", "ZC-3", "ZC-4", "ZC-2", "ZC-5"].map((taskId, index) =>
          makeChunk({
            id: `${taskId}-spawn`,
            seq: index + 1,
            phase: "transcript",
            eventType: "subagent.spawn",
            message: `Implement ${taskId}`,
            payload: { subagentId: `agent-${taskId}`, isBackground: true },
            timestamp: "2026-04-28T17:40:00.000Z",
          }),
        ),
        makeChunk({
          id: "todo-completed",
          seq: 6,
          phase: "transcript",
          eventType: "raw_output",
          contentType: "tool_use",
          message: todoWrite,
          timestamp: "2026-04-28T17:43:00.000Z",
        }),
      ],
      true,
    );

    const subagents = blocks.filter(
      (block): block is Extract<typeof block, { type: "subagent" }> =>
        block.type === "subagent",
    );

    expect(subagents.every((subagent) => subagent.status === "done")).toBe(true);
  });

  it("does not infer remaining background agents from incomplete streaming text", () => {
    const blocks = parseChunksToStreamingBlocks(
      [
        ...["ZC-1", "ZC-4", "ZC-5"].map((taskId, index) =>
          makeChunk({
            id: `${taskId}-spawn`,
            seq: index + 1,
            phase: "transcript",
            eventType: "subagent.spawn",
            message: `Implement ${taskId}`,
            payload: { subagentId: `agent-${taskId}`, isBackground: true },
            timestamp: "2026-04-28T17:40:00.000Z",
          }),
        ),
        makeChunk({
          id: "partial-waiting-text",
          seq: 4,
          phase: "transcript",
          eventType: "raw_output",
          contentType: "thinking",
          message: "Now I'm waiting for ZC-1, ZC-4, and Z",
          timestamp: "2026-04-28T17:41:00.000Z",
        }),
      ],
      true,
    );

    const subagents = blocks.filter(
      (block): block is Extract<typeof block, { type: "subagent" }> =>
        block.type === "subagent",
    );

    expect(subagents.every((subagent) => subagent.status === "running")).toBe(true);
  });

  it("renders a single thinking block from a coalesced thinking chunk (opencode-style)", () => {
    const longThinking =
      "I should inspect the file. " +
      "Let me check the current implementation. ".repeat(50) +
      "Then plan the fix.";

    const blocks = parseChunksToStreamingBlocks(
      [
        makeChunk({
          id: "coalesced-thinking",
          seq: 1,
          phase: "transcript",
          eventType: "agent.thinking",
          contentType: "thinking",
          message: longThinking,
          timestamp: "2026-04-30T10:00:00.000Z",
        }),
      ],
      false,
    );

    const thinkingBlocks = blocks.filter(
      (block): block is Extract<typeof block, { type: "thinking" }> =>
        block.type === "thinking",
    );

    expect(thinkingBlocks).toHaveLength(1);
    expect(thinkingBlocks[0]?.content).toBe(longThinking);
  });

  it("emite un bloque summary cuando llega un chunk agent.summary", () => {
    const blocks = parseChunksToStreamingBlocks(
      [
        makeChunk({
          id: "summary-1",
          seq: 99,
          phase: "transcript",
          eventType: "agent.summary",
          message: "- A\n- B",
          payload: {
            text: "- A\n- B",
            section: "Summary",
          },
          timestamp: "2026-04-30T10:05:00.000Z",
        }),
      ],
      false,
    );

    const summaryBlocks = blocks.filter(
      (block): block is Extract<typeof block, { type: "summary" }> =>
        block.type === "summary",
    );
    expect(summaryBlocks).toHaveLength(1);
    expect(summaryBlocks[0]?.text).toBe("- A\n- B");
    expect(summaryBlocks[0]?.section).toBe("Summary");
  });

  it("acepta section Resumen cuando el bloque viene en español", () => {
    const blocks = parseChunksToStreamingBlocks(
      [
        makeChunk({
          id: "summary-es",
          seq: 5,
          phase: "transcript",
          eventType: "agent.summary",
          message: "Listo.",
          payload: {
            text: "Listo.",
            section: "Resumen",
          },
          timestamp: "2026-04-30T10:05:00.000Z",
        }),
      ],
      false,
    );

    const summaryBlock = blocks.find((block) => block.type === "summary");
    expect(summaryBlock).toBeDefined();
    if (summaryBlock?.type === "summary") {
      expect(summaryBlock.section).toBe("Resumen");
    }
  });

  it("evita duplicar un resumen final cuando llega como agent.text y agent.summary", () => {
    const chunks = [
      makeChunk({
        id: "summary-text-1",
        seq: 1,
        phase: "transcript",
        eventType: "agent.text",
        contentType: "text",
        message: "## Resumen de reparación DoD — F-E-4\n\n### Tareas reparadas (6/6)\n",
        timestamp: "2026-05-02T22:00:38.000Z",
      }),
      makeChunk({
        id: "summary-text-2",
        seq: 2,
        phase: "transcript",
        eventType: "agent.text",
        contentType: "text",
        message: "- F-51\n- F-52\n\n### PR\nBranch `almirant/F-E-4` — commit `d3e0150`.",
        timestamp: "2026-05-02T22:00:38.100Z",
      }),
      makeChunk({
        id: "summary-event",
        seq: 3,
        phase: "transcript",
        eventType: "agent.summary",
        message:
          "de reparación DoD — F-E-4\n\n### Tareas reparadas (6/6)\n- F-51\n- F-52\n\n### PR\nBranch `almirant/F-E-4` — commit `d3e0150`.",
        payload: {
          section: "Resumen",
          text:
            "de reparación DoD — F-E-4\n\n### Tareas reparadas (6/6)\n- F-51\n- F-52\n\n### PR\nBranch `almirant/F-E-4` — commit `d3e0150`.",
        },
        timestamp: "2026-05-02T22:00:38.200Z",
      }),
    ];

    const blocks = parseChunksToStreamingBlocks(chunks, false);

    expect(blocks.filter((block) => block.type === "text")).toHaveLength(0);
    const summaryBlocks = blocks.filter(
      (block): block is Extract<typeof block, { type: "summary" }> =>
        block.type === "summary",
    );
    expect(summaryBlocks).toHaveLength(1);
    expect(summaryBlocks[0]?.section).toBe("Resumen");
    expect(summaryBlocks[0]?.text).toContain("de reparación DoD — F-E-4");
  });
});
