import { beforeAll, describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { ConversationTimeline } from "./conversation-timeline";
import { humanizeInputPreview, parseMcpToolName } from "./streaming-blocks/tool-icon";
import type { ConversationMessage } from "../../domain/conversation-types";
import type { StreamingBlock } from "@/domains/shared/domain/streaming-block-types";

const renderTimeline = ({
  messages,
  completedTurnBlocks,
  timeZone,
}: {
  messages: ConversationMessage[];
  completedTurnBlocks?: StreamingBlock[][];
  timeZone?: string;
}) =>
  render(
    <ConversationTimeline
      messages={messages}
      completedTurnBlocks={completedTurnBlocks}
      isStreaming={false}
      timeZone={timeZone}
    />,
  );

beforeAll(() => {
  if (typeof globalThis.requestAnimationFrame === "undefined") {
    globalThis.requestAnimationFrame = (callback: FrameRequestCallback) =>
      setTimeout(() => callback(performance.now()), 0) as unknown as number;
  }
  if (typeof globalThis.cancelAnimationFrame === "undefined") {
    globalThis.cancelAnimationFrame = (id: number) => clearTimeout(id);
  }
});

describe("ConversationTimeline", () => {
  it("muestra la hora de recepción usando la zona horaria indicada", () => {
    renderTimeline({
      timeZone: "Europe/Madrid",
      messages: [
        {
          id: "assistant-1",
          role: "assistant",
          content: "Mensaje recibido",
          timestamp: "2026-04-28T18:05:00.000Z",
        },
      ],
    });

    expect(screen.getByText("20:05")).toBeInTheDocument();
  });

  it("usa Europe/Madrid como zona horaria por defecto del transcript", () => {
    renderTimeline({
      messages: [
        {
          id: "assistant-1",
          role: "assistant",
          content: "Mensaje recibido",
          timestamp: "2026-04-28T18:05:00.000Z",
        },
      ],
    });

    expect(screen.getByText("20:05")).toBeInTheDocument();
  });

  it("respeta el estado colapsado de los bloques de thinking en streaming", () => {
    render(
      <ConversationTimeline
        isStreaming
        messages={[]}
        streamingBlocks={[
          {
            type: "thinking",
            content: "Razonamiento interno visible solo al expandir",
          },
        ]}
        thinkingBlockIsCollapsed={() => true}
      />,
    );

    expect(screen.getByRole("button", { name: /Thinking/i })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("keeps rendering completed turn tool calls when historical tool messages already exist", () => {
    renderTimeline({
      messages: [
        {
          id: "user-1",
          role: "user",
          content: "¿Qué ha pasado?",
          messageType: "user",
        },
        {
          id: "tool-history",
          role: "assistant",
          content: "",
          messageType: "tool_call",
          metadata: {
            toolName: "Read",
            toolCallId: "tool-history",
            inputPreview: "history.ts",
          },
        },
      ],
      completedTurnBlocks: [
        [
          {
            type: "tool_call",
            toolName: "Grep",
            toolCallId: "tool-live",
            status: "success",
            inputPreview: "needle",
          },
        ],
      ],
    });

    expect(screen.getByText("history.ts")).toBeInTheDocument();
    expect(screen.getByText("needle")).toBeInTheDocument();
  });

  it("dedupes completed turn blocks that are already persisted in messages", () => {
    renderTimeline({
      messages: [
        {
          id: "tool-history",
          role: "assistant",
          content: "",
          messageType: "tool_call",
          metadata: {
            toolName: "Read",
            toolCallId: "tool-same",
            inputPreview: "history.ts",
          },
        },
      ],
      completedTurnBlocks: [
        [
          {
            type: "tool_call",
            toolName: "Read",
            toolCallId: "tool-same",
            status: "success",
            inputPreview: "history.ts",
          },
        ],
      ],
    });

    expect(screen.getAllByText("history.ts")).toHaveLength(1);
  });

  it("mantiene visibles los mensajes graduados del turno actual aunque siga llegando streaming", async () => {
    render(
      <ConversationTimeline
        isStreaming
        messages={[
          {
            id: "user-1",
            role: "user",
            content: "Planifica esto",
            messageType: "user",
          },
          {
            id: "grad-tool-1",
            role: "assistant",
            content: "",
            messageType: "tool_call",
            metadata: {
              fromLiveStreamingTurn: true,
              toolName: "Read",
              toolCallId: "grad-tool-1",
              inputPreview: "frontend/src/domains/planning/application/hooks/use-planning-session.ts",
            },
          },
          {
            id: "grad-text-1",
            role: "assistant",
            content: "Fase 0: análisis inicial",
            messageType: "stream",
            metadata: {
              fromLiveStreamingTurn: true,
            },
          },
        ]}
        streamingBlocks={[
          {
            type: "text",
            content: "Phase 1",
          },
        ]}
      />,
    );

    expect(
      screen.getByText(
        "frontend/src/domains/planning/application/hooks/use-planning-session.ts",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Fase 0: análisis inicial")).toBeInTheDocument();
    expect(await screen.findByText("Phase 1")).toBeInTheDocument();
  });

  it("renderiza la tool_call visible aunque la racha empiece con una herramienta oculta (Bash)", () => {
    renderTimeline({
      messages: [
        {
          id: "user-1",
          role: "user",
          content: "Haz algo",
          messageType: "user",
        },
        {
          id: "hidden-bash-1",
          role: "assistant",
          content: "",
          messageType: "tool_call",
          metadata: {
            toolName: "Bash",
            toolCallId: "hidden-bash-1",
            inputPreview: "echo oculto",
          },
        },
        {
          id: "visible-read-1",
          role: "assistant",
          content: "",
          messageType: "tool_call",
          metadata: {
            toolName: "Read",
            toolCallId: "visible-read-1",
            inputPreview: "src/visible.ts",
          },
        },
      ],
    });

    expect(screen.getByText("src/visible.ts")).toBeInTheDocument();
  });

  it("mantiene visibles los tool calls persistidos del turno actual mientras sigue el streaming", () => {
    render(
      <ConversationTimeline
        isStreaming
        messages={[
          {
            id: "user-1",
            role: "user",
            content: "Planifica esto",
            messageType: "user",
          },
          {
            id: "persisted-tool-1",
            role: "assistant",
            content: "",
            messageType: "tool_call",
            metadata: {
              toolName: "mcp__almirant__add_work_item_dependency",
              toolCallId: "persisted-tool-1",
              inputPreview:
                "{\"workItemId\":\"4c1c2b4c-884f-4add-9808-272fcde78f7e\"}",
            },
          },
        ]}
        streamingBlocks={[
          {
            type: "text",
            content: "Sigo procesando la planificación",
          },
        ]}
      />,
    );

    expect(screen.getByText("Almirant")).toBeInTheDocument();
    expect(screen.getByText("Add dependency")).toBeInTheDocument();
  });

  it("normaliza llamadas MCP directas de Almirant con servidor y acción separados", () => {
    renderTimeline({
      messages: [
        {
          id: "tool-almirant-direct",
          role: "assistant",
          content: "",
          messageType: "tool_call",
          metadata: {
            toolName: "almirant_get_current_user",
            toolCallId: "tool-almirant-direct",
          },
        },
      ],
    });

    expect(screen.getByText("Almirant")).toBeInTheDocument();
    expect(screen.getByText("Current user")).toBeInTheDocument();
    expect(screen.queryByText("almirant_get_current_user")).not.toBeInTheDocument();
  });

  it("normaliza la tool skill en minúsculas como Skill", () => {
    renderTimeline({
      messages: [
        {
          id: "tool-skill-direct",
          role: "assistant",
          content: "",
          messageType: "tool_call",
          metadata: {
            toolName: "skill",
            toolCallId: "tool-skill-direct",
            inputPreview: "runner-implement",
          },
        },
      ],
    });

    expect(screen.getByText("Skill")).toBeInTheDocument();
    expect(screen.getByText("Runner implement")).toBeInTheDocument();
    expect(screen.queryByText("skill")).not.toBeInTheDocument();
  });

  it("no duplica texto del agente cuando una sesión live no tiene mensaje de usuario visible", async () => {
    render(
      <ConversationTimeline
        isStreaming
        messages={[
          {
            id: "assistant-raw-output",
            role: "assistant",
            content: "Iniciando el skill de implementación para ZC-E-12.",
          },
        ]}
        streamingBlocks={[
          {
            type: "text",
            content: "Iniciando el skill de implementación para ZC-E-12.",
          },
        ]}
      />,
    );

    expect(
      await screen.findAllByText(
        "Iniciando el skill de implementación para ZC-E-12.",
      ),
    ).toHaveLength(1);
  });
});

describe("humanizeInputPreview", () => {
  it("extrae el nombre del skill desde args slash-style", () => {
    expect(humanizeInputPreview("Skill", '{"args":"/ideate"}')).toBe("Ideate");
  });

  it("extrae el nombre del skill desde una ruta a SKILL.md", () => {
    expect(
      humanizeInputPreview(
        "Skill",
        '{"path":"/workspace/repo/.agents/skills/ideate/SKILL.md"}',
      ),
    ).toBe("Ideate");
  });

  it("extrae el nombre del skill desde el slug directo de OpenCode", () => {
    expect(humanizeInputPreview("skill", "runner-implement")).toBe(
      "Runner implement",
    );
  });
});

describe("parseMcpToolName", () => {
  it("normaliza nombres directos de herramientas MCP de Almirant", () => {
    expect(parseMcpToolName("almirant_get_current_user")).toMatchObject({
      serverRaw: "almirant",
      serverLabel: "Almirant",
      action: "get_current_user",
      actionLabel: "Current user",
    });
  });
});
