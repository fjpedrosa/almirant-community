import { describe, expect, it } from "bun:test";
import type { AgentSessionListItem } from "./types";
import {
  formatDuration,
  resolveSessionDisplayTitle,
  resolveSessionLauncherIdentity,
} from "./utils";

const makeSession = (
  overrides: Partial<AgentSessionListItem> = {},
): AgentSessionListItem => ({
  id: "job-1",
  workItemId: null,
  projectId: null,
  boardId: null,
  planningSessionId: null,
  jobType: "implementation",
  status: "queued",
  provider: "claude-code",
  codingAgent: "claude-code",
  model: null,
  priority: "medium",
  branchName: null,
  prUrl: null,
  prNumber: null,
  cost: null,
  tokensUsed: null,
  durationMs: null,
  errorMessage: null,
  sessionId: null,
  config: {},
  result: null,
  createdAt: "2026-04-12T09:00:00.000Z",
  startedAt: null,
  completedAt: null,
  failedAt: null,
  workItemTitle: null,
  workItemTaskId: null,
  projectName: null,
  boardName: null,
  planningSessionTitle: null,
  triggerType: "event",
  createdByUserId: null,
  createdByUserName: null,
  createdByUserImage: null,
  requestedByUserName: null,
  requestedByUserImage: null,
  ...overrides,
});

describe("resolveSessionLauncherIdentity", () => {
  it("prioriza el usuario creador cuando existe", () => {
    expect(
      resolveSessionLauncherIdentity(
        makeSession({ createdByUserName: "Jane Doe", createdByUserImage: "https://img.test/jane.png" }),
      ),
    ).toEqual({
      kind: "user",
      label: "Jane Doe",
      imageUrl: "https://img.test/jane.png",
    });
  });

  it("marca como bot una sesión lanzada por worker sin creador humano", () => {
    expect(
      resolveSessionLauncherIdentity(
        makeSession({ config: { source: "worker" } }),
      ),
    ).toEqual({
      kind: "bot",
      label: "Almirant[bot]",
      imageUrl: null,
    });
  });

  it("no marca como bot una sesión de Discord sin usuario interno enlazado", () => {
    expect(
      resolveSessionLauncherIdentity(
        makeSession({
          config: {
            requesterDiscordUserId: "discord-user-1",
          },
        }),
      ),
    ).toBeNull();
  });

  it("marca como bot un job disparado por el cron (triggerType scheduled) sin creador humano", () => {
    expect(
      resolveSessionLauncherIdentity(
        makeSession({
          triggerType: "scheduled",
          config: { source: "scheduled" },
        }),
      ),
    ).toEqual({
      kind: "bot",
      label: "Almirant[bot]",
      imageUrl: null,
    });
  });

  it("atribuye al usuario un trigger manual aunque el source sea 'scheduled'", () => {
    // Un scheduled agent disparado manualmente desde la UI: triggerType pasa
    // a "event" y createdByUserId identifica al humano. El source de la config
    // sigue siendo "scheduled" porque el job salió de una config programada.
    expect(
      resolveSessionLauncherIdentity(
        makeSession({
          triggerType: "event",
          createdByUserId: "user-42",
          createdByUserName: "Jane Doe",
          config: { source: "scheduled" },
        }),
      ),
    ).toEqual({
      kind: "user",
      label: "Jane Doe",
      imageUrl: null,
    });
  });

  it("atribuye al usuario aunque el nombre no esté disponible, si hay createdByUserId", () => {
    expect(
      resolveSessionLauncherIdentity(
        makeSession({
          triggerType: "event",
          createdByUserId: "user-42",
          createdByUserName: null,
        }),
      ),
    ).toEqual({
      kind: "user",
      label: "Usuario",
      imageUrl: null,
    });
  });

  it("atribuye al requester humano cuando el job está creado por auto-fix-bot pero config.requestedByUserId apunta a un usuario", () => {
    // Admin "Launch investigation": el job se atribuye al bot para que el
    // backend emita un mcp:internal token, pero el humano que apretó el botón
    // vive en config.requestedByUserId. La UI debe mostrar al humano con el
    // sufijo "via Auto-Fix" para señalar el flujo auto-fix manteniendo trazabilidad.
    expect(
      resolveSessionLauncherIdentity(
        makeSession({
          triggerType: "event",
          createdByUserId: "auto-fix-bot",
          createdByUserName: "Auto-Fix Bot",
          createdByUserImage: "https://img.test/bot.png",
          requestedByUserName: "User Admin",
          requestedByUserImage: "https://img.test/admin.png",
          config: { requestedByUserId: "user-admin-1" },
        }),
      ),
    ).toEqual({
      kind: "user",
      label: "User Admin via Auto-Fix",
      imageUrl: "https://img.test/admin.png",
    });
  });

  it("cae al fallback 'Usuario' cuando auto-fix-bot tiene requestedByUserId pero el lookup del nombre falla", () => {
    // Si el backend no pudo resolver el nombre del requester (requestedByUserName
    // null/ausente), preservamos el fallback histórico "Usuario" sin avatar.
    expect(
      resolveSessionLauncherIdentity(
        makeSession({
          triggerType: "event",
          createdByUserId: "auto-fix-bot",
          createdByUserName: "Auto-Fix Bot",
          createdByUserImage: "https://img.test/bot.png",
          requestedByUserName: null,
          requestedByUserImage: null,
          config: { requestedByUserId: "user-admin-1" },
        }),
      ),
    ).toEqual({
      kind: "user",
      label: "Usuario",
      imageUrl: null,
    });
  });

  it("emite kind 'user' (no 'bot') cuando auto-fix-bot tiene requester con nombre resoluble", () => {
    // La UI (sessions-table y session-detail-view) renderiza imageUrl sólo para
    // kind: "user". Validamos que el launcher identity mantenga ese discriminante
    // para que el avatar del requester se muestre sin cambios en la UI.
    const identity = resolveSessionLauncherIdentity(
      makeSession({
        triggerType: "event",
        createdByUserId: "auto-fix-bot",
        createdByUserName: "Auto-Fix Bot",
        requestedByUserName: "Another Admin",
        requestedByUserImage: "https://img.test/another.png",
        config: { requestedByUserId: "user-admin-2" },
      }),
    );
    expect(identity?.kind).toBe("user");
    expect(identity).toEqual({
      kind: "user",
      label: "Another Admin via Auto-Fix",
      imageUrl: "https://img.test/another.png",
    });
  });

  it("mantiene el bot como launcher cuando auto-fix-bot corre sin requester humano (orchestrator/cron)", () => {
    expect(
      resolveSessionLauncherIdentity(
        makeSession({
          triggerType: "event",
          createdByUserId: "auto-fix-bot",
          createdByUserName: "Auto-Fix Bot",
        }),
      ),
    ).toEqual({
      kind: "user",
      label: "Auto-Fix Bot",
      imageUrl: null,
    });
  });
});

describe("sessions/domain/utils formatDuration", () => {
  it("formats sub-minute durations as seconds", () => {
    expect(formatDuration(12_000)).toBe("12s");
  });

  it("formats minute durations as minutes and seconds", () => {
    expect(formatDuration(125_000)).toBe("2m 5s");
  });

  it("formats hour durations as hours, minutes, and seconds", () => {
    expect(formatDuration(27_725_000)).toBe("7h 42m 5s");
  });
});

describe("resolveSessionDisplayTitle", () => {
  it("usa executionName para jobs de integración sin work item", () => {
    expect(
      resolveSessionDisplayTitle(
        makeSession({
          jobType: "integration",
          config: { executionName: "Integration — example-org/example-repo" },
        }),
      ),
    ).toBe("Integration — example-org/example-repo");
  });

  it("prioriza workItemTitle sobre executionName en jobs ligados a una tarjeta", () => {
    expect(
      resolveSessionDisplayTitle(
        makeSession({
          workItemTitle: "Implementar Handbook",
          config: { executionName: "Integration — example-org/example-repo" },
        }),
      ),
    ).toBe("Implementar Handbook");
  });

  it("prioriza el título del work item sobre el task id técnico", () => {
    expect(
      resolveSessionDisplayTitle(
        makeSession({
          workItemTitle: "Implementar Handbook",
          workItemTaskId: "A-456",
        }),
      ),
    ).toBe("Implementar Handbook");
  });

  it("usa el task id solo cuando no hay título humano disponible", () => {
    expect(
      resolveSessionDisplayTitle(
        makeSession({
          workItemTitle: null,
          workItemTaskId: "A-456",
        }),
      ),
    ).toBe("A-456");
  });
});
