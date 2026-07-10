import { describe, expect, it } from "bun:test";
import { buildWaveMarkerCommand } from "@almirant/canonical-events";
import { createSseCanonicalAdapter } from "./sse-canonical-adapter";
import { runtimeEventFixtures } from "../../test/fixtures/runtime-event-contract-fixtures";

const createSseEvent = (type: string, properties: Record<string, unknown>) => ({
  data: JSON.stringify({ type, properties }),
});

describe("createSseCanonicalAdapter", () => {
  for (const fixture of runtimeEventFixtures) {
    it(`mapea el contrato SSE de ${fixture.runtime} al flujo canónico esperado`, () => {
      const adapter = createSseCanonicalAdapter();
      const events = fixture.sseEvents.flatMap((event) => adapter.processEvent(event));

      expect(events).toHaveLength(fixture.expectedCanonicalEvents.length);
      fixture.expectedCanonicalEvents.forEach((expectedEvent, index) => {
        expect(events[index]).toMatchObject(expectedEvent);
      });
      expect(adapter.hasActiveBackgroundAgents()).toBe(false);
      expect(adapter.flush()).toEqual([]);
    });
  }

  it("normaliza preguntas estructuradas y permisos sin depender del runtime", () => {
    const adapter = createSseCanonicalAdapter();

    const questionEvents = adapter.processEvent(
      createSseEvent("question.asked", {
        text: "Selecciona el alcance",
        options: [{ label: "Pequeño", description: "Cambio acotado" }],
        questions: [
          {
            question: "¿Quieres incluir fixtures?",
            options: [
              { value: "si", description: "Con golden files" },
              "no",
            ],
          },
        ],
      }),
    );
    const permissionEvents = adapter.processEvent(
      createSseEvent("permission.asked", {
        tool: "Bash",
        description: "Necesita ejecutar pruebas",
      }),
    );

    expect(questionEvents).toEqual([
      {
        kind: "agent.question",
        questionText: "Selecciona el alcance",
        options: ["Pequeño::Cambio acotado"],
        questions: [
          {
            text: "¿Quieres incluir fixtures?",
            options: ["si::Con golden files", "no"],
          },
        ],
        questionType: "single_choice",
      },
    ]);
    expect(permissionEvents).toEqual([
      {
        kind: "agent.permission.request",
        toolName: "Bash",
        description: "Necesita ejecutar pruebas",
      },
    ]);
  });

  it("mantiene background subagents activos hasta su completion explícita", () => {
    const adapter = createSseCanonicalAdapter();
    const spawn = adapter.processEvent(
      createSseEvent("agent.subagent.spawn", {
        kind: "agent.subagent.spawn",
        subagentId: "bg-1",
        description: "Fixture batch",
        isBackground: true,
      }),
    );
    const idle = adapter.processEvent(
      createSseEvent("session.idle", {
        kind: "session.idle",
        hasBackgroundAgents: true,
        isPlanningJob: false,
      }),
    );
    const resume = adapter.processEvent(
      createSseEvent("message.part.delta", {
        contentType: "text",
        delta: "reanudado",
      }),
    );
    const complete = adapter.processEvent(
      createSseEvent("agent.subagent.complete", {
        kind: "agent.subagent.complete",
        subagentId: "bg-1",
        success: true,
      }),
    );

    expect(spawn).toEqual([
      {
        kind: "agent.subagent.spawn",
        subagentId: "bg-1",
        description: "Fixture batch",
        isBackground: true,
      },
    ]);
    expect(idle.at(-1)).toEqual({
      kind: "session.idle",
      hasBackgroundAgents: true,
      isPlanningJob: false,
    });
    expect(resume).toEqual([{ kind: "agent.text", content: "reanudado" }]);
    expect(adapter.hasActiveBackgroundAgents()).toBe(false);
    expect(complete).toEqual([
      {
        kind: "agent.subagent.complete",
        subagentId: "bg-1",
        success: true,
      },
    ]);
  });

  it("mapea reasoning de OpenCode por partID a agent.thinking y no duplica snapshots", () => {
    const adapter = createSseCanonicalAdapter();
    const reasoningPart = {
      id: "part-reasoning-1",
      sessionID: "ses-1",
      messageID: "msg-1",
      type: "reasoning",
      text: "",
      time: { start: 1 },
    };

    expect(
      adapter.processEvent(
        createSseEvent("message.part.updated", {
          sessionID: "ses-1",
          part: reasoningPart,
          time: 1,
        }),
      ),
    ).toEqual([]);

    expect(
      adapter.processEvent(
        createSseEvent("message.part.delta", {
          sessionID: "ses-1",
          messageID: "msg-1",
          partID: "part-reasoning-1",
          field: "text",
          delta: "Voy a revisar el flujo.",
        }),
      ),
    ).toEqual([
      {
        kind: "agent.thinking",
        content: "Voy a revisar el flujo.",
      },
    ]);

    expect(
      adapter.processEvent(
        createSseEvent("message.part.updated", {
          sessionID: "ses-1",
          part: {
            ...reasoningPart,
            text: "Voy a revisar el flujo.",
            time: { start: 1, end: 2 },
          },
          time: 2,
        }),
      ),
    ).toEqual([]);
  });

  it("adapta tool parts de OpenCode a tool_call, bash y result canónicos", () => {
    const adapter = createSseCanonicalAdapter();
    const toolPartBase = {
      id: "part-tool-bash",
      sessionID: "ses-1",
      messageID: "msg-1",
      type: "tool",
      callID: "call-bash-1",
      tool: "bash",
    };

    const runningEvents = adapter.processEvent(
      createSseEvent("message.part.updated", {
        sessionID: "ses-1",
        part: {
          ...toolPartBase,
          state: {
            status: "running",
            input: {
              command: "bun test services/runner/src/session/sse-canonical-adapter.test.ts",
              description: "Ejecutar tests del adaptador SSE",
            },
            title: "Ejecutar tests",
            time: { start: 1 },
          },
        },
        time: 1,
      }),
    );

    expect(runningEvents).toEqual([
      {
        kind: "agent.tool_call.start",
        toolName: "Bash",
        toolCallId: "call-bash-1",
        inputPreview:
          "command: bun test services/runner/src/session/sse-canonical-adapter.test.ts",
      },
      {
        kind: "agent.bash.execute",
        toolCallId: "call-bash-1",
        command: "bun test services/runner/src/session/sse-canonical-adapter.test.ts",
        description: "Ejecutar tests del adaptador SSE",
      },
    ]);

    const completedEvents = adapter.processEvent(
      createSseEvent("message.part.updated", {
        sessionID: "ses-1",
        part: {
          ...toolPartBase,
          state: {
            status: "completed",
            input: {
              command: "bun test services/runner/src/session/sse-canonical-adapter.test.ts",
              description: "Ejecutar tests del adaptador SSE",
            },
            output: "ok",
            title: "Ejecutar tests",
            metadata: {},
            time: { start: 1, end: 2 },
          },
        },
        time: 2,
      }),
    );

    expect(completedEvents).toEqual([
      {
        kind: "agent.tool_call.result",
        toolCallId: "call-bash-1",
        toolName: "Bash",
        success: true,
      },
    ]);
  });

  it("normaliza tools OpenCode de archivos a eventos especializados", () => {
    const adapter = createSseCanonicalAdapter();

    const readEvents = adapter.processEvent(
      createSseEvent("message.part.updated", {
        sessionID: "ses-1",
        part: {
          id: "part-read",
          sessionID: "ses-1",
          messageID: "msg-1",
          type: "tool",
          callID: "call-read-1",
          tool: "read",
          state: {
            status: "running",
            input: {
              filePath: "services/runner/src/session/sse-canonical-adapter.ts",
              offset: "10",
              limit: "20",
            },
            time: { start: 1 },
          },
        },
      }),
    );
    const editEvents = adapter.processEvent(
      createSseEvent("message.part.updated", {
        sessionID: "ses-1",
        part: {
          id: "part-edit",
          sessionID: "ses-1",
          messageID: "msg-1",
          type: "tool",
          callID: "call-edit-1",
          tool: "edit",
          state: {
            status: "running",
            input: {
              filePath: "services/runner/src/session/sse-canonical-adapter.ts",
            },
            time: { start: 2 },
          },
        },
      }),
    );

    expect(readEvents).toEqual([
      {
        kind: "agent.tool_call.start",
        toolName: "Read",
        toolCallId: "call-read-1",
        inputPreview:
          "filePath: services/runner/src/session/sse-canonical-adapter.ts",
      },
      {
        kind: "agent.file.read",
        toolCallId: "call-read-1",
        filePath: "services/runner/src/session/sse-canonical-adapter.ts",
        lineRange: "10-20",
      },
    ]);
    expect(editEvents).toEqual([
      {
        kind: "agent.tool_call.start",
        toolName: "Edit",
        toolCallId: "call-edit-1",
        inputPreview:
          "filePath: services/runner/src/session/sse-canonical-adapter.ts",
      },
      {
        kind: "agent.file.edit",
        toolCallId: "call-edit-1",
        filePath: "services/runner/src/session/sse-canonical-adapter.ts",
      },
    ]);
  });

  it("adapta task tool de OpenCode a subagent spawn y mantiene background activo", () => {
    const adapter = createSseCanonicalAdapter();

    const events = adapter.processEvent(
      createSseEvent("message.part.updated", {
        sessionID: "ses-1",
        part: {
          id: "part-task",
          sessionID: "ses-1",
          messageID: "msg-1",
          type: "tool",
          callID: "call-task-1",
          tool: "task",
          state: {
            status: "running",
            input: {
              description: "Investigar la base de datos",
              prompt: "Revisa los eventos nativos de OpenCode",
              subagent_type: "backend-architect",
              run_in_background: true,
            },
            time: { start: 1 },
          },
        },
      }),
    );

    expect(events).toEqual([
      {
        kind: "agent.tool_call.start",
        toolName: "Task",
        toolCallId: "call-task-1",
        inputPreview:
          "subagent_type: backend-architect | description: Investigar la base de datos",
      },
      {
        kind: "agent.subagent.spawn",
        subagentId: "call-task-1",
        description: "Investigar la base de datos",
        isBackground: true,
        subagentType: "backend-architect",
      },
    ]);
    expect(adapter.hasActiveBackgroundAgents()).toBe(true);

    expect(
      adapter.processEvent(
        createSseEvent("message.part.updated", {
          sessionID: "ses-1",
          part: {
            id: "part-task",
            sessionID: "ses-1",
            messageID: "msg-1",
            type: "tool",
            callID: "call-task-1",
            tool: "task",
            state: {
              status: "completed",
              input: {
                description: "Investigar la base de datos",
                prompt: "Revisa los eventos nativos de OpenCode",
                subagent_type: "backend-architect",
                run_in_background: true,
              },
              output: "hecho",
              title: "Task done",
              metadata: {},
              time: { start: 1, end: 2 },
            },
          },
          time: 2,
        }),
      ),
    ).toEqual([
      {
        kind: "agent.tool_call.result",
        toolCallId: "call-task-1",
        toolName: "Task",
        success: true,
      },
    ]);
    expect(adapter.hasActiveBackgroundAgents()).toBe(true);
  });

  it("emite agent.summary cuando el texto final contiene un bloque ## Summary", () => {
    const adapter = createSseCanonicalAdapter();
    const fullText =
      "Trabajé en la regresión.\n\n## Summary\n- Añadí tipo canónico\n- Cableé emisión\n";

    adapter.processEvent(
      createSseEvent("message.part.updated", {
        part: { text: fullText },
        contentType: "text",
      }),
    );
    const idleEvents = adapter.processEvent(
      createSseEvent("session.idle", {}),
    );

    const summaryEvent = idleEvents.find((event) => event.kind === "agent.summary");
    expect(summaryEvent).toBeDefined();
    if (summaryEvent && summaryEvent.kind === "agent.summary") {
      expect(summaryEvent.section).toBe("Summary");
      expect(summaryEvent.text).toContain("- Añadí tipo canónico");
      expect(summaryEvent.text).toContain("- Cableé emisión");
    }

    const idleIndex = idleEvents.findIndex((event) => event.kind === "session.idle");
    const summaryIndex = idleEvents.findIndex((event) => event.kind === "agent.summary");
    expect(summaryIndex).toBeGreaterThanOrEqual(0);
    expect(summaryIndex).toBeLessThan(idleIndex);
  });

  it("emite agent.summary con section Resumen cuando el bloque final está en español", () => {
    const adapter = createSseCanonicalAdapter();
    adapter.processEvent(
      createSseEvent("message.part.updated", {
        part: { text: "Listo.\n\n## Resumen\nTodo OK." },
        contentType: "text",
      }),
    );
    const idleEvents = adapter.processEvent(createSseEvent("session.idle", {}));
    const summaryEvent = idleEvents.find((event) => event.kind === "agent.summary");
    expect(summaryEvent).toBeDefined();
    if (summaryEvent && summaryEvent.kind === "agent.summary") {
      expect(summaryEvent.section).toBe("Resumen");
    }
  });

  it("no emite agent.summary cuando el texto final no contiene bloque de resumen", () => {
    const adapter = createSseCanonicalAdapter();
    adapter.processEvent(
      createSseEvent("message.part.updated", {
        part: { text: "Cambios aplicados sin sección de resumen." },
        contentType: "text",
      }),
    );
    const idleEvents = adapter.processEvent(createSseEvent("session.idle", {}));
    expect(idleEvents.find((event) => event.kind === "agent.summary")).toBeUndefined();
  });

  it("emite agent.summary cuando solo hay deltas agent.text (sin message.part.updated)", () => {
    const adapter = createSseCanonicalAdapter();

    // Streamed deltas only (Claude Code path: no message.part.updated snapshot).
    for (const delta of [
      "Trabajo terminado.\n\n",
      "## Summary\n",
      "- A\n",
      "- B",
    ]) {
      adapter.processEvent(
        createSseEvent("message.part.delta", {
          partType: "text",
          delta,
        }),
      );
    }
    const idleEvents = adapter.processEvent(createSseEvent("session.idle", {}));

    const summaryEvent = idleEvents.find((event) => event.kind === "agent.summary");
    expect(summaryEvent).toBeDefined();
    if (summaryEvent && summaryEvent.kind === "agent.summary") {
      expect(summaryEvent.section).toBe("Summary");
      expect(summaryEvent.text).toContain("- A");
      expect(summaryEvent.text).toContain("- B");
    }

    // Order: summary BEFORE idle.
    const summaryIdx = idleEvents.findIndex((event) => event.kind === "agent.summary");
    const idleIdx = idleEvents.findIndex((event) => event.kind === "session.idle");
    expect(summaryIdx).toBeGreaterThanOrEqual(0);
    expect(summaryIdx).toBeLessThan(idleIdx);
  });

  it("emite agent.summary una sola vez aunque haya varios text.complete", () => {
    const adapter = createSseCanonicalAdapter();
    adapter.processEvent(
      createSseEvent("message.part.updated", {
        part: { text: "primer paso\n\n## Summary\nWIP" },
        contentType: "text",
      }),
    );
    adapter.processEvent(
      createSseEvent("message.part.updated", {
        part: { text: "trabajo final\n\n## Summary\nlisto" },
        contentType: "text",
      }),
    );
    const idleEvents = adapter.processEvent(createSseEvent("session.idle", {}));
    const summaryEvents = idleEvents.filter((event) => event.kind === "agent.summary");
    expect(summaryEvents).toHaveLength(1);
    if (summaryEvents[0]?.kind === "agent.summary") {
      expect(summaryEvents[0].text).toContain("listo");
    }
  });

  it("emite spawn de fallback en content_block_stop cuando el enrichment nunca llega", () => {
    const adapter = createSseCanonicalAdapter();

    // content_block_start: initial delta only carries {name, id} — poor data,
    // no early spawn yet (avoids the confusing "Agent" flash).
    const startEvents = adapter.processEvent(
      createSseEvent("message.part.delta", {
        partType: "tool_use",
        delta: JSON.stringify({ name: "Agent", id: "agent-oom-1" }),
      }),
    );
    expect(startEvents.filter((e) => e.kind === "agent.tool_call.start")).toHaveLength(1);
    expect(startEvents.filter((e) => e.kind === "agent.subagent.spawn")).toHaveLength(0);

    // content_block_stop: the shim re-emits the full tool JSON with an "input"
    // key, but the input is empty (OOM/stream cut — input_json_delta never
    // accumulated). This is the LAST reliable signal for this tool call, so a
    // minimal fallback spawn must be emitted here instead of omitting it.
    const stopEvents = adapter.processEvent(
      createSseEvent("message.part.delta", {
        partType: "tool_use",
        delta: JSON.stringify({ name: "Agent", id: "agent-oom-1", input: {} }),
      }),
    );
    const spawns = stopEvents.filter((e) => e.kind === "agent.subagent.spawn");
    expect(spawns).toHaveLength(1);
    expect(spawns[0]).toMatchObject({
      subagentId: "agent-oom-1",
      isBackground: false,
    });
    // tool_call.start stays unique per toolCallId — no duplicate on the stop delta
    expect(stopEvents.filter((e) => e.kind === "agent.tool_call.start")).toHaveLength(0);
  });

  it("delta enriquecido emite exactamente 1 spawn y la re-emisión es idempotente con el mismo subagentId", () => {
    const adapter = createSseCanonicalAdapter();

    // Poor initial delta → no early spawn
    const startEvents = adapter.processEvent(
      createSseEvent("message.part.delta", {
        partType: "tool_use",
        delta: JSON.stringify({ name: "Task", id: "task-rich-1" }),
      }),
    );
    expect(startEvents.filter((e) => e.kind === "agent.subagent.spawn")).toHaveLength(0);

    // Enriched delta (content_block_stop with full input) → exactly 1 spawn
    const enrichedEvents = adapter.processEvent(
      createSseEvent("message.part.delta", {
        partType: "tool_use",
        delta: JSON.stringify({
          name: "Task",
          id: "task-rich-1",
          input: {
            description: "Explorar el runner",
            subagent_type: "backend-architect",
          },
        }),
      }),
    );
    const enrichedSpawns = enrichedEvents.filter((e) => e.kind === "agent.subagent.spawn");
    expect(enrichedSpawns).toHaveLength(1);
    expect(enrichedSpawns[0]).toMatchObject({
      subagentId: "task-rich-1",
      description: "Explorar el runner",
      subagentType: "backend-architect",
    });

    // Flush (transition to text) re-emits the spawn with the SAME subagentId —
    // the frontend deduplicates by subagentId and just updates the block.
    const flushEvents = adapter.processEvent(
      createSseEvent("message.part.delta", {
        partType: "text",
        delta: "listo",
      }),
    );
    const reEmittedSpawns = flushEvents.filter((e) => e.kind === "agent.subagent.spawn");
    for (const spawn of reEmittedSpawns) {
      expect(spawn).toMatchObject({ subagentId: "task-rich-1" });
    }
  });

  it("marca errores recoverable aunque el tool_use pendiente no llegue a emitirse", () => {
    const adapter = createSseCanonicalAdapter();
    adapter.processEvent(
      createSseEvent("message.part.delta", {
        partType: "tool_use",
        delta: JSON.stringify({
          name: "Read",
          id: "tool-1",
          input: { file_path: "/tmp/file.txt" },
        }),
      }),
    );

    const events = adapter.processEvent(
      createSseEvent("session.error", {
        error: {
          data: {
            message: "sqlite database is full",
          },
        },
      }),
    );

    expect(events).toEqual([
      {
        kind: "session.error",
        message: "sqlite database is full",
        recoverable: true,
      },
    ]);
  });

  const runBashMarker = (command: string) => {
    const adapter = createSseCanonicalAdapter();
    return adapter.processEvent(
      createSseEvent("message.part.updated", {
        sessionID: "ses-wave",
        part: {
          id: "part-wave",
          sessionID: "ses-wave",
          messageID: "msg-wave",
          type: "tool",
          callID: "call-wave-1",
          tool: "bash",
          state: {
            status: "running",
            input: { command },
            time: { start: 1 },
          },
        },
        time: 1,
      }),
    );
  };

  it("mapea un marcador wave.start de Bash a agent.wave.start (sin bash.execute)", () => {
    const events = runBashMarker(
      buildWaveMarkerCommand({
        type: "wave.start",
        agents: [
          { agent: "frontend-developer", taskId: "A-425", title: "Drawer" },
          { agent: "backend-architect", taskId: "A-426", title: "API" },
        ],
      }),
    );

    expect(events).toContainEqual({
      kind: "agent.wave.start",
      agents: [
        { agent: "frontend-developer", taskId: "A-425", title: "Drawer" },
        { agent: "backend-architect", taskId: "A-426", title: "API" },
      ],
    });
    expect(events.some((e) => e.kind === "agent.bash.execute")).toBe(false);
  });

  it("mapea un marcador wave.agent_done de Bash a agent.wave.agent_done", () => {
    const events = runBashMarker(
      buildWaveMarkerCommand({
        type: "wave.agent_done",
        agent: "backend-architect",
        taskId: "A-426",
        success: false,
        reason: "type error",
      }),
    );

    expect(events).toContainEqual({
      kind: "agent.wave.agent_done",
      agent: "backend-architect",
      taskId: "A-426",
      success: false,
      reason: "type error",
    });
  });

  it("mapea un marcador wave.end de Bash a agent.wave.end", () => {
    const events = runBashMarker(
      buildWaveMarkerCommand({ type: "wave.end", successCount: 1, totalCount: 2 }),
    );

    expect(events).toContainEqual({
      kind: "agent.wave.end",
      successCount: 1,
      totalCount: 2,
    });
  });
});
