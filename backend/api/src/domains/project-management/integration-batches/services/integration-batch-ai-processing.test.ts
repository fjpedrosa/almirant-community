import { afterEach, describe, expect, it, spyOn } from "bun:test";
import * as database from "@almirant/database";
import { wsConnectionManager } from "../../../../shared/ws/ws-connection-manager";
import {
  clearReleaseIntegrationBatchItemsAiProcessing,
  isReleaseIntegrationItemProcessingStatus,
  setReleaseIntegrationWorkItemAiProcessing,
  shouldClearReleaseIntegrationBatchItems,
  syncReleaseIntegrationItemAiProcessing,
} from "./integration-batch-ai-processing";

const restoreFns: Array<() => void> = [];

const track = <T extends { mockRestore: () => void }>(spy: T): T => {
  restoreFns.push(() => spy.mockRestore());
  return spy;
};

const mockNoDescendants = () =>
  track(
    spyOn(database, "loadDescendantLeafColumnsByParent").mockImplementation(
      async () => new Map() as never,
    ),
  );

const mockDescendants = (
  byParent: Record<string, string[]>,
) =>
  track(
    spyOn(database, "loadDescendantLeafColumnsByParent").mockImplementation(
      async (parentIds: string[]) => {
        const result = new Map<
          string,
          Array<{
            originalParentId: string;
            id: string;
            boardColumnId: string | null;
            columnRole: string | null;
            columnOrder: number | null;
            updatedAt: Date;
          }>
        >();
        for (const id of parentIds) {
          result.set(
            id,
            (byParent[id] ?? []).map((leafId) => ({
              originalParentId: id,
              id: leafId,
              boardColumnId: "col-1",
              columnRole: "validating",
              columnOrder: 3,
              updatedAt: new Date(),
            })),
          );
        }
        return result as never;
      },
    ),
  );

afterEach(() => {
  while (restoreFns.length > 0) {
    restoreFns.pop()?.();
  }
});

describe("release integration AI processing state", () => {
  it("maps item statuses to the processing flag", () => {
    expect(isReleaseIntegrationItemProcessingStatus("pending")).toBe(false);
    expect(isReleaseIntegrationItemProcessingStatus("rebasing")).toBe(true);
    expect(isReleaseIntegrationItemProcessingStatus("migrating")).toBe(true);
    expect(isReleaseIntegrationItemProcessingStatus("type_checking")).toBe(true);
    expect(isReleaseIntegrationItemProcessingStatus("testing")).toBe(true);
    expect(isReleaseIntegrationItemProcessingStatus("merged")).toBe(false);
    expect(isReleaseIntegrationItemProcessingStatus("skipped")).toBe(false);
    expect(isReleaseIntegrationItemProcessingStatus("failed")).toBe(false);
  });

  it("clears batch items whenever the batch has no current item", () => {
    expect(shouldClearReleaseIntegrationBatchItems("queued")).toBe(true);
    expect(shouldClearReleaseIntegrationBatchItems("running")).toBe(false);
    expect(shouldClearReleaseIntegrationBatchItems("awaiting_release")).toBe(true);
    expect(shouldClearReleaseIntegrationBatchItems("merging")).toBe(true);
    expect(shouldClearReleaseIntegrationBatchItems("completed")).toBe(true);
    expect(shouldClearReleaseIntegrationBatchItems("failed")).toBe(true);
    expect(shouldClearReleaseIntegrationBatchItems("aborted")).toBe(true);
  });

  it("sets and broadcasts true for processing item statuses", async () => {
    const broadcasts: Array<{ organizationId: string; message: Record<string, unknown> }> = [];
    const setAiSpy = track(
      spyOn(database, "setWorkItemAiProcessing").mockImplementation(async () => true as never),
    );
    track(
      spyOn(wsConnectionManager, "broadcastToOrganization").mockImplementation(
        (organizationId: string, message) => {
          broadcasts.push({
            organizationId,
            message: message as unknown as Record<string, unknown>,
          });
        },
      ),
    );
    mockNoDescendants();

    await syncReleaseIntegrationItemAiProcessing({
      organizationId: "org-1",
      workItemId: "wi-1",
      status: "rebasing",
    });

    expect(setAiSpy).toHaveBeenCalledWith("org-1", "wi-1", true);
    expect(broadcasts).toEqual([
      {
        organizationId: "org-1",
        message: {
          type: "work-item:updated",
          payload: {
            workItemId: "wi-1",
            changes: { isAiProcessing: true },
          },
        },
      },
    ]);
  });

  it("sets and broadcasts false for non-processing item statuses", async () => {
    const broadcasts: Array<{ organizationId: string; message: Record<string, unknown> }> = [];
    const setAiSpy = track(
      spyOn(database, "setWorkItemAiProcessing").mockImplementation(async () => true as never),
    );
    track(
      spyOn(wsConnectionManager, "broadcastToOrganization").mockImplementation(
        (organizationId: string, message) => {
          broadcasts.push({
            organizationId,
            message: message as unknown as Record<string, unknown>,
          });
        },
      ),
    );
    mockNoDescendants();

    await syncReleaseIntegrationItemAiProcessing({
      organizationId: "org-1",
      workItemId: "wi-1",
      status: "merged",
    });

    expect(setAiSpy).toHaveBeenCalledWith("org-1", "wi-1", false);
    expect(broadcasts[0]!.message).toEqual({
      type: "work-item:updated",
      payload: {
        workItemId: "wi-1",
        changes: { isAiProcessing: false },
      },
    });
  });

  it("deduplicates work items when clearing a whole batch", async () => {
    const setAiSpy = track(
      spyOn(database, "setWorkItemAiProcessing").mockImplementation(async () => true as never),
    );
    track(
      spyOn(wsConnectionManager, "broadcastToOrganization").mockImplementation(() => undefined),
    );
    mockNoDescendants();

    await clearReleaseIntegrationBatchItemsAiProcessing({
      organizationId: "org-1",
      items: [
        { workItemId: "wi-1" },
        { workItemId: "wi-1" },
        { workItemId: "wi-2" },
      ],
    });

    // Each unique parent gets its own setWorkItemAiProcessing call. With no
    // descendants mocked, only the parents are touched.
    expect(setAiSpy).toHaveBeenCalledTimes(2);
    expect(setAiSpy).toHaveBeenCalledWith("org-1", "wi-1", false);
    expect(setAiSpy).toHaveBeenCalledWith("org-1", "wi-2", false);
  });

  it("propagates the AI processing flag to descendant leaves of the batch item", async () => {
    const broadcasts: Array<Record<string, unknown>> = [];
    const setAiSpy = track(
      spyOn(database, "setWorkItemAiProcessing").mockImplementation(async () => true as never),
    );
    track(
      spyOn(wsConnectionManager, "broadcastToOrganization").mockImplementation(
        (_organizationId: string, message) => {
          broadcasts.push(message as unknown as Record<string, unknown>);
        },
      ),
    );
    mockDescendants({
      "feature-1": ["task-a", "task-b", "task-c"],
    });

    const updated = await setReleaseIntegrationWorkItemAiProcessing({
      organizationId: "org-1",
      workItemId: "feature-1",
      isAiProcessing: true,
    });

    expect(updated).toBe(true);
    // 1 owner + 3 descendant leaves = 4 calls
    expect(setAiSpy).toHaveBeenCalledTimes(4);
    expect(setAiSpy).toHaveBeenCalledWith("org-1", "feature-1", true);
    expect(setAiSpy).toHaveBeenCalledWith("org-1", "task-a", true);
    expect(setAiSpy).toHaveBeenCalledWith("org-1", "task-b", true);
    expect(setAiSpy).toHaveBeenCalledWith("org-1", "task-c", true);

    const broadcastIds = broadcasts.map(
      (msg) =>
        (msg.payload as { workItemId: string; changes: { isAiProcessing: boolean } }).workItemId,
    );
    expect(broadcastIds.sort()).toEqual(
      ["feature-1", "task-a", "task-b", "task-c"].sort(),
    );
    for (const msg of broadcasts) {
      const payload = msg.payload as {
        changes: { isAiProcessing: boolean };
      };
      expect(payload.changes.isAiProcessing).toBe(true);
    }
  });

  it("propagates a clearing flag to descendant leaves when the batch ends", async () => {
    const setAiSpy = track(
      spyOn(database, "setWorkItemAiProcessing").mockImplementation(async () => true as never),
    );
    track(
      spyOn(wsConnectionManager, "broadcastToOrganization").mockImplementation(() => undefined),
    );
    mockDescendants({
      "feature-1": ["task-a", "task-b"],
      "feature-2": ["task-c"],
    });

    await clearReleaseIntegrationBatchItemsAiProcessing({
      organizationId: "org-1",
      items: [{ workItemId: "feature-1" }, { workItemId: "feature-2" }],
    });

    // 2 owners + 3 descendant leaves
    expect(setAiSpy).toHaveBeenCalledTimes(5);
    expect(setAiSpy).toHaveBeenCalledWith("org-1", "feature-1", false);
    expect(setAiSpy).toHaveBeenCalledWith("org-1", "task-a", false);
    expect(setAiSpy).toHaveBeenCalledWith("org-1", "task-b", false);
    expect(setAiSpy).toHaveBeenCalledWith("org-1", "feature-2", false);
    expect(setAiSpy).toHaveBeenCalledWith("org-1", "task-c", false);
  });

  it("falls back to owner-only update when the batch item has no descendants", async () => {
    const setAiSpy = track(
      spyOn(database, "setWorkItemAiProcessing").mockImplementation(async () => true as never),
    );
    track(
      spyOn(wsConnectionManager, "broadcastToOrganization").mockImplementation(() => undefined),
    );
    mockDescendants({ "leaf-only": [] });

    const updated = await setReleaseIntegrationWorkItemAiProcessing({
      organizationId: "org-1",
      workItemId: "leaf-only",
      isAiProcessing: true,
    });

    expect(updated).toBe(true);
    expect(setAiSpy).toHaveBeenCalledTimes(1);
    expect(setAiSpy).toHaveBeenCalledWith("org-1", "leaf-only", true);
  });
});
