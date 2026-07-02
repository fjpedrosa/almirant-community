import { describe, expect, test } from "bun:test";
import { mapCanonicalEventToPlanningWsMessage } from "../planning-ws-mapper";

describe("mapCanonicalEventToPlanningWsMessage", () => {
  test("preserves grouped questions in planning:question payload", () => {
    const message = mapCanonicalEventToPlanningWsMessage(
      {
        kind: "agent.question",
        questionText: "Pregunta 1\nPregunta 2",
        options: ["A", "B", "C"],
        questions: [
          { text: "Pregunta 1", options: ["A", "B"] },
          { text: "Pregunta 2", options: ["C"] },
        ],
        questionType: "single_choice",
      },
      {
        sessionId: "session-1",
        sequenceNumber: 42,
      },
    );

    expect(message).toEqual({
      type: "planning:question",
      payload: {
        sessionId: "session-1",
        sequenceNum: 42,
        questionId: "question-42",
        questionText: "Pregunta 1\nPregunta 2",
        options: ["A", "B", "C"],
        questions: [
          { text: "Pregunta 1", options: ["A", "B"] },
          { text: "Pregunta 2", options: ["C"] },
        ],
        questionType: "single_choice",
        expiresAt: expect.any(String),
      },
    });
  });

  test("preserva identidad y expiración de preguntas canónicas v2", () => {
    const message = mapCanonicalEventToPlanningWsMessage(
      {
        kind: "agent.question",
        questionId: "q-turn-123",
        questionText: "¿Qué opción prefieres?",
        options: ["A", "B"],
        expiresAt: "2026-04-28T01:30:00.000Z",
      },
      {
        sessionId: "session-1",
        sequenceNumber: 43,
      },
    );

    expect(message?.payload.questionId).toBe("q-turn-123");
    expect(message?.payload.expiresAt).toBe("2026-04-28T01:30:00.000Z");
  });

  test("silencia eventos de turno canónico v2 en el mapper legacy", () => {
    const message = mapCanonicalEventToPlanningWsMessage(
      {
        kind: "turn.awaiting_user",
        turnId: "turn-123",
        interactionId: "q-turn-123",
      },
      {
        sessionId: "session-1",
        sequenceNumber: 44,
      },
    );

    expect(message).toBeNull();
  });

  test("normaliza mcp_tool cuando el preview incluye servidor y accion MCP", () => {
    const message = mapCanonicalEventToPlanningWsMessage(
      {
        kind: "agent.tool_call.start",
        toolCallId: "tool-1",
        toolName: "mcp_tool",
        inputPreview: JSON.stringify({
          server: "almirant",
          tool: "move_work_item",
          arguments: { taskId: "A-123" },
        }),
      },
      {
        sessionId: "session-1",
        sequenceNumber: 7,
      },
    );

    expect(message).toEqual({
      type: "planning:tool-call-start",
      payload: {
        sessionId: "session-1",
        sequenceNum: 7,
        toolCallId: "tool-1",
        toolName: "mcp__almirant__move_work_item",
        inputPreview: JSON.stringify({
          server: "almirant",
          tool: "move_work_item",
          arguments: { taskId: "A-123" },
        }),
      },
    });
  });
});
