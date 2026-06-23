import type { CanonicalEvent } from "@almirant/stream-consumer";
import type { SseEvent } from "../../src/session/adapter-types";

type RuntimeFixture = {
  runtime: "claude" | "codex" | "opencode";
  expectedSummary: string;
  sseEvents: SseEvent[];
  expectedCanonicalEvents: Array<Partial<CanonicalEvent>>;
};

const createEvent = (type: string, properties: Record<string, unknown>): SseEvent => ({
  data: JSON.stringify({ type, properties }),
});

const createCanonicalPassthrough = (
  kind: CanonicalEvent["kind"],
  properties: Record<string, unknown>,
): SseEvent => ({
  data: JSON.stringify({
    type: kind,
    properties: {
      kind,
      ...properties,
    },
  }),
});

export const runtimeEventFixtures: RuntimeFixture[] = [
  {
    runtime: "claude",
    expectedSummary:
      'Hola desde Claude{"name":"Read","id":"claude-read-1","input":{"file_path":"/workspace/repo/CLAUDE.md"}}\nResumen listo',
    sseEvents: [
      createEvent("message.part.delta", {
        partType: "text",
        delta: "Hola desde Claude",
      }),
      createEvent("message.part.delta", {
        partType: "tool_use",
        delta: JSON.stringify({
          name: "Read",
          id: "claude-read-1",
          input: {
            file_path: "/workspace/repo/CLAUDE.md",
          },
        }),
      }),
      createEvent("message.part.delta", {
        partType: "text",
        delta: "\nResumen listo",
      }),
      createEvent("session.idle", {}),
    ],
    expectedCanonicalEvents: [
      { kind: "agent.text", content: "Hola desde Claude" },
      {
        kind: "agent.tool_call.start",
        toolName: "Read",
        toolCallId: "claude-read-1",
      },
      {
        kind: "agent.tool_call.start",
        toolName: "Read",
        toolCallId: "claude-read-1",
      },
      {
        kind: "agent.file.read",
        toolCallId: "claude-read-1",
        filePath: "/workspace/repo/CLAUDE.md",
      },
      {
        kind: "agent.tool_call.result",
        toolCallId: "claude-read-1",
        toolName: "Read",
        success: true,
      },
      { kind: "agent.text", content: "\nResumen listo" },
      { kind: "session.idle", hasBackgroundAgents: false, isPlanningJob: false },
    ],
  },
  {
    runtime: "codex",
    expectedSummary: "Codex responde",
    sseEvents: [
      createEvent("question.asked", {
        text: "Selecciona runtime",
        options: [
          { label: "Codex", description: "Usar CLI nativo" },
          "OpenCode",
        ],
      }),
      createEvent("message.part.delta", {
        contentType: "thinking",
        delta: "Comparando opciones",
      }),
      createEvent("message.part.delta", {
        contentType: "text",
        delta: "Codex responde",
      }),
      createEvent("session.idle", {}),
    ],
    expectedCanonicalEvents: [
      {
        kind: "agent.question",
        questionText: "Selecciona runtime",
        options: ["Codex::Usar CLI nativo", "OpenCode"],
        questionType: "single_choice",
      },
      { kind: "agent.thinking", content: "Comparando opciones" },
      { kind: "agent.text", content: "Codex responde" },
      { kind: "session.idle", hasBackgroundAgents: false, isPlanningJob: false },
    ],
  },
  {
    runtime: "opencode",
    expectedSummary: "completed",
    sseEvents: [
      createCanonicalPassthrough("agent.subagent.spawn", {
        subagentId: "opencode-task-1",
        description: "Analizar runtime",
        isBackground: false,
        subagentType: "javascript-pro",
      }),
      createCanonicalPassthrough("agent.text", {
        content: "OpenCode listo",
      }),
      createCanonicalPassthrough("agent.subagent.complete", {
        subagentId: "opencode-task-1",
        success: true,
      }),
      createCanonicalPassthrough("session.idle", {
        hasBackgroundAgents: false,
        isPlanningJob: false,
      }),
    ],
    expectedCanonicalEvents: [
      {
        kind: "agent.subagent.spawn",
        subagentId: "opencode-task-1",
        description: "Analizar runtime",
        isBackground: false,
        subagentType: "javascript-pro",
      },
      { kind: "agent.text", content: "OpenCode listo" },
      {
        kind: "agent.subagent.complete",
        subagentId: "opencode-task-1",
        success: true,
      },
      { kind: "session.idle", hasBackgroundAgents: false, isPlanningJob: false },
    ],
  },
];
