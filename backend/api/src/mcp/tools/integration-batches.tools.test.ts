import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import {
  createDatabaseMocks,
  restoreRealModules,
} from "../../test/mocks";
import {
  testIntegrationBatch,
  testIntegrationBatchItem,
} from "../../test/fixtures";

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

type ToolHandler = (
  params: Record<string, unknown>,
  extra: Record<string, unknown>,
) => Promise<ToolResult>;

const state = {
  itemScopeRow: {
    orgId: testIntegrationBatch.organizationId,
    batchId: testIntegrationBatch.id,
    workItemId: testIntegrationBatchItem.workItemId,
  } as null | { orgId: string; batchId: string; workItemId: string },
  batch: {
    ...testIntegrationBatch,
    items: [testIntegrationBatchItem],
  },
  aiProcessingCalls: [] as Array<{
    organizationId: string;
    workItemId: string;
    isAiProcessing: boolean;
  }>,
  broadcasts: [] as Array<{
    organizationId: string;
    message: Record<string, unknown>;
  }>,
  itemStatusCalls: [] as Array<{
    itemId: string;
    status: string;
  }>,
  itemFailureCalls: [] as Array<{
    itemId: string;
    failureCategory: string;
    failureReason: string;
  }>,
  batchStatusCalls: [] as Array<{
    batchId: string;
    status: string;
  }>,
};

const dbMock = {
  select: () => ({
    from: () => ({
      innerJoin: () => ({
        where: () => ({
          limit: () => (state.itemScopeRow ? [state.itemScopeRow] : []),
        }),
      }),
    }),
  }),
};

mock.module("@almirant/database", () =>
  createDatabaseMocks({
    db: dbMock,
    getBatchByIdWithItems: async (batchId: string) =>
      batchId === state.batch.id ? state.batch : null,
    updateBatchStatus: async (batchId: string, status: string) => {
      state.batchStatusCalls.push({ batchId, status });
      return { ...testIntegrationBatch, id: batchId, status };
    },
    updateItemStatus: async (itemId: string, status: string) => {
      state.itemStatusCalls.push({ itemId, status });
      return { ...testIntegrationBatchItem, id: itemId, status };
    },
    setItemFailure: async (
      itemId: string,
      failureCategory: string,
      failureReason: string,
    ) => {
      state.itemFailureCalls.push({ itemId, failureCategory, failureReason });
      return {
        ...testIntegrationBatchItem,
        id: itemId,
        status: "failed",
        failureCategory,
        failureReason,
      };
    },
    setWorkItemAiProcessing: async (
      organizationId: string,
      workItemId: string,
      isAiProcessing: boolean,
    ) => {
      state.aiProcessingCalls.push({
        organizationId,
        workItemId,
        isAiProcessing,
      });
      return true;
    },
    loadDescendantLeafColumnsByParent: async (parentIds: string[]) => {
      const result = new Map<string, Array<unknown>>();
      for (const id of parentIds) result.set(id, []);
      return result;
    },
  } as Record<string, unknown>),
);

mock.module("../../shared/ws/ws-connection-manager", () => ({
  wsConnectionManager: {
    broadcastToOrganization: (
      organizationId: string,
      message: Record<string, unknown>,
    ) => {
      state.broadcasts.push({ organizationId, message });
    },
    sendToUser: () => {},
  },
}));

const buildToolsRegistry = async () => {
  const tools = new Map<string, ToolHandler>();

  const fakeServer = {
    tool: (
      name: string,
      _description: string,
      _schema: unknown,
      handler: ToolHandler,
    ) => {
      tools.set(name, handler);
      return undefined;
    },
  };

  const { registerIntegrationBatchesTools } = await import("./integration-batches.tools");
  registerIntegrationBatchesTools(fakeServer as never);
  return tools;
};

const withOrg = {
  authInfo: {
    extra: {
      organizationId: testIntegrationBatch.organizationId,
      projectId: testIntegrationBatch.projectId,
    },
  },
};

beforeEach(() => {
  state.itemScopeRow = {
    orgId: testIntegrationBatch.organizationId,
    batchId: testIntegrationBatch.id,
    workItemId: testIntegrationBatchItem.workItemId,
  };
  state.batch = {
    ...testIntegrationBatch,
    items: [testIntegrationBatchItem],
  };
  state.aiProcessingCalls = [];
  state.broadcasts = [];
  state.itemStatusCalls = [];
  state.itemFailureCalls = [];
  state.batchStatusCalls = [];
});

describe("integration batch MCP tools AI processing state", () => {
  it("marks the linked block as processing when an item enters a processing status", async () => {
    const tools = await buildToolsRegistry();
    const handler = tools.get("update_integration_batch_item_status");

    const result = await handler!(
      { itemId: testIntegrationBatchItem.id, status: "rebasing" },
      withOrg,
    );

    expect(result.isError).toBeUndefined();
    expect(state.itemStatusCalls).toEqual([
      { itemId: testIntegrationBatchItem.id, status: "rebasing" },
    ]);
    expect(state.aiProcessingCalls).toEqual([
      {
        organizationId: testIntegrationBatch.organizationId,
        workItemId: testIntegrationBatchItem.workItemId,
        isAiProcessing: true,
      },
    ]);
    expect(state.broadcasts[0]!.message).toEqual({
      type: "work-item:updated",
      payload: {
        workItemId: testIntegrationBatchItem.workItemId,
        changes: { isAiProcessing: true },
      },
    });
  });

  it("clears the linked block when an item reaches a terminal status", async () => {
    const tools = await buildToolsRegistry();
    const handler = tools.get("update_integration_batch_item_status");

    const result = await handler!(
      { itemId: testIntegrationBatchItem.id, status: "merged" },
      withOrg,
    );

    expect(result.isError).toBeUndefined();
    expect(state.aiProcessingCalls).toEqual([
      {
        organizationId: testIntegrationBatch.organizationId,
        workItemId: testIntegrationBatchItem.workItemId,
        isAiProcessing: false,
      },
    ]);
  });

  it("clears the linked block when an item is marked failed", async () => {
    const tools = await buildToolsRegistry();
    const handler = tools.get("set_integration_batch_item_failure");

    const result = await handler!(
      {
        itemId: testIntegrationBatchItem.id,
        failureCategory: "merge_conflict",
        failureReason: "Conflict could not be resolved",
      },
      withOrg,
    );

    expect(result.isError).toBeUndefined();
    expect(state.itemFailureCalls).toEqual([
      {
        itemId: testIntegrationBatchItem.id,
        failureCategory: "merge_conflict",
        failureReason: "Conflict could not be resolved",
      },
    ]);
    expect(state.aiProcessingCalls).toEqual([
      {
        organizationId: testIntegrationBatch.organizationId,
        workItemId: testIntegrationBatchItem.workItemId,
        isAiProcessing: false,
      },
    ]);
  });

  it("clears every batch block when the batch leaves item-processing status", async () => {
    const secondItem = {
      ...testIntegrationBatchItem,
      id: "batch-item-test-2",
      workItemId: "wi-test-2",
      processingOrder: 1,
    };
    state.batch = {
      ...testIntegrationBatch,
      items: [testIntegrationBatchItem, secondItem],
    };

    const tools = await buildToolsRegistry();
    const handler = tools.get("update_integration_batch_status");

    const result = await handler!(
      { batchId: testIntegrationBatch.id, status: "awaiting_release" },
      withOrg,
    );

    expect(result.isError).toBeUndefined();
    expect(state.batchStatusCalls).toEqual([
      { batchId: testIntegrationBatch.id, status: "awaiting_release" },
    ]);
    expect(state.aiProcessingCalls).toEqual([
      {
        organizationId: testIntegrationBatch.organizationId,
        workItemId: testIntegrationBatchItem.workItemId,
        isAiProcessing: false,
      },
      {
        organizationId: testIntegrationBatch.organizationId,
        workItemId: "wi-test-2",
        isAiProcessing: false,
      },
    ]);
  });

  it("does not mark a block when the item belongs to another organization", async () => {
    state.itemScopeRow = {
      orgId: "other-org",
      batchId: testIntegrationBatch.id,
      workItemId: testIntegrationBatchItem.workItemId,
    };

    const tools = await buildToolsRegistry();
    const handler = tools.get("update_integration_batch_item_status");

    const result = await handler!(
      { itemId: testIntegrationBatchItem.id, status: "rebasing" },
      withOrg,
    );

    expect(result.isError).toBe(true);
    expect(state.aiProcessingCalls).toEqual([]);
  });
});

afterAll(() => {
  mock.restore();
  restoreRealModules();
});
