import { describe, it, expect, mock } from "bun:test";

// Shared mock spies so each test can assert the arguments used by the logger.
// NOTE: `createWorkItemEvent` intentionally resolves successfully in the base
// case so we can inspect its call args; individual tests that want to assert
// the fire-and-forget contract override the implementation via
// `mockImplementationOnce` to simulate DB failure.
const createWorkItemEventMock = mock(() => Promise.resolve({} as never));
const createEntityEventMock = mock(() => Promise.resolve());

// Mock BEFORE importing the logger so the mock is picked up.
mock.module("@almirant/database", () => ({
  createWorkItemEvent: createWorkItemEventMock,
  createEntityEvent: createEntityEventMock,
}));

mock.module("@almirant/config", () => ({
  logger: {
    warn: mock(() => {}),
    debug: mock(() => {}),
  },
}));

import { defaultActivityLogger } from "../default-activity-logger";

// Helper: wait for the fire-and-forget microtask chain to settle so assertions
// can inspect the mock call args.
const flushMicrotasks = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("DefaultActivityLogger", () => {
  it("does not throw when logging a work_item event", () => {
    expect(() =>
      defaultActivityLogger.log({
        actorUserId: "u1",
        organizationId: "o1",
        action: "work-item.move",
        resourceType: "work_item",
        resourceId: "wi1",
        metadata: { from: "todo", to: "doing" },
      })
    ).not.toThrow();
  });

  it("does not throw when logging an entity event", () => {
    expect(() =>
      defaultActivityLogger.log({
        actorUserId: "u1",
        organizationId: "o1",
        action: "idea.edit",
        resourceType: "idea",
        resourceId: "idea-1",
      })
    ).not.toThrow();
  });

  it("does not throw even when DB layer rejects", () => {
    createWorkItemEventMock.mockImplementationOnce(() =>
      Promise.reject(new Error("db down")),
    );
    // The mocks reject; the log call must still not throw synchronously.
    expect(() =>
      defaultActivityLogger.log({
        actorUserId: "u1",
        organizationId: null,
        action: "any",
        resourceType: "work_item",
        resourceId: "wi2",
      })
    ).not.toThrow();
  });

  it("silently ignores unhandled resourceTypes (logs debug, no throw)", () => {
    expect(() =>
      defaultActivityLogger.log({
        actorUserId: "u1",
        organizationId: "o1",
        action: "project.archive",
        resourceType: "project",
        resourceId: "p1",
      })
    ).not.toThrow();
  });

  it("uses metadata.triggeredBy when present and valid (work_item)", async () => {
    createWorkItemEventMock.mockClear();

    defaultActivityLogger.log({
      actorUserId: "u1",
      organizationId: "o1",
      action: "work-item.update",
      resourceType: "work_item",
      resourceId: "wi-mcp",
      metadata: { triggeredBy: "mcp", changedFields: ["title"] },
    });

    await flushMicrotasks();

    expect(createWorkItemEventMock).toHaveBeenCalledTimes(1);
    const [payload] = createWorkItemEventMock.mock.calls[0] as unknown as [
      { triggeredBy: string; workItemId: string },
    ];
    expect(payload.triggeredBy).toBe("mcp");
    expect(payload.workItemId).toBe("wi-mcp");
  });

  it("uses metadata.triggeredBy when present and valid (entity)", async () => {
    createEntityEventMock.mockClear();

    defaultActivityLogger.log({
      actorUserId: "u1",
      organizationId: "o1",
      action: "idea.edit",
      resourceType: "idea",
      resourceId: "idea-ws",
      metadata: { triggeredBy: "websocket" },
    });

    await flushMicrotasks();

    expect(createEntityEventMock).toHaveBeenCalledTimes(1);
    const [payload] = createEntityEventMock.mock.calls[0] as unknown as [
      { triggeredBy: string; entityId: string },
    ];
    expect(payload.triggeredBy).toBe("websocket");
    expect(payload.entityId).toBe("idea-ws");
  });

  it("falls back to 'user' when metadata.triggeredBy is invalid", async () => {
    createWorkItemEventMock.mockClear();

    defaultActivityLogger.log({
      actorUserId: "u1",
      organizationId: "o1",
      action: "work-item.update",
      resourceType: "work_item",
      resourceId: "wi-bad",
      metadata: { triggeredBy: "not-a-real-source" },
    });

    await flushMicrotasks();

    expect(createWorkItemEventMock).toHaveBeenCalledTimes(1);
    const [payload] = createWorkItemEventMock.mock.calls[0] as unknown as [
      { triggeredBy: string },
    ];
    expect(payload.triggeredBy).toBe("user");
  });

  it("falls back to 'user' when metadata.triggeredBy is missing", async () => {
    createWorkItemEventMock.mockClear();

    defaultActivityLogger.log({
      actorUserId: "u1",
      organizationId: "o1",
      action: "work-item.update",
      resourceType: "work_item",
      resourceId: "wi-nometa",
    });

    await flushMicrotasks();

    expect(createWorkItemEventMock).toHaveBeenCalledTimes(1);
    const [payload] = createWorkItemEventMock.mock.calls[0] as unknown as [
      { triggeredBy: string },
    ];
    expect(payload.triggeredBy).toBe("user");
  });
});
