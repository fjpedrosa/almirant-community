/**
 * Tests for the planning session reducer — timeline integrity.
 *
 * Ensures that text/thinking/tool_call blocks are NEVER lost
 * when transitioning between turns (the bug fixed in RECEIVE_RESPONSE_COMPLETE).
 */
import { describe, expect, it } from "bun:test";
import {
  planningReducer,
  graduateBlocksToMessages,
  buildPlanningReplayFromHistory,
  loadPaginatedAgentJobOutput,
  getReplayDedupBaselineFromMessages,
  shouldShowIdleTimeoutToast,
  stripRetransmittedStreamingChunk,
  createStreamingReplayDedupeState,
  primeStreamingReplayDedupe,
  resetStreamingReplayDedupe,
  dedupeStreamingReplayChunk,
  INITIAL_STATE,
  type PlanningSessionState,
} from "./use-planning-session";
import type { PlanningMessage } from "../../domain/types";
import type { StreamingBlock } from "@/domains/shared/domain/streaming-block-types";
import type { AgentLogChunk } from "@/domains/shared/domain/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a state that looks like the agent just finished streaming a response. */
const buildStreamingDoneState = (
  overrides?: Partial<PlanningSessionState>,
): PlanningSessionState => ({
  ...INITIAL_STATE,
  phase: "streaming",
  sessionId: "test-session",
  session: {
    id: "test-session",
    workspaceId: "org-1",
    status: "active",
    title: "Test",
    projectId: "proj-1",
    boardId: "board-1",
    config: null,
    result: null,
    createdByUserId: null,
    totalInputTokens: null,
    totalOutputTokens: null,
    estimatedCost: null,
    durationMs: null,
    completedAt: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    seedCount: 0,
    workItemCount: 0,
    createdByUserName: null,
    createdByUserImage: null,
    projectName: null,
    boardName: null,
  },
  messages: [
    {
      id: "user-1",
      sessionId: "test-session",
      role: "user",
      content: "Do something",
      messageType: null,
      inputTokens: null,
      outputTokens: null,
      metadata: {},
      createdAt: "2026-01-01T00:00:01Z",
    },
  ],
  streamingContent: "Here is my analysis...",
  streamingThinkingContent: "Let me think about this...",
  streamingBlocks: [
    { type: "thinking", content: "Let me think about this..." },
    { type: "text", content: "Here is my analysis..." },
    {
      type: "tool_call",
      toolName: "Read",
      toolCallId: "tc-1",
      status: "success" as const,
      inputPreview: "src/index.ts",
    },
    { type: "text", content: "After reading the file..." },
    {
      type: "subagent",
      subagentId: "sa-1",
      description: "Explore codebase",
      isBackground: false,
      status: "done" as const,
    },
  ],
  completedTurnBlocks: [],
  ...overrides,
});

// ---------------------------------------------------------------------------
// graduateBlocksToMessages
// ---------------------------------------------------------------------------

describe("graduateBlocksToMessages", () => {
  it("converts all block types to messages", () => {
    const blocks: StreamingBlock[] = [
      { type: "thinking", content: "thinking content" },
      { type: "text", content: "text content" },
      {
        type: "tool_call",
        toolName: "Read",
        toolCallId: "tc-1",
        status: "success",
      },
      {
        type: "subagent",
        subagentId: "sa-1",
        description: "Agent",
        isBackground: false,
        status: "done",
      },
      { type: "file_read", filePath: "foo.ts" },
      { type: "file_change", filePath: "bar.ts", operation: "edit" },
      { type: "bash", command: "ls" },
    ];

    const msgs = graduateBlocksToMessages(blocks, "sess-1");

    expect(msgs).toHaveLength(7);
    expect(msgs[0].messageType).toBe("thinking");
    expect(msgs[0].content).toBe("thinking content");
    expect(msgs[1].messageType).toBe("stream");
    expect(msgs[1].content).toBe("text content");
    expect(msgs[2].messageType).toBe("tool_call");
    expect(msgs[3].messageType).toBe("subagent");
    expect(msgs[4].messageType).toBe("tool_call"); // file_read → tool_call
    expect(msgs[5].messageType).toBe("tool_call"); // file_change → tool_call
    expect(msgs[6].messageType).toBe("tool_call"); // bash → tool_call

    // All get the correct sessionId
    for (const m of msgs) {
      expect(m.sessionId).toBe("sess-1");
      expect(m.role).toBe("assistant");
    }
  });

  it("returns empty array for empty blocks", () => {
    expect(graduateBlocksToMessages([], "sess-1")).toEqual([]);
  });
});

describe("stripRetransmittedStreamingChunk", () => {
  it("drops a fully retransmitted structured chunk", () => {
    const existing = "## Alternatives\n- Keep the current flow\n- Split the reducer\n";
    const incoming = "## Alternatives\n- Keep the current flow\n- Split the reducer\n";

    expect(stripRetransmittedStreamingChunk(existing, incoming)).toBe("");
  });

  it("keeps only the novel suffix when a reconnect replays a section prefix", () => {
    const existing =
      "## Alternatives\n- Keep the current flow\n- Split the reducer\n";
    const incoming =
      "## Alternatives\n- Keep the current flow\n- Split the reducer\n- Add reconnect dedupe\n";

    expect(stripRetransmittedStreamingChunk(existing, incoming)).toBe(
      "- Add reconnect dedupe\n",
    );
  });

  it("does not strip tiny accidental overlaps", () => {
    const existing = "alpha";
    const incoming = "a plan";

    expect(stripRetransmittedStreamingChunk(existing, incoming)).toBe(
      "a plan",
    );
  });

  it("deduplica el replay estructurado usando el ultimo mensaje persistido del asistente", () => {
    const baseline = getReplayDedupBaselineFromMessages(
      [
        {
          id: "user-1",
          sessionId: "sess-1",
          role: "user",
          content: "Continua",
          messageType: null,
          inputTokens: null,
          outputTokens: null,
          metadata: {},
          createdAt: "2026-01-01T00:00:00Z",
        },
        {
          id: "assistant-1",
          sessionId: "sess-1",
          role: "assistant",
          content: "## Phase 3\n- Scope current constraints\n- Compare trade-offs\n",
          messageType: null,
          inputTokens: null,
          outputTokens: null,
          metadata: {},
          createdAt: "2026-01-01T00:00:01Z",
        },
      ],
      "stream",
    );

    expect(
      stripRetransmittedStreamingChunk(
        baseline,
        "## Phase 3\n- Scope current constraints\n- Compare trade-offs\n- Validate edge cases\n",
      ),
    ).toBe("- Validate edge cases\n");
  });
});

describe("streaming replay dedupe (reconnect baselines)", () => {
  const buildAssistantMessage = (
    id: string,
    content: string,
    messageType: "stream" | "thinking",
  ): PlanningMessage => ({
    id,
    sessionId: "sess-1",
    role: "assistant",
    content,
    messageType,
    inputTokens: null,
    outputTokens: null,
    metadata: {},
    createdAt: "2026-01-01T00:00:01Z",
  });

  const NOW = 1_700_000_000_000;

  it("un baseline obsoleto del turno anterior robaría el prefijo del turno nuevo; el reset de frontera lo evita", () => {
    const previousTurnText = "## Plan\n- Paso A\n- Paso B\n";
    const primed = primeStreamingReplayDedupe(
      [buildAssistantMessage("a-1", previousTurnText, "stream")],
      NOW,
    );

    // The next turn legitimately starts with the same section heading.
    const newTurnChunk = "## Plan\n- Paso A\n- Paso B\n- Paso C (revisado)\n";

    // Hazard documented: with the stale baseline still armed, the new turn's
    // prefix would be stripped as if it were a retransmission.
    const stale = dedupeStreamingReplayChunk(primed, "text", newTurnChunk, "", NOW);
    expect(stale.content).toBe("- Paso C (revisado)\n");

    // Correct behavior: the turn boundary resets the baselines, so the new
    // turn's content passes through intact (no stripping, no duplication).
    const afterBoundary = resetStreamingReplayDedupe();
    const fresh = dedupeStreamingReplayChunk(
      afterBoundary,
      "text",
      newTurnChunk,
      "",
      NOW,
    );
    expect(fresh.content).toBe(newTurnChunk);
  });

  it("overlap parcial en replay de reconexión aplica solo el sufijo nuevo y un segundo replay queda vacío", () => {
    const persisted = "## Alternativas\n- Mantener el flujo\n- Dividir el reducer\n";
    let state = primeStreamingReplayDedupe(
      [buildAssistantMessage("a-1", persisted, "stream")],
      NOW,
    );

    const replayed =
      "## Alternativas\n- Mantener el flujo\n- Dividir el reducer\n- Añadir dedupe\n";
    const first = dedupeStreamingReplayChunk(state, "text", replayed, "", NOW);
    expect(first.content).toBe("- Añadir dedupe\n");
    state = first.state;

    // The baseline grew with the applied suffix — replaying the suffix again
    // yields nothing new.
    const second = dedupeStreamingReplayChunk(
      state,
      "text",
      "- Añadir dedupe\n",
      "",
      NOW,
    );
    expect(second.content).toBe("");
  });

  it("los baselines de text y thinking son independientes", () => {
    const state = primeStreamingReplayDedupe(
      [
        buildAssistantMessage("a-1", "## Texto persistido\n- linea texto\n", "stream"),
        buildAssistantMessage("a-2", "## Razonamiento previo\n- linea thinking\n", "thinking"),
      ],
      NOW,
    );

    // A replayed thinking chunk dedupes against the thinking baseline only.
    const thinking = dedupeStreamingReplayChunk(
      state,
      "thinking",
      "## Razonamiento previo\n- linea thinking\n- nueva idea\n",
      "",
      NOW,
    );
    expect(thinking.content).toBe("- nueva idea\n");
    // ...and does not mutate the text baseline.
    expect(thinking.state.textBaseline).toBe(state.textBaseline);

    // A replayed text chunk is unaffected by the thinking baseline.
    const text = dedupeStreamingReplayChunk(
      thinking.state,
      "text",
      "## Texto persistido\n- linea texto\n- nueva seccion\n",
      "",
      NOW,
    );
    expect(text.content).toBe("- nueva seccion\n");
    expect(text.state.thinkingBaseline).toBe(thinking.state.thinkingBaseline);
  });

  it("fuera de la ventana de dedupe el contenido pasa íntegro", () => {
    const state = primeStreamingReplayDedupe(
      [buildAssistantMessage("a-1", "## Contenido previo\n- item\n", "stream")],
      NOW,
    );

    const afterWindow = dedupeStreamingReplayChunk(
      state,
      "text",
      "## Contenido previo\n- item\n- extra\n",
      "",
      NOW + 60_000,
    );
    expect(afterWindow.content).toBe("## Contenido previo\n- item\n- extra\n");
  });

  it("el estado inicial no dedupea nada (ventana cerrada)", () => {
    const state = createStreamingReplayDedupeState();
    const result = dedupeStreamingReplayChunk(state, "text", "Hola", "", NOW);
    expect(result.content).toBe("Hola");
  });
});

describe("shouldShowIdleTimeoutToast", () => {
  it("muestra el toast para una sesion sin items cuando el resumen indica timeout", () => {
    expect(
      shouldShowIdleTimeoutToast({
        generatedItemsCount: 0,
        summary: "Session ended due to idle timeout",
        sessionId: "sess-1",
        lastNotifiedSessionId: null,
      }),
    ).toBe(true);
  });

  it("evita repetir el mismo toast cuando planning:done se retransmite para la misma sesion", () => {
    expect(
      shouldShowIdleTimeoutToast({
        generatedItemsCount: 0,
        summary: "Session ended due to idle timeout",
        sessionId: "sess-1",
        lastNotifiedSessionId: "sess-1",
      }),
    ).toBe(false);
  });
});

describe("RECEIVE_TEXT legacy control-token sanitization", () => {
  it("does not surface legacy progress control tokens in visible assistant text", () => {
    let state: PlanningSessionState = {
      ...INITIAL_STATE,
      phase: "booting",
      sessionId: "sess-control-tokens",
    };

    state = planningReducer(state, {
      type: "RECEIVE_TEXT",
      content: "Resumen listo.\n[DONE] Completado",
    });
    state = planningReducer(state, { type: "RECEIVE_RESPONSE_COMPLETE" });

    const streamMessages = state.messages.filter(
      (message) => message.role === "assistant" && message.messageType === "stream",
    );

    expect(streamMessages).toHaveLength(1);
    expect(streamMessages[0]?.content).toBe("Resumen listo.\n");
    expect(streamMessages[0]?.content.includes("[DONE]")).toBe(false);
  });

  it("ignores control-token-only chunks instead of creating a visible transcript block", () => {
    const next = planningReducer(
      {
        ...INITIAL_STATE,
        phase: "chatting",
        sessionId: "sess-control-tokens-only",
      },
      {
        type: "RECEIVE_TEXT",
        content: "[DONE] Flujo completado",
      },
    );

    expect(next.phase).toBe("chatting");
    expect(next.streamingContent).toBe("");
    expect(next.streamingBlocks).toEqual([]);
  });
});

describe("buildPlanningReplayFromHistory", () => {
  it("preserves finish-phase errors as assistant replay content", () => {
    const rawChunks: AgentLogChunk[] = [
      {
        id: "user-input-1",
        seq: 1,
        level: "info",
        phase: "transcript",
        eventType: "user_input",
        message: "Investigate sessions replay mismatch",
        contentType: "user_input",
        payload: {},
        timestamp: "2026-04-09T20:26:49.369Z",
      },
      {
        id: "job-running-1",
        seq: 2,
        level: "info",
        phase: "claim",
        eventType: "job.running",
        message: "Job status moved to running",
        contentType: "text",
        payload: {},
        timestamp: "2026-04-09T20:26:51.892Z",
      },
      {
        id: "job-failed-1",
        seq: 3,
        level: "error",
        phase: "finish",
        eventType: "job.failed",
        message: "Execution failed",
        contentType: "text",
        payload: {
          errorMessage: "Missing provider key for anthropic",
        },
        timestamp: "2026-04-09T20:26:51.913Z",
      },
    ];

    const replay = buildPlanningReplayFromHistory("sess-1", [
      {
        rawChunks,
        displayChunks: rawChunks,
      },
    ]);

    expect(replay.turnBlocks).toEqual([]);
    expect(replay.messages).toHaveLength(2);
    expect(replay.messages[0]).toMatchObject({
      role: "user",
      content: "Investigate sessions replay mismatch",
    });
    expect(replay.messages[1]).toMatchObject({
      role: "assistant",
      messageType: "stream",
    });
    expect(replay.messages[1]?.content).toContain("Execution failed");
    expect(replay.messages[1]?.content).toContain(
      "Missing provider key for anthropic",
    );
  });

  it("rebuilds canonical replay from session-events-only traces", () => {
    const displayChunks: AgentLogChunk[] = [
      {
        id: "thinking-1",
        seq: 1,
        level: "info",
        phase: "transcript",
        eventType: "agent.thinking",
        message: "Need to inspect planning replay",
        contentType: "thinking",
        payload: {},
        timestamp: "2026-04-09T20:40:34.249Z",
      },
      {
        id: "text-1",
        seq: 2,
        level: "info",
        phase: "transcript",
        eventType: "agent.text",
        message: "Found a divergence between sessions and planning.",
        contentType: "text",
        payload: {},
        timestamp: "2026-04-09T20:40:35.249Z",
      },
      {
        id: "tool-1",
        seq: 3,
        level: "info",
        phase: "transcript",
        eventType: "tool_use",
        message: "Read frontend/src/domains/planning/application/hooks/use-planning-session.ts",
        contentType: "tool_use",
        payload: {
          toolName: "Read",
          toolCallId: "tool-read-1",
          inputPreview:
            "frontend/src/domains/planning/application/hooks/use-planning-session.ts",
        },
        timestamp: "2026-04-09T20:40:36.249Z",
      },
    ];

    const replay = buildPlanningReplayFromHistory("sess-2", [
      {
        rawChunks: [],
        displayChunks,
        fallbackUserMessage: "Compare planning replay against session detail",
        fallbackUserTimestamp: "2026-04-09T20:40:13.157Z",
      },
    ]);

    expect(replay.messages[0]).toMatchObject({
      role: "user",
      content: "Compare planning replay against session detail",
    });
    expect(
      replay.messages.some((message) => message.messageType === "thinking"),
    ).toBe(true);
    expect(
      replay.messages.some(
        (message) =>
          message.messageType === "tool_call" &&
          (message.metadata?.toolName as string | undefined) === "Read",
      ),
    ).toBe(true);
  });

  it("prefers the persisted userMessage over prompt.sent fallback content", () => {
    const promptWrappedRawChunks: AgentLogChunk[] = [
      {
        id: "prompt-1",
        seq: 1,
        level: "info",
        phase: "session",
        eventType: "prompt.sent",
        message:
          "IMPORTANT: You MUST respond in English. All user-facing text must be in English.\n\n<user_request>\nContinue the planning session from where it was left off.\n</user_request>",
        contentType: "text",
        payload: {
          prompt:
            "IMPORTANT: You MUST respond in English. All user-facing text must be in English.\n\n<user_request>\nContinue the planning session from where it was left off.\n</user_request>",
        },
        timestamp: "2026-04-10T22:09:55.332Z",
      },
      {
        id: "assistant-1",
        seq: 2,
        level: "info",
        phase: "transcript",
        eventType: "agent.text.complete",
        message: "I resumed the session.",
        contentType: "text",
        payload: {},
        timestamp: "2026-04-10T22:10:01.000Z",
      },
    ];

    const replay = buildPlanningReplayFromHistory("sess-3", [
      {
        rawChunks: promptWrappedRawChunks,
        displayChunks: promptWrappedRawChunks,
        fallbackUserMessage: "Nuevo diseño Navbar",
        fallbackUserTimestamp: "2026-04-10T22:09:53.143Z",
      },
    ]);

    expect(replay.messages[0]).toMatchObject({
      role: "user",
      content: "Nuevo diseño Navbar",
    });
    expect(replay.messages[0]?.content).not.toContain("IMPORTANT:");
    expect(replay.messages[0]?.content).not.toContain("<user_request>");
  });
});

describe("loadPaginatedAgentJobOutput", () => {
  it("concatena todas las paginas cuando el job tiene mas de 5000 chunks", async () => {
    const chunks = await loadPaginatedAgentJobOutput(async (cursor) => {
      if (cursor === undefined) {
        return {
          chunks: [
            {
              id: "chunk-1",
              seq: 1,
              level: "info",
              phase: "transcript",
              eventType: "agent.text",
              message: "Primera pagina",
              contentType: "text",
              payload: {},
              timestamp: "2026-04-12T00:00:00.000Z",
            },
          ],
          nextCursor: 5000,
          hasMore: true,
        };
      }

      return {
        chunks: [
          {
            id: "chunk-2",
            seq: 5001,
            level: "info",
            phase: "transcript",
            eventType: "agent.text",
            message: "Segunda pagina",
            contentType: "text",
            payload: {},
            timestamp: "2026-04-12T00:00:01.000Z",
          },
        ],
        nextCursor: null,
        hasMore: false,
      };
    });

    expect(chunks.map((chunk) => chunk.id)).toEqual(["chunk-1", "chunk-2"]);
  });

  it("se detiene cuando el backend indica que no hay mas paginas", async () => {
    let calls = 0;

    const chunks = await loadPaginatedAgentJobOutput(async () => {
      calls += 1;
      return {
        chunks: [
          {
            id: "single-page",
            seq: 1,
            level: "info",
            phase: "transcript",
            eventType: "agent.text",
            message: "Unica pagina",
            contentType: "text",
            payload: {},
            timestamp: "2026-04-12T00:00:00.000Z",
          },
        ],
        nextCursor: null,
        hasMore: false,
      };
    });

    expect(calls).toBe(1);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.id).toBe("single-page");
  });
});

// ---------------------------------------------------------------------------
// RECEIVE_RESPONSE_COMPLETE — the core fix
// ---------------------------------------------------------------------------

describe("RECEIVE_RESPONSE_COMPLETE", () => {
  it("graduates ALL streaming blocks to messages (text + thinking included)", () => {
    const state = buildStreamingDoneState();

    const next = planningReducer(state, {
      type: "RECEIVE_RESPONSE_COMPLETE",
    });

    // Streaming blocks should be empty (graduated)
    expect(next.streamingBlocks).toEqual([]);
    expect(next.completedTurnBlocks).toEqual([]);

    // Messages should contain: original user msg + all graduated blocks
    // Original: 1 user message
    // Graduated: thinking + text + tool_call + text + subagent = 5
    expect(next.messages).toHaveLength(6);

    // Verify text messages survived
    const textMsgs = next.messages.filter(
      (m) => m.role === "assistant" && m.messageType === "stream",
    );
    expect(textMsgs).toHaveLength(2);
    expect(textMsgs[0].content).toBe("Here is my analysis...");
    expect(textMsgs[1].content).toBe("After reading the file...");

    // Verify thinking survived
    const thinkingMsgs = next.messages.filter(
      (m) => m.role === "assistant" && m.messageType === "thinking",
    );
    expect(thinkingMsgs).toHaveLength(1);
    expect(thinkingMsgs[0].content).toBe("Let me think about this...");

    // Verify tool_call survived
    const toolMsgs = next.messages.filter(
      (m) => m.role === "assistant" && m.messageType === "tool_call",
    );
    expect(toolMsgs).toHaveLength(1);

    // Verify subagent survived
    const subagentMsgs = next.messages.filter(
      (m) => m.role === "assistant" && m.messageType === "subagent",
    );
    expect(subagentMsgs).toHaveLength(1);
  });

  it("also graduates completedTurnBlocks from previous turns", () => {
    const state = buildStreamingDoneState({
      completedTurnBlocks: [
        [
          {
            type: "tool_call",
            toolName: "Glob",
            toolCallId: "tc-prev",
            status: "success" as const,
          },
        ],
      ],
    });

    const next = planningReducer(state, {
      type: "RECEIVE_RESPONSE_COMPLETE",
    });

    expect(next.completedTurnBlocks).toEqual([]);
    // 1 user + 1 prev tool_call + 5 current blocks = 7
    expect(next.messages).toHaveLength(7);
  });

  it("transitions to chatting phase", () => {
    const state = buildStreamingDoneState();

    const next = planningReducer(state, {
      type: "RECEIVE_RESPONSE_COMPLETE",
    });

    expect(next.phase).toBe("chatting");
  });

  it("promotes pending user message", () => {
    const state = buildStreamingDoneState({
      pendingUserMessage: {
        id: "pending-1",
        sessionId: "test-session",
        role: "user",
        content: "Follow-up",
        messageType: null,
        inputTokens: null,
        outputTokens: null,
        metadata: {},
        createdAt: "2026-01-01T00:01:00Z",
        deliveryStatus: "queued",
      },
    });

    const next = planningReducer(state, {
      type: "RECEIVE_RESPONSE_COMPLETE",
    });

    expect(next.pendingUserMessage).toBeNull();
    const lastMsg = next.messages[next.messages.length - 1];
    expect(lastMsg.content).toBe("Follow-up");
    expect(lastMsg.deliveryStatus).toBe("delivered");
  });

  it("preserves prior assistant text when a deferred interactive question is pending", () => {
    const state = buildStreamingDoneState({
      streamingContent:
        "Aquí está el análisis de la planificación.\n\nNecesito una decisión.\n\n¿Qué formato prefieres?",
      streamingBlocks: [
        { type: "thinking", content: "Analizando opciones..." },
        { type: "text", content: "Aquí está el análisis de la planificación." },
        {
          type: "tool_call",
          toolName: "Read",
          toolCallId: "tc-question",
          status: "success",
          inputPreview: "frontend/src/domains/planning/application/hooks/use-planning-session.ts",
        },
        {
          type: "text",
          content:
            "Necesito una decisión.\n\n¿Qué formato prefieres?",
        },
      ],
      deferredQuestion: {
        questionId: "q-1",
        questionText: "¿Qué formato prefieres?",
        options: ["Lista", "Roadmap"],
      },
    });

    const next = planningReducer(state, {
      type: "RECEIVE_RESPONSE_COMPLETE",
    });

    expect(next.phase).toBe("waiting_for_answer");
    expect(next.pendingQuestion).toEqual({
      questionId: "q-1",
      questionText: "¿Qué formato prefieres?",
      options: ["Lista", "Roadmap"],
    });

    const textMsgs = next.messages.filter(
      (m) => m.role === "assistant" && m.messageType === "stream",
    );

    expect(textMsgs).toHaveLength(2);
    expect(textMsgs[0].content).toBe("Aquí está el análisis de la planificación.");
    expect(textMsgs[1].content).toBe("Necesito una decisión.");
    expect(textMsgs.some((m) => m.content.includes("¿Qué formato prefieres?"))).toBe(false);
  });

  it("treats agent follow-up prompts as chat follow-ups instead of questionnaires", () => {
    const withDeferredFollowUp = planningReducer(buildStreamingDoneState(), {
      type: "RECEIVE_QUESTION",
      questionId: "follow-up-1",
      questionText:
        "1. Falta de estados bloqueados / UX guiada\n2. Multitenancy roto o mal diseñado",
      options: [],
      questionType: "free_text",
      source: "agent_follow_up",
      expiresAt: "2026-01-01T00:15:00Z",
    });

    expect(withDeferredFollowUp.deferredQuestion).toEqual({
      questionId: "follow-up-1",
      questionText:
        "1. Falta de estados bloqueados / UX guiada\n2. Multitenancy roto o mal diseñado",
      options: [],
      questionType: "free_text",
      source: "agent_follow_up",
      expiresAt: "2026-01-01T00:15:00Z",
    });

    const next = planningReducer(withDeferredFollowUp, {
      type: "RECEIVE_RESPONSE_COMPLETE",
      requiresFollowUp: true,
    });

    expect(next.phase).toBe("chatting");
    expect(next.pendingQuestion).toBeNull();
    expect(next.pendingFollowUp).toBe(true);
    expect(next.followUpPrompt).toBe(
      "1. Falta de estados bloqueados / UX guiada\n2. Multitenancy roto o mal diseñado",
    );
    expect(next.expiresAt).toBe("2026-01-01T00:15:00Z");
  });
});

// ---------------------------------------------------------------------------
// START_STREAMING after RECEIVE_RESPONSE_COMPLETE
// ---------------------------------------------------------------------------

describe("START_STREAMING after response complete", () => {
  it("does NOT lose messages when starting a new turn", () => {
    // Simulate: response_complete → add_user_message → start_streaming
    let state = buildStreamingDoneState();

    // 1. Response completes — blocks graduate to messages
    state = planningReducer(state, { type: "RECEIVE_RESPONSE_COMPLETE" });
    expect(state.messages).toHaveLength(6); // 1 user + 5 graduated

    // 2. User sends a new message
    state = planningReducer(state, {
      type: "ADD_USER_MESSAGE",
      content: "Go ahead",
    });
    expect(state.messages).toHaveLength(7); // + 1 user

    // 3. Start streaming (new turn)
    state = planningReducer(state, { type: "START_STREAMING" });

    // ALL 7 messages must survive
    expect(state.messages).toHaveLength(7);
    expect(state.streamingBlocks).toEqual([]);
    expect(state.completedTurnBlocks).toEqual([]);

    // Verify the graduated text is still there
    const textMsgs = state.messages.filter(
      (m) => m.role === "assistant" && m.messageType === "stream",
    );
    expect(textMsgs).toHaveLength(2);
    expect(textMsgs[0].content).toBe("Here is my analysis...");
    expect(textMsgs[1].content).toBe("After reading the file...");

    // Verify the thinking is still there
    const thinkingMsgs = state.messages.filter(
      (m) => m.role === "assistant" && m.messageType === "thinking",
    );
    expect(thinkingMsgs).toHaveLength(1);
  });

  it("preserva los bloques thinking al cruzar de turno cuando RECEIVE_RESPONSE_COMPLETE no llegó antes", () => {
    // Simulate: the previous turn's response-complete was lost (WS drop) and
    // the user starts a new turn directly — streamingBlocks still hold the
    // previous turn's thinking/text blocks.
    let state = buildStreamingDoneState({ phase: "chatting" });

    state = planningReducer(state, { type: "START_STREAMING" });

    // The previous turn's blocks must graduate to completedTurnBlocks —
    // including thinking, which would otherwise disappear from the timeline.
    expect(state.streamingBlocks).toEqual([]);
    expect(state.completedTurnBlocks).toHaveLength(1);

    const graduated = state.completedTurnBlocks[0];
    const thinkingBlocks = graduated.filter((b) => b.type === "thinking");
    expect(thinkingBlocks).toHaveLength(1);
    // Chronological order preserved: thinking was the first block of the turn
    expect(graduated[0].type).toBe("thinking");
    // The rest of the persistent blocks survive too
    expect(graduated.filter((b) => b.type === "text")).toHaveLength(2);
    expect(graduated.filter((b) => b.type === "tool_call")).toHaveLength(1);
    expect(graduated.filter((b) => b.type === "subagent")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// ANSWER_QUESTION — should also preserve all blocks
// ---------------------------------------------------------------------------

describe("ANSWER_QUESTION", () => {
  it("graduates all blocks and adds user answer", () => {
    const state = buildStreamingDoneState({
      phase: "waiting_for_answer",
      pendingQuestion: {
        questionId: "q-1",
        questionText: "Which approach?",
        options: ["A", "B"],
      },
    });

    const next = planningReducer(state, {
      type: "ANSWER_QUESTION",
      questionId: "q-1",
      answer: "Option A",
    });

    // Blocks cleared
    expect(next.streamingBlocks).toEqual([]);
    expect(next.completedTurnBlocks).toEqual([]);
    expect(next.pendingQuestion).toBeNull();

    // 1 user + 5 graduated + 1 answer = 7
    expect(next.messages).toHaveLength(7);

    // Last message is the user's answer
    const lastMsg = next.messages[next.messages.length - 1];
    expect(lastMsg.role).toBe("user");
    expect(lastMsg.content).toBe("Option A");

    // Text and thinking preserved
    const textMsgs = next.messages.filter(
      (m) => m.role === "assistant" && m.messageType === "stream",
    );
    expect(textMsgs).toHaveLength(2);

    const thinkingMsgs = next.messages.filter(
      (m) => m.role === "assistant" && m.messageType === "thinking",
    );
    expect(thinkingMsgs).toHaveLength(1);
  });

  it("ignores a duplicate planning question after the same interaction was answered", () => {
    const answered = planningReducer(
      buildStreamingDoneState({
        phase: "waiting_for_answer",
        pendingQuestion: {
          questionId: "q-1",
          questionText: "Which approach?",
          options: ["A", "B"],
        },
      }),
      {
        type: "ANSWER_QUESTION",
        questionId: "q-1",
        answer: "Option A",
      },
    );

    expect(answered.answeredQuestionIds).toContain("q-1");

    const withDuplicateQuestion = planningReducer(answered, {
      type: "RECEIVE_QUESTION",
      questionId: "q-1",
      questionText: "Which approach?",
      options: ["A", "B"],
      questionType: "single_choice",
    });

    expect(withDuplicateQuestion).toEqual(answered);

    const afterResponseComplete = planningReducer(withDuplicateQuestion, {
      type: "RECEIVE_RESPONSE_COMPLETE",
    });

    expect(afterResponseComplete.pendingQuestion).toBeNull();
    expect(afterResponseComplete.deferredQuestion).toBeNull();
  });

  it("ignores an equivalent planning question re-emitted with a new interaction id", () => {
    const answered = planningReducer(
      buildStreamingDoneState({
        phase: "waiting_for_answer",
        pendingQuestion: {
          questionId: "q-1",
          questionText: "Which approach?",
          options: ["A", "B"],
        },
      }),
      {
        type: "ANSWER_QUESTION",
        questionId: "q-1",
        answer: "Option A",
      },
    );

    expect(answered.answeredQuestionSignatures).toContain("Which approach?");

    const withDuplicateQuestion = planningReducer(answered, {
      type: "RECEIVE_QUESTION",
      questionId: "q-2",
      questionText: "Which approach?",
      options: ["A", "B"],
      questionType: "single_choice",
    });

    expect(withDuplicateQuestion).toEqual(answered);
  });

  it("still allows a brand-new question after answering the previous one", () => {
    const answered = planningReducer(
      buildStreamingDoneState({
        phase: "waiting_for_answer",
        pendingQuestion: {
          questionId: "q-1",
          questionText: "Which approach?",
          options: ["A", "B"],
        },
      }),
      {
        type: "ANSWER_QUESTION",
        questionId: "q-1",
        answer: "Option A",
      },
    );

    const withNewQuestion = planningReducer(answered, {
      type: "RECEIVE_QUESTION",
      questionId: "q-2",
      questionText: "Need more detail?",
      options: [],
      questionType: "free_text",
    });

    expect(withNewQuestion.deferredQuestion).toEqual({
      questionId: "q-2",
      questionText: "Need more detail?",
      options: [],
      questionType: "free_text",
      expiresAt: null,
    });
  });

  it("transitions phase to streaming when answering from waiting_for_answer", () => {
    const before = Date.now();
    const state = buildStreamingDoneState({
      phase: "waiting_for_answer",
      pendingQuestion: {
        questionId: "q-1",
        questionText: "Which approach?",
        options: ["A", "B"],
      },
      processingStartedAt: before - 10_000,
    });

    const next = planningReducer(state, {
      type: "ANSWER_QUESTION",
      questionId: "q-1",
      answer: "Option A",
    });

    expect(next.phase).toBe("streaming");
    expect(next.processingStartedAt).not.toBeNull();
    expect(next.processingStartedAt as number).toBeGreaterThanOrEqual(before);
  });

  it("transitions phase to streaming when answering from chatting (deferred question flow)", () => {
    const before = Date.now();
    const state = buildStreamingDoneState({
      phase: "chatting",
      pendingQuestion: null,
      deferredQuestion: {
        questionId: "q-1",
        questionText: "Which approach?",
        options: ["A", "B"],
        questionType: "single_choice",
        expiresAt: null,
      },
      processingStartedAt: null,
    });

    const next = planningReducer(state, {
      type: "ANSWER_QUESTION",
      questionId: "q-1",
      answer: "Option A",
    });

    expect(next.phase).toBe("streaming");
    expect(next.processingStartedAt).not.toBeNull();
    expect(next.processingStartedAt as number).toBeGreaterThanOrEqual(before);
  });

  it("transitions phase to streaming when answering from thinking", () => {
    const before = Date.now();
    const state = buildStreamingDoneState({
      phase: "thinking",
      pendingQuestion: {
        questionId: "q-1",
        questionText: "Which approach?",
        options: ["A", "B"],
      },
      processingStartedAt: before - 5_000,
    });

    const next = planningReducer(state, {
      type: "ANSWER_QUESTION",
      questionId: "q-1",
      answer: "Option A",
    });

    expect(next.phase).toBe("streaming");
    expect(next.processingStartedAt).not.toBeNull();
    expect(next.processingStartedAt as number).toBeGreaterThanOrEqual(before);
  });

  it("transitions phase to streaming when answering from paused", () => {
    const before = Date.now();
    const state = buildStreamingDoneState({
      phase: "paused",
      pendingQuestion: {
        questionId: "q-1",
        questionText: "Which approach?",
        options: ["A", "B"],
      },
      processingStartedAt: null,
    });

    const next = planningReducer(state, {
      type: "ANSWER_QUESTION",
      questionId: "q-1",
      answer: "Option A",
    });

    expect(next.phase).toBe("streaming");
    expect(next.processingStartedAt).not.toBeNull();
    expect(next.processingStartedAt as number).toBeGreaterThanOrEqual(before);
  });

  it("keeps phase when canTransition to streaming is false but still resets processingStartedAt", () => {
    const before = Date.now();
    const state = buildStreamingDoneState({
      phase: "completed",
      pendingQuestion: null,
      deferredQuestion: {
        questionId: "q-1",
        questionText: "Which approach?",
        options: ["A", "B"],
        questionType: "single_choice",
        expiresAt: null,
      },
      processingStartedAt: null,
    });

    const next = planningReducer(state, {
      type: "ANSWER_QUESTION",
      questionId: "q-1",
      answer: "Option A",
    });

    // completed has no transition to streaming, so phase stays.
    expect(next.phase).toBe("completed");
    // But the hand-off still resets processingStartedAt so downstream effects
    // have a fresh reference timestamp.
    expect(next.processingStartedAt).not.toBeNull();
    expect(next.processingStartedAt as number).toBeGreaterThanOrEqual(before);
  });
});

// ---------------------------------------------------------------------------
// COMPLETE — session completion also preserves blocks
// ---------------------------------------------------------------------------

describe("COMPLETE", () => {
  it("graduates all streaming blocks to messages", () => {
    const state = buildStreamingDoneState();

    const next = planningReducer(state, { type: "COMPLETE" });

    expect(next.phase).toBe("completed");
    expect(next.streamingBlocks).toEqual([]);

    // 1 user + 5 graduated = 6
    expect(next.messages).toHaveLength(6);

    // Text preserved
    const textMsgs = next.messages.filter(
      (m) => m.role === "assistant" && m.messageType === "stream",
    );
    expect(textMsgs).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// CANCEL_SESSION — cancellation also preserves blocks
// ---------------------------------------------------------------------------

describe("CANCEL_SESSION", () => {
  it("graduates all streaming blocks to messages", () => {
    const state = buildStreamingDoneState();

    const next = planningReducer(state, { type: "CANCEL_SESSION" });

    expect(next.phase).toBe("idle");
    expect(next.streamingBlocks).toEqual([]);

    // 1 user + 5 graduated = 6
    expect(next.messages).toHaveLength(6);

    // Text preserved
    const textMsgs = next.messages.filter(
      (m) => m.role === "assistant" && m.messageType === "stream",
    );
    expect(textMsgs).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Multi-turn regression: 3 turns, all content preserved
// ---------------------------------------------------------------------------

describe("Multi-turn timeline integrity", () => {
  it("preserves all content across 3 turns with free-text replies", () => {
    // --- Turn 1: User sends prompt, agent responds ---
    let state: PlanningSessionState = {
      ...INITIAL_STATE,
      phase: "booting",
      sessionId: "sess-mt",
    };

    // Simulate streaming content
    state = planningReducer(state, {
      type: "RECEIVE_THINKING",
      content: "Turn 1 thinking",
    });
    state = planningReducer(state, {
      type: "RECEIVE_TEXT",
      content: "Turn 1 text",
    });
    state = planningReducer(state, {
      type: "RECEIVE_TOOL_CALL_START",
      toolCallId: "tc-t1",
      toolName: "Read",
      inputPreview: "file.ts",
    });
    state = planningReducer(state, {
      type: "RECEIVE_TOOL_CALL_RESULT",
      toolCallId: "tc-t1",
      success: true,
    });

    // Response completes — blocks graduate
    state = planningReducer(state, { type: "FLUSH_STREAM" });
    state = planningReducer(state, { type: "RECEIVE_RESPONSE_COMPLETE" });

    expect(state.phase).toBe("chatting");
    expect(state.streamingBlocks).toEqual([]);
    // Should have 3 messages: thinking + text + tool_call
    expect(state.messages).toHaveLength(3);

    // --- Turn 2: User replies, agent responds ---
    state = planningReducer(state, {
      type: "ADD_USER_MESSAGE",
      content: "Continue",
    });
    state = planningReducer(state, { type: "START_STREAMING" });

    // All 4 messages survive (3 graduated + 1 user)
    expect(state.messages).toHaveLength(4);

    // New turn streaming
    state = planningReducer(state, {
      type: "RECEIVE_TEXT",
      content: "Turn 2 text",
    });
    state = planningReducer(state, { type: "FLUSH_STREAM" });
    state = planningReducer(state, { type: "RECEIVE_RESPONSE_COMPLETE" });

    // 4 previous + 1 graduated text = 5
    expect(state.messages).toHaveLength(5);

    // --- Turn 3: Another user reply ---
    state = planningReducer(state, {
      type: "ADD_USER_MESSAGE",
      content: "Finish",
    });
    state = planningReducer(state, { type: "START_STREAMING" });

    // All 6 messages survive
    expect(state.messages).toHaveLength(6);

    // Verify all content
    const contents = state.messages.map((m) => m.content);
    expect(contents).toContain("Turn 1 thinking");
    expect(contents).toContain("Turn 1 text");
    expect(contents).toContain("Continue");
    expect(contents).toContain("Turn 2 text");
    expect(contents).toContain("Finish");

    // Tool call also preserved
    const toolMsgs = state.messages.filter(
      (m) => m.messageType === "tool_call",
    );
    expect(toolMsgs).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// RECOVER_SESSION — WebSocket reconnection must NOT wipe messages
// ---------------------------------------------------------------------------

describe("RECOVER_SESSION", () => {
  it("preserves existing messages when recovering with empty messages", () => {
    // Simulate: agent streamed content, response completed, then WS reconnects
    let state = buildStreamingDoneState();
    state = planningReducer(state, { type: "RECEIVE_RESPONSE_COMPLETE" });
    expect(state.messages).toHaveLength(6); // 1 user + 5 graduated

    // WS reconnects — recovery passes messages: []
    const next = planningReducer(state, {
      type: "RECOVER_SESSION",
      session: state.session!,
      messages: [],
    });

    // Messages must NOT be wiped
    expect(next.messages).toHaveLength(6);

    // Text still there
    const textMsgs = next.messages.filter(
      (m) => m.role === "assistant" && m.messageType === "stream",
    );
    expect(textMsgs).toHaveLength(2);
  });

  it("uses API messages when local state is empty", () => {
    // Fresh state with no messages — recovery should use API data
    const apiMessages = [
      {
        id: "api-1",
        sessionId: "test-session",
        role: "user" as const,
        content: "From API",
        messageType: null,
        inputTokens: null,
        outputTokens: null,
        metadata: {},
        createdAt: "2026-01-01T00:00:00Z",
      },
    ];

    const state = { ...INITIAL_STATE, sessionId: "test-session" };
    const next = planningReducer(state, {
      type: "RECOVER_SESSION",
      session: buildStreamingDoneState().session!,
      messages: apiMessages,
    });

    expect(next.messages).toHaveLength(1);
    expect(next.messages[0].content).toBe("From API");
  });

  it("graduates streaming blocks to messages during active streaming recovery", () => {
    // Agent is streaming, WS drops and reconnects.
    // streamingBlocks has all the agent content (thinking, text, tool_calls).
    const state = buildStreamingDoneState(); // phase: streaming, 1 user msg + 5 streaming blocks

    const next = planningReducer(state, {
      type: "RECOVER_SESSION",
      session: state.session!,
      messages: [],
    });

    // The original user message + all 5 graduated blocks must survive
    expect(next.messages).toHaveLength(6);
    expect(next.messages[0].content).toBe("Do something");

    // Streaming blocks cleared after graduation
    expect(next.streamingBlocks).toEqual([]);
    expect(next.completedTurnBlocks).toEqual([]);

    // Text and thinking survived graduation
    const textMsgs = next.messages.filter(
      (m) => m.role === "assistant" && m.messageType === "stream",
    );
    expect(textMsgs).toHaveLength(2);
    expect(textMsgs[0].content).toBe("Here is my analysis...");

    const thinkingMsgs = next.messages.filter(
      (m) => m.role === "assistant" && m.messageType === "thinking",
    );
    expect(thinkingMsgs).toHaveLength(1);
  });

  it("preserves optimistic user answers when recovery rehydrates stale API messages", () => {
    let state: PlanningSessionState = {
      ...INITIAL_STATE,
      phase: "waiting_for_answer",
      sessionId: "test-session",
      session: buildStreamingDoneState().session!,
      messages: [
        {
          id: "assistant-question",
          sessionId: "test-session",
          role: "assistant",
          content: "Answer both questions before I continue.",
          messageType: "stream",
          inputTokens: null,
          outputTokens: null,
          metadata: {},
          createdAt: "2026-01-01T00:00:00Z",
        },
      ],
      pendingQuestion: {
        questionId: "question-1",
        questionText: "Question 1\nQuestion 2",
        options: ["A", "B"],
        questionType: "free_text",
      },
    };

    state = planningReducer(state, {
      type: "ANSWER_QUESTION",
      questionId: "question-1",
      answer: "Question 1 → Rule A\nQuestion 2 → Confirmed",
    });

    const next = planningReducer(state, {
      type: "RECOVER_SESSION",
      session: state.session!,
      messages: [
        {
          id: "assistant-question",
          sessionId: "test-session",
          role: "assistant",
          content: "Answer both questions before I continue.",
          messageType: "stream",
          inputTokens: null,
          outputTokens: null,
          metadata: {},
          createdAt: "2026-01-01T00:00:00Z",
        },
      ],
    });

    expect(
      next.messages.some(
        (message) =>
          message.role === "user" &&
          message.content === "Question 1 → Rule A\nQuestion 2 → Confirmed",
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// LOAD_SESSION — restore generic follow-up as chat input, not question wizard
// ---------------------------------------------------------------------------

describe("LOAD_SESSION", () => {
  it("restores session.awaiting_user as follow-up without pendingQuestion", () => {
    const session = buildStreamingDoneState().session!;

    const next = planningReducer(INITIAL_STATE, {
      type: "LOAD_SESSION",
      session,
      messages: [],
      pendingInteraction: {
        id: "interaction-1",
        questionType: "free_text",
        questionText: "¿Como te gustaria continuar?",
        questionContext: { source: "session.awaiting_user" },
        expiresAt: "2026-01-01T00:15:00Z",
      },
    });

    expect(next.phase).toBe("chatting");
    expect(next.pendingQuestion).toBeNull();
    expect(next.pendingFollowUp).toBe(true);
    expect(next.followUpPrompt).toBe("¿Como te gustaria continuar?");
    expect(next.expiresAt).toBe("2026-01-01T00:15:00Z");
  });

  it("restores explicit free_text questions as pendingQuestion", () => {
    const session = buildStreamingDoneState().session!;

    const next = planningReducer(INITIAL_STATE, {
      type: "LOAD_SESSION",
      session,
      messages: [],
      pendingInteraction: {
        id: "interaction-2",
        questionType: "free_text",
        questionText: "Necesito mas detalle sobre el alcance",
        questionContext: { source: "agent_question" },
      },
    });

    expect(next.phase).toBe("waiting_for_answer");
    expect(next.pendingQuestion).toEqual({
      questionId: "interaction-2",
      questionText: "Necesito mas detalle sobre el alcance",
      options: [],
      questionType: "free_text",
    });
    expect(next.pendingFollowUp).toBe(false);
    expect(next.followUpPrompt).toBeNull();
  });

  it("restores approval questions with their options from pendingInteraction", () => {
    const session = buildStreamingDoneState().session!;

    const next = planningReducer(INITIAL_STATE, {
      type: "LOAD_SESSION",
      session,
      messages: [],
      pendingInteraction: {
        id: "interaction-3",
        questionType: "approval",
        questionText: "¿Qué propuesta quieres aprobar?",
        questionContext: { source: "agent_question" },
        options: ["Propuesta A", "Propuesta B"],
        expiresAt: "2026-01-01T00:20:00Z",
      },
    });

    expect(next.phase).toBe("waiting_for_answer");
    expect(next.pendingQuestion).toEqual({
      questionId: "interaction-3",
      questionText: "¿Qué propuesta quieres aprobar?",
      options: ["Propuesta A", "Propuesta B"],
      questionType: "single_choice",
    });
    expect(next.expiresAt).toBe("2026-01-01T00:20:00Z");
  });

  it("restores structured grouped questions from pendingInteraction.questionContext", () => {
    const session = buildStreamingDoneState().session!;

    const next = planningReducer(INITIAL_STATE, {
      type: "LOAD_SESSION",
      session,
      messages: [],
      pendingInteraction: {
        id: "interaction-structured",
        questionType: "choice",
        questionText: "Pregunta 1\nPregunta 2",
        questionContext: {
          source: "agent_question",
          questions: [
            { text: "Pregunta 1", options: ["A", "B"] },
            { text: "Pregunta 2", options: ["C"] },
          ],
        },
        options: ["A", "B", "C"],
      },
    });

    expect(next.pendingQuestion).toEqual({
      questionId: "interaction-structured",
      questionText: "Pregunta 1\nPregunta 2",
      options: ["A", "B", "C"],
      questions: [
        { text: "Pregunta 1", options: ["A", "B"] },
        { text: "Pregunta 2", options: ["C"] },
      ],
      questionType: "single_choice",
    });
  });

  it("does not restore a stale pendingInteraction when the questionnaire was already answered", () => {
    const session = buildStreamingDoneState().session!;

    const next = planningReducer(INITIAL_STATE, {
      type: "LOAD_SESSION",
      session,
      messages: [
        {
          id: "answer-1",
          sessionId: "test-session",
          role: "user",
          content: "Pregunta 1 → Opcion A\nPregunta 2 → Opcion B",
          messageType: null,
          inputTokens: null,
          outputTokens: null,
          metadata: {},
          createdAt: "2026-01-01T00:00:03Z",
        },
      ],
      pendingInteraction: {
        id: "interaction-stale",
        questionType: "choice",
        questionText: "Pregunta 1\nPregunta 2",
        questionContext: {
          source: "agent_question",
          questions: [
            { text: "Pregunta 1", options: ["Opcion A", "Opcion B"] },
            { text: "Pregunta 2", options: ["Opcion B", "Opcion C"] },
          ],
        },
        options: ["Opcion A", "Opcion B", "Opcion C"],
      },
    });

    expect(next.phase).toBe("chatting");
    expect(next.pendingQuestion).toBeNull();
  });

  it("does not restore a stale pendingInteraction when the answer was only persisted locally", () => {
    const session = buildStreamingDoneState().session!;

    const next = planningReducer(INITIAL_STATE, {
      type: "LOAD_SESSION",
      session,
      messages: [],
      answeredQuestionIds: ["interaction-local-only"],
      pendingInteraction: {
        id: "interaction-local-only",
        questionType: "choice",
        questionText: "Pregunta local",
        questionContext: { source: "agent_question" },
        options: ["Opcion A", "Opcion B"],
      },
      activeJobStatus: "running",
    });

    expect(next.phase).toBe("chatting");
    expect(next.pendingQuestion).toBeNull();
    expect(next.processingStartedAt).toBeNull();
    expect(next.answeredQuestionIds).toEqual(["interaction-local-only"]);
  });

  it("hydrates generatedItems for completed sessions reopened from history", () => {
    const session = {
      ...buildStreamingDoneState().session!,
      status: "completed" as const,
      workItemCount: 2,
    };
    const generatedItems = [
      {
        tempId: "11111111-1111-4111-8111-111111111111",
        type: "task" as const,
        title: "Task from session",
        description: "",
        priority: "medium" as const,
      },
      {
        tempId: "22222222-2222-4222-8222-222222222222",
        type: "story" as const,
        title: "Story from session",
        description: "",
        priority: "medium" as const,
      },
    ];

    const next = planningReducer(INITIAL_STATE, {
      type: "LOAD_SESSION",
      session,
      messages: [],
      generatedItems,
    });

    expect(next.phase).toBe("completed");
    expect(next.generatedItems).toEqual(generatedItems);
  });

  it("restores the processing spinner when an active job is still running", () => {
    const session = buildStreamingDoneState().session!;

    const next = planningReducer(INITIAL_STATE, {
      type: "LOAD_SESSION",
      session,
      messages: [
        {
          id: "user-1",
          sessionId: "test-session",
          role: "user",
          content: "Planifica esto",
          messageType: null,
          inputTokens: null,
          outputTokens: null,
          metadata: {},
          createdAt: "2026-01-01T00:00:01Z",
        },
      ],
      activeJobStatus: "running",
      activeJobStartedAt: "2026-01-01T00:00:05Z",
    });

    expect(next.phase).toBe("booting");
    expect(next.pendingQuestion).toBeNull();
    expect(next.pendingFollowUp).toBe(false);
    expect(next.processingStartedAt).toBe(
      Date.parse("2026-01-01T00:00:05Z"),
    );
  });

  it("does not restore the processing spinner for prewarmed sessions without a user prompt", () => {
    const session = buildStreamingDoneState().session!;

    const next = planningReducer(INITIAL_STATE, {
      type: "LOAD_SESSION",
      session,
      messages: [
        {
          id: "assistant-1",
          sessionId: "test-session",
          role: "assistant",
          content: "Container listo.",
          messageType: "stream",
          inputTokens: null,
          outputTokens: null,
          metadata: {},
          createdAt: "2026-01-01T00:00:01Z",
        },
      ],
      activeJobStatus: "running",
      activeJobStartedAt: "2026-01-01T00:00:05Z",
    });

    expect(next.phase).toBe("chatting");
    expect(next.pendingQuestion).toBeNull();
    expect(next.pendingFollowUp).toBe(false);
    expect(next.processingStartedAt).toBeNull();
  });

  it("clears live streaming state when loading a session mid-stream", () => {
    // Simulate a state where the WS was already streaming tokens
    // (e.g., user clicks the active session in the sidebar while the agent streams Phase 3).
    const streamingState = buildStreamingDoneState();
    expect(streamingState.streamingBlocks.length).toBeGreaterThan(0);
    expect(streamingState.streamingContent).not.toBe("");

    const session = streamingState.session!;
    const next = planningReducer(streamingState, {
      type: "LOAD_SESSION",
      session,
      messages: [
        {
          id: "replay-1",
          sessionId: "test-session",
          role: "assistant",
          content: "Here is my analysis...",
          messageType: null,
          inputTokens: null,
          outputTokens: null,
          metadata: {},
          createdAt: "2026-01-01T00:00:02Z",
        },
      ],
    });

    // Live streaming state MUST be cleared — otherwise it duplicates the replay content.
    expect(next.streamingContent).toBe("");
    expect(next.streamingThinkingContent).toBe("");
    expect(next.streamingBlocks).toEqual([]);
    // El replay del API se hidrata sin perder el mensaje optimista local del usuario.
    expect(next.messages).toHaveLength(2);
    expect(next.messages.some((message) => message.content === "Do something")).toBe(true);
    expect(next.messages.some((message) => message.id === "replay-1")).toBe(true);
  });

  it("preserva mensajes optimistas del usuario si la hidratacion aun no los incluye", () => {
    const session = buildStreamingDoneState().session!;
    const optimisticState: PlanningSessionState = {
      ...buildStreamingDoneState({
        phase: "chatting",
        streamingContent: "",
        streamingThinkingContent: "",
        streamingBlocks: [],
      }),
      messages: [
        {
          id: "persisted-1",
          sessionId: "test-session",
          role: "assistant",
          content: "Mensaje ya persistido",
          messageType: "stream",
          inputTokens: null,
          outputTokens: null,
          metadata: {},
          createdAt: "2026-01-01T00:00:01Z",
        },
        {
          id: "local-user-1",
          sessionId: "test-session",
          role: "user",
          content: "Mi mensaje reciente",
          messageType: null,
          inputTokens: null,
          outputTokens: null,
          metadata: {},
          createdAt: "2026-01-01T00:00:05Z",
          deliveryStatus: "delivered",
        },
      ],
    };

    const next = planningReducer(optimisticState, {
      type: "LOAD_SESSION",
      session,
      messages: [
        {
          id: "persisted-1",
          sessionId: "test-session",
          role: "assistant",
          content: "Mensaje ya persistido",
          messageType: "stream",
          inputTokens: null,
          outputTokens: null,
          metadata: {},
          createdAt: "2026-01-01T00:00:01Z",
        },
      ],
      activeJobStatus: "running",
    });

    expect(
      next.messages.some(
        (message) =>
          message.role === "user" && message.content === "Mi mensaje reciente",
      ),
    ).toBe(true);
  });

  it("preserva mensajes recientes del asistente generados en vivo hasta que el replay los persista", () => {
    const session = buildStreamingDoneState().session!;
    const optimisticState: PlanningSessionState = {
      ...buildStreamingDoneState({
        phase: "chatting",
        streamingContent: "",
        streamingThinkingContent: "",
        streamingBlocks: [],
      }),
      messages: [
        {
          id: "persisted-1",
          sessionId: "test-session",
          role: "assistant",
          content: "Mensaje ya persistido",
          messageType: "stream",
          inputTokens: null,
          outputTokens: null,
          metadata: {},
          createdAt: "2026-01-01T00:00:01Z",
        },
        {
          id: "live-assistant-1",
          sessionId: "test-session",
          role: "assistant",
          content: "```ts\nconst scope = buildScope();\n```",
          messageType: "stream",
          inputTokens: null,
          outputTokens: null,
          metadata: { fromLiveStreamingTurn: true },
          createdAt: "2026-01-01T00:00:06Z",
        },
      ],
    };

    const next = planningReducer(optimisticState, {
      type: "LOAD_SESSION",
      session,
      messages: [
        {
          id: "persisted-1",
          sessionId: "test-session",
          role: "assistant",
          content: "Mensaje ya persistido",
          messageType: "stream",
          inputTokens: null,
          outputTokens: null,
          metadata: {},
          createdAt: "2026-01-01T00:00:01Z",
        },
      ],
      activeJobStatus: "running",
    });

    expect(
      next.messages.some(
        (message) =>
          message.role === "assistant" &&
          message.content === "```ts\nconst scope = buildScope();\n```",
      ),
    ).toBe(true);
  });

  it("no mezcla mensajes locales de otra sesion al cargar desde sidebar o URL", () => {
    const next = planningReducer(
      {
        ...buildStreamingDoneState({
          phase: "chatting",
          sessionId: "old-session",
          session: {
            ...buildStreamingDoneState().session!,
            id: "old-session",
          },
          streamingContent: "",
          streamingThinkingContent: "",
          streamingBlocks: [],
          messages: [
            {
              id: "old-user-1",
              sessionId: "old-session",
              role: "user",
              content: "Mensaje optimista de otra sesion",
              messageType: null,
              inputTokens: null,
              outputTokens: null,
              metadata: {},
              createdAt: "2026-01-01T00:00:05Z",
              deliveryStatus: "delivered",
            },
          ],
          pendingUserMessage: {
            id: "old-pending-1",
            sessionId: "old-session",
            role: "user",
            content: "Pendiente de otra sesion",
            messageType: null,
            inputTokens: null,
            outputTokens: null,
            metadata: {},
            createdAt: "2026-01-01T00:00:06Z",
            deliveryStatus: "queued",
          },
        }),
      },
      {
        type: "LOAD_SESSION",
        session: buildStreamingDoneState().session!,
        messages: [
          {
            id: "new-user-1",
            sessionId: "test-session",
            role: "user",
            content: "Mensaje real de la sesion nueva",
            messageType: null,
            inputTokens: null,
            outputTokens: null,
            metadata: {},
            createdAt: "2026-01-01T00:01:00Z",
          },
        ],
      },
    );

    expect(next.sessionId).toBe("test-session");
    expect(
      next.messages.some(
        (message) => message.content === "Mensaje optimista de otra sesion",
      ),
    ).toBe(false);
    expect(next.pendingUserMessage).toBeNull();
    expect(next.messages).toEqual([
      expect.objectContaining({
        id: "new-user-1",
        sessionId: "test-session",
        content: "Mensaje real de la sesion nueva",
      }),
    ]);
  });

  it("mantiene el pendingUserMessage durante la hidratacion si el replay aun no llego", () => {
    const session = buildStreamingDoneState().session!;
    const stateWithPending = buildStreamingDoneState({
      phase: "booting",
      messages: [],
      pendingUserMessage: {
        id: "pending-1",
        sessionId: "test-session",
        role: "user",
        content: "Respuesta pendiente",
        messageType: null,
        inputTokens: null,
        outputTokens: null,
        metadata: {},
        createdAt: "2026-01-01T00:00:10Z",
        deliveryStatus: "queued",
      },
    });

    const next = planningReducer(stateWithPending, {
      type: "LOAD_SESSION",
      session,
      messages: [],
      activeJobStatus: "queued",
    });

    expect(next.pendingUserMessage).toMatchObject({
      content: "Respuesta pendiente",
      deliveryStatus: "queued",
    });
  });
});

describe("RESUME_SESSION", () => {
  it("restores session.awaiting_user as follow-up chat input when resuming", () => {
    const session = {
      ...buildStreamingDoneState().session!,
      status: "interrupted" as const,
    };

    const next = planningReducer(INITIAL_STATE, {
      type: "RESUME_SESSION",
      session,
      messages: [],
      pendingInteraction: {
        id: "interaction-follow-up-resume",
        questionType: "free_text",
        questionText: "¿Cómo quieres continuar con esta planificación?",
        questionContext: { source: "agent_follow_up" },
        expiresAt: "2026-01-01T00:25:00Z",
      },
    });

    expect(next.phase).toBe("chatting");
    expect(next.pendingQuestion).toBeNull();
    expect(next.pendingFollowUp).toBe(true);
    expect(next.followUpPrompt).toBe(
      "¿Cómo quieres continuar con esta planificación?",
    );
    expect(next.expiresAt).toBe("2026-01-01T00:25:00Z");
  });

  it("preserves hydrated generatedItems when resuming from history", () => {
    const session = {
      ...buildStreamingDoneState().session!,
      status: "interrupted" as const,
    };
    const generatedItems = [
      {
        tempId: "33333333-3333-4333-8333-333333333333",
        type: "task" as const,
        title: "Recovered task",
        description: "",
        priority: "medium" as const,
      },
    ];

    const next = planningReducer(INITIAL_STATE, {
      type: "RESUME_SESSION",
      session,
      messages: [],
      generatedItems,
    });

    expect(next.generatedItems).toEqual(generatedItems);
  });

  it("restores pendingInteraction options when resuming a session", () => {
    const session = {
      ...buildStreamingDoneState().session!,
      status: "interrupted" as const,
    };

    const next = planningReducer(INITIAL_STATE, {
      type: "RESUME_SESSION",
      session,
      messages: [],
      pendingInteraction: {
        id: "interaction-4",
        questionType: "choice",
        questionText: "Selecciona la propuesta a continuar",
        questionContext: { source: "agent_question" },
        options: ["Opción 1", "Opción 2"],
        expiresAt: "2026-01-01T00:25:00Z",
      },
    });

    expect(next.phase).toBe("waiting_for_answer");
    expect(next.pendingQuestion).toEqual({
      questionId: "interaction-4",
      questionText: "Selecciona la propuesta a continuar",
      options: ["Opción 1", "Opción 2"],
      questionType: "single_choice",
    });
    expect(next.expiresAt).toBe("2026-01-01T00:25:00Z");
  });

  it("restores structured grouped questions when resuming a session", () => {
    const session = {
      ...buildStreamingDoneState().session!,
      status: "interrupted" as const,
    };

    const next = planningReducer(INITIAL_STATE, {
      type: "RESUME_SESSION",
      session,
      messages: [],
      pendingInteraction: {
        id: "interaction-5",
        questionType: "choice",
        questionText: "Pregunta 1\nPregunta 2",
        questionContext: {
          source: "agent_question",
          questions: [
            { text: "Pregunta 1", options: ["A", "B"] },
            { text: "Pregunta 2", options: ["C"] },
          ],
        },
        options: ["A", "B", "C"],
      },
    });

    expect(next.pendingQuestion).toEqual({
      questionId: "interaction-5",
      questionText: "Pregunta 1\nPregunta 2",
      options: ["A", "B", "C"],
      questions: [
        { text: "Pregunta 1", options: ["A", "B"] },
        { text: "Pregunta 2", options: ["C"] },
      ],
      questionType: "single_choice",
    });
  });

  it("does not restore a stale pendingInteraction when resuming after the questionnaire was answered", () => {
    const session = {
      ...buildStreamingDoneState().session!,
      status: "interrupted" as const,
    };

    const next = planningReducer(INITIAL_STATE, {
      type: "RESUME_SESSION",
      session,
      messages: [
        {
          id: "answer-2",
          sessionId: "test-session",
          role: "user",
          content: "Pregunta 1 → Opcion A\nPregunta 2 → Opcion B",
          messageType: null,
          inputTokens: null,
          outputTokens: null,
          metadata: {},
          createdAt: "2026-01-01T00:00:04Z",
        },
      ],
      pendingInteraction: {
        id: "interaction-stale-resume",
        questionType: "choice",
        questionText: "Pregunta 1\nPregunta 2",
        questionContext: {
          source: "agent_question",
          questions: [
            { text: "Pregunta 1", options: ["Opcion A", "Opcion B"] },
            { text: "Pregunta 2", options: ["Opcion B", "Opcion C"] },
          ],
        },
        options: ["Opcion A", "Opcion B", "Opcion C"],
      },
    });

    expect(next.phase).toBe("chatting");
    expect(next.pendingQuestion).toBeNull();
  });

  it("does not restore a stale pendingInteraction on resume when the answer was only persisted locally", () => {
    const session = {
      ...buildStreamingDoneState().session!,
      status: "interrupted" as const,
    };

    const next = planningReducer(INITIAL_STATE, {
      type: "RESUME_SESSION",
      session,
      messages: [],
      answeredQuestionIds: ["interaction-resume-local-only"],
      pendingInteraction: {
        id: "interaction-resume-local-only",
        questionType: "choice",
        questionText: "Pregunta local reanudada",
        questionContext: { source: "agent_question" },
        options: ["Opcion A", "Opcion B"],
      },
    });

    expect(next.phase).toBe("chatting");
    expect(next.pendingQuestion).toBeNull();
    expect(next.answeredQuestionIds).toEqual([
      "interaction-resume-local-only",
    ]);
  });

  it("no arrastra mensajes optimistas de otra sesion al reanudar", () => {
    const session = {
      ...buildStreamingDoneState().session!,
      status: "interrupted" as const,
    };

    const next = planningReducer(
      {
        ...buildStreamingDoneState({
          phase: "chatting",
          sessionId: "other-session",
          session: {
            ...buildStreamingDoneState().session!,
            id: "other-session",
          },
          streamingContent: "",
          streamingThinkingContent: "",
          streamingBlocks: [],
          messages: [
            {
              id: "other-user-1",
              sessionId: "other-session",
              role: "user",
              content: "Otro mensaje local",
              messageType: null,
              inputTokens: null,
              outputTokens: null,
              metadata: {},
              createdAt: "2026-01-01T00:02:00Z",
            },
          ],
          pendingUserMessage: {
            id: "other-pending-1",
            sessionId: "other-session",
            role: "user",
            content: "Pendiente de otra sesion",
            messageType: null,
            inputTokens: null,
            outputTokens: null,
            metadata: {},
            createdAt: "2026-01-01T00:02:01Z",
            deliveryStatus: "queued",
          },
        }),
      },
      {
        type: "RESUME_SESSION",
        session,
        messages: [],
      },
    );

    expect(next.sessionId).toBe("test-session");
    expect(
      next.messages.some((message) => message.content === "Otro mensaje local"),
    ).toBe(false);
    expect(next.pendingUserMessage).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Sequence-based dedup — out-of-order and duplicate envelope rejection
// ---------------------------------------------------------------------------

describe("Sequence dedup in reducer", () => {
  it("ignores duplicate events with same sequenceNum", () => {
    let state: PlanningSessionState = {
      ...INITIAL_STATE,
      phase: "booting",
      sessionId: "sess-dedup",
    };

    // First RECEIVE_TEXT with sequenceNum=0 is accepted
    state = planningReducer(state, {
      type: "RECEIVE_TEXT",
      content: "First chunk",
      sequenceNum: 0,
    });
    expect(state.streamingContent).toBe("First chunk");
    expect(state.lastSeenSequenceNum).toBe(0);

    // Duplicate RECEIVE_TEXT with same sequenceNum=0 is ignored
    state = planningReducer(state, {
      type: "RECEIVE_TEXT",
      content: "Duplicate chunk",
      sequenceNum: 0,
    });
    expect(state.streamingContent).toBe("First chunk");
    expect(state.lastSeenSequenceNum).toBe(0);
  });

  it("ignores out-of-order events", () => {
    let state: PlanningSessionState = {
      ...INITIAL_STATE,
      phase: "booting",
      sessionId: "sess-ooo",
    };

    // Accept seq=5
    state = planningReducer(state, {
      type: "RECEIVE_TEXT",
      content: "Chunk at 5",
      sequenceNum: 5,
    });
    expect(state.streamingContent).toBe("Chunk at 5");
    expect(state.lastSeenSequenceNum).toBe(5);

    // seq=3 is out-of-order — rejected
    state = planningReducer(state, {
      type: "RECEIVE_TEXT",
      content: "Out-of-order chunk at 3",
      sequenceNum: 3,
    });
    expect(state.streamingContent).toBe("Chunk at 5");
    expect(state.lastSeenSequenceNum).toBe(5);

    // seq=6 is accepted (forward progress)
    state = planningReducer(state, {
      type: "RECEIVE_TEXT",
      content: " and 6",
      sequenceNum: 6,
    });
    expect(state.streamingContent).toBe("Chunk at 5 and 6");
    expect(state.lastSeenSequenceNum).toBe(6);
  });

  it("processes events without sequenceNum (backward compat)", () => {
    let state: PlanningSessionState = {
      ...INITIAL_STATE,
      phase: "booting",
      sessionId: "sess-compat",
    };

    // Events without sequenceNum are always accepted
    state = planningReducer(state, {
      type: "RECEIVE_TEXT",
      content: "No seq 1",
    });
    expect(state.streamingContent).toBe("No seq 1");

    state = planningReducer(state, {
      type: "RECEIVE_TEXT",
      content: " No seq 2",
    });
    expect(state.streamingContent).toBe("No seq 1 No seq 2");

    // lastSeenSequenceNum stays at -1 (no advancement)
    expect(state.lastSeenSequenceNum).toBe(-1);
  });

  it("resets lastSeenSequenceNum on START_STREAMING", () => {
    let state: PlanningSessionState = {
      ...INITIAL_STATE,
      phase: "booting",
      sessionId: "sess-reset",
    };

    // Advance the sequence counter
    state = planningReducer(state, {
      type: "RECEIVE_TEXT",
      content: "First turn",
      sequenceNum: 10,
    });
    expect(state.lastSeenSequenceNum).toBe(10);

    // Graduate and start new turn
    state = planningReducer(state, { type: "RECEIVE_RESPONSE_COMPLETE" });
    state = planningReducer(state, { type: "ADD_USER_MESSAGE", content: "Next" });
    state = planningReducer(state, { type: "START_STREAMING" });

    // Sequence counter reset for new turn
    expect(state.lastSeenSequenceNum).toBe(-1);

    // Now seq=0 is accepted again
    state = planningReducer(state, {
      type: "RECEIVE_TEXT",
      content: "Second turn",
      sequenceNum: 0,
    });
    expect(state.streamingContent).toBe("Second turn");
    expect(state.lastSeenSequenceNum).toBe(0);
  });

  it("descarta la retransmisión del run anterior tras START_STREAMING cuando el job no cambió", () => {
    let state: PlanningSessionState = {
      ...INITIAL_STATE,
      phase: "booting",
      sessionId: "sess-job-boundary",
    };

    // Turn 1: events from job-1 advance the per-job sequence
    state = planningReducer(state, {
      type: "RECEIVE_TEXT",
      content: "First turn",
      sequenceNum: 41,
      jobId: "job-1",
    });
    state = planningReducer(state, {
      type: "RECEIVE_TEXT",
      content: " tail",
      sequenceNum: 42,
      jobId: "job-1",
    });
    expect(state.streamingContent).toBe("First turn tail");

    // Turn boundary: response complete + new prompt
    state = planningReducer(state, { type: "RECEIVE_RESPONSE_COMPLETE" });
    state = planningReducer(state, { type: "ADD_USER_MESSAGE", content: "Next" });
    state = planningReducer(state, { type: "START_STREAMING" });
    expect(state.lastSeenSequenceNum).toBe(-1);

    // A WS replay retransmits an old event of the same job — must be ignored
    // even though lastSeenSequenceNum was reset for the new turn.
    state = planningReducer(state, {
      type: "RECEIVE_TEXT",
      content: "First turn tail",
      sequenceNum: 42,
      jobId: "job-1",
    });
    expect(state.streamingContent).toBe("");

    // The same job continuing into the new turn (higher seq) is accepted
    state = planningReducer(state, {
      type: "RECEIVE_TEXT",
      content: "Second turn",
      sequenceNum: 43,
      jobId: "job-1",
    });
    expect(state.streamingContent).toBe("Second turn");
    expect(state.lastSeenSequenceNum).toBe(43);
  });

  it("acepta un run nuevo que reinicia la numeración en seq 0 y sigue descartando el run viejo", () => {
    let state: PlanningSessionState = {
      ...INITIAL_STATE,
      phase: "booting",
      sessionId: "sess-new-run",
    };

    state = planningReducer(state, {
      type: "RECEIVE_TEXT",
      content: "Old run",
      sequenceNum: 42,
      jobId: "job-1",
    });
    expect(state.streamingContent).toBe("Old run");

    state = planningReducer(state, { type: "RECEIVE_RESPONSE_COMPLETE" });
    state = planningReducer(state, { type: "ADD_USER_MESSAGE", content: "Next" });
    state = planningReducer(state, { type: "START_STREAMING" });

    // New job legitimately restarts the per-job numbering at 0 → accepted
    state = planningReducer(state, {
      type: "RECEIVE_TEXT",
      content: "New run",
      sequenceNum: 0,
      jobId: "job-2",
    });
    expect(state.streamingContent).toBe("New run");
    expect(state.lastSeenSequenceNum).toBe(0);

    // A late retransmission from the previous run must still be dropped
    state = planningReducer(state, {
      type: "RECEIVE_TEXT",
      content: "Old run replayed",
      sequenceNum: 40,
      jobId: "job-1",
    });
    expect(state.streamingContent).toBe("New run");
    expect(state.lastSeenSequenceNum).toBe(0);

    // The new run keeps streaming normally
    state = planningReducer(state, {
      type: "RECEIVE_TEXT",
      content: " continues",
      sequenceNum: 1,
      jobId: "job-2",
    });
    expect(state.streamingContent).toBe("New run continues");
  });

  it("applies dedup to RECEIVE_THINKING as well", () => {
    let state: PlanningSessionState = {
      ...INITIAL_STATE,
      phase: "booting",
      sessionId: "sess-thinking-dedup",
    };

    state = planningReducer(state, {
      type: "RECEIVE_THINKING",
      content: "Think 1",
      sequenceNum: 0,
    });
    expect(state.streamingThinkingContent).toBe("Think 1");

    // Duplicate thinking event at seq=0 is rejected
    state = planningReducer(state, {
      type: "RECEIVE_THINKING",
      content: "Think 1 again",
      sequenceNum: 0,
    });
    expect(state.streamingThinkingContent).toBe("Think 1");
  });

  it("applies dedup to RECEIVE_TOOL_CALL_START", () => {
    let state: PlanningSessionState = {
      ...INITIAL_STATE,
      phase: "streaming",
      sessionId: "sess-tool-dedup",
    };

    state = planningReducer(state, {
      type: "RECEIVE_TOOL_CALL_START",
      toolCallId: "tc-1",
      toolName: "Read",
      inputPreview: "file.ts",
      sequenceNum: 5,
    });
    expect(state.streamingBlocks).toHaveLength(1);
    expect(state.lastSeenSequenceNum).toBe(5);

    // Duplicate at seq=5 is rejected — no new block created
    state = planningReducer(state, {
      type: "RECEIVE_TOOL_CALL_START",
      toolCallId: "tc-2",
      toolName: "Write",
      inputPreview: "other.ts",
      sequenceNum: 5,
    });
    expect(state.streamingBlocks).toHaveLength(1);
    expect(state.lastSeenSequenceNum).toBe(5);
  });

  it("RECEIVE_SUBAGENT_SPAWN deduplica por subagentId y enriquece el bloque existente", () => {
    let state: PlanningSessionState = {
      ...INITIAL_STATE,
      phase: "streaming",
      sessionId: "sess-subagent-dedup",
    };

    // Fallback spawn with minimal data (e.g. enrichment never arrived)
    state = planningReducer(state, {
      type: "RECEIVE_SUBAGENT_SPAWN",
      subagentId: "sa-1",
      description: "Agent",
      isBackground: false,
      sequenceNum: 0,
    });
    expect(state.streamingBlocks).toHaveLength(1);

    // Idempotent re-emission with the same subagentId (enriched data) —
    // must UPDATE the existing block, never create a duplicate.
    state = planningReducer(state, {
      type: "RECEIVE_SUBAGENT_SPAWN",
      subagentId: "sa-1",
      description: "Explorar el runner",
      isBackground: false,
      subagentType: "backend-architect",
      sequenceNum: 1,
    });
    expect(state.streamingBlocks).toHaveLength(1);
    const block = state.streamingBlocks[0];
    expect(block.type).toBe("subagent");
    if (block.type === "subagent") {
      expect(block.subagentId).toBe("sa-1");
      expect(block.description).toBe("Explorar el runner");
      expect(block.subagentType).toBe("backend-architect");
    }

    // A different subagentId does create a second block
    state = planningReducer(state, {
      type: "RECEIVE_SUBAGENT_SPAWN",
      subagentId: "sa-2",
      description: "Otro agente",
      isBackground: true,
      sequenceNum: 2,
    });
    expect(state.streamingBlocks).toHaveLength(2);
  });

  it("dedup works across mixed event types sharing the same sequence space", () => {
    let state: PlanningSessionState = {
      ...INITIAL_STATE,
      phase: "booting",
      sessionId: "sess-mixed",
    };

    // seq=0: text
    state = planningReducer(state, {
      type: "RECEIVE_TEXT",
      content: "Hello",
      sequenceNum: 0,
    });
    expect(state.lastSeenSequenceNum).toBe(0);

    // seq=1: thinking
    state = planningReducer(state, {
      type: "RECEIVE_THINKING",
      content: "Hmm",
      sequenceNum: 1,
    });
    expect(state.lastSeenSequenceNum).toBe(1);

    // Replay of seq=0 (text) is dropped
    state = planningReducer(state, {
      type: "RECEIVE_TEXT",
      content: "Hello again",
      sequenceNum: 0,
    });
    expect(state.streamingContent).toBe("Hello");

    // seq=2: tool call is accepted
    state = planningReducer(state, {
      type: "RECEIVE_TOOL_CALL_START",
      toolCallId: "tc-1",
      toolName: "Read",
      sequenceNum: 2,
    });
    expect(state.lastSeenSequenceNum).toBe(2);
    expect(state.streamingBlocks).toHaveLength(3); // text + thinking + tool_call
  });
});

describe("planningReducer wave lifecycle", () => {
  it("marks pending wave agents done when the wave-end event completes the wave", () => {
    let state = planningReducer(INITIAL_STATE, {
      type: "RECEIVE_WAVE_START",
      agents: [
        { id: "A-1", name: "frontend", role: "Fix markdown" },
        { id: "A-2", name: "qa", role: "Verify" },
      ],
    });

    state = planningReducer(state, {
      type: "RECEIVE_AGENT_DONE",
      agentId: "A-1",
      success: true,
    });

    state = planningReducer(state, {
      type: "RECEIVE_WAVE_END",
      successCount: 2,
      totalCount: 2,
    });

    expect(state.waveInfo?.agents).toEqual([
      { id: "A-1", name: "frontend", role: "Fix markdown", done: true, success: true },
      { id: "A-2", name: "qa", role: "Verify", done: true, success: true },
    ]);
  });
});
