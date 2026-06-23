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
