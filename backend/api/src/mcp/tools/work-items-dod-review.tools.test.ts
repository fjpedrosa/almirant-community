import { afterEach, describe, expect, it, spyOn } from "bun:test";
import * as database from "@almirant/database";
import { setActivityLogger } from "@almirant/shared";
import { testBoardColumn, testWorkItem } from "../../test/fixtures";
import { registerWorkItemsTools } from "./work-items.tools";

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

type ToolHandler = (
  params: Record<string, unknown>,
  extra: Record<string, unknown>,
) => Promise<ToolResult>;

const restoreFns: Array<() => void> = [];

function track<T extends { mockRestore: () => void }>(spy: T): T {
  restoreFns.push(() => spy.mockRestore());
  return spy;
}

afterEach(() => {
  while (restoreFns.length > 0) {
    restoreFns.pop()?.();
  }
});

function buildToolsRegistry() {
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

  registerWorkItemsTools(fakeServer as never);
  return tools;
}

const withoutUser = {
  authInfo: {
    extra: {
      organizationId: "org-test-1",
      projectId: "proj-test-1",
    },
  },
};

const withUser = {
  authInfo: {
    extra: {
      organizationId: "org-test-1",
      projectId: "proj-test-1",
      userId: "user-test-1",
    },
  },
};

describe("complete_definition_of_done_review", () => {
  it("marks all Definition of Done checklist items as checked when approved without explicit criteria", async () => {
    setActivityLogger({ log: () => undefined });

    const definitionOfDone = [
      "- [ ] Migration exists",
      "- [ ] API returns the field",
      "Non-checklist context stays untouched",
    ].join("\n");
    const reviewWorkItem = {
      ...testWorkItem,
      metadata: { definitionOfDone },
      boardId: testBoardColumn.boardId,
      columnName: "To Review",
    };

    track(spyOn(database, "getWorkItemById")
      .mockImplementation(async () => reviewWorkItem as never));
    track(spyOn(database, "setWorkItemAiProcessing")
      .mockImplementation(async () => true as never));
    const updateWorkItemSpy = track(spyOn(database, "updateWorkItem")
      .mockImplementation(async () => reviewWorkItem as never));

    const tools = buildToolsRegistry();
    const handler = tools.get("complete_definition_of_done_review");

    const result = await handler!(
      {
        workItemId: testWorkItem.id,
        result: "approved",
        report: "All DoD criteria pass with evidence.",
      },
      withoutUser,
    );

    expect(result.isError).toBeUndefined();
    expect(updateWorkItemSpy).toHaveBeenCalledWith(
      "org-test-1",
      testWorkItem.id,
      {
        metadata: expect.objectContaining({
          dod_approved: true,
          definitionOfDone: [
            "- [x] Migration exists",
            "- [x] API returns the field",
            "Non-checklist context stays untouched",
          ].join("\n"),
        }),
      },
    );

    const payload = JSON.parse(result.content[0]!.text) as {
      definitionOfDoneChecklistUpdatedIds: string[];
    };
    expect(payload.definitionOfDoneChecklistUpdatedIds).toEqual([testWorkItem.id]);
  });

  it("checks only passing Definition of Done criteria and clears failed, unknown, or omitted checklist items", async () => {
    setActivityLogger({ log: () => undefined });

    const reviewWorkItem = {
      ...testWorkItem,
      metadata: {
        definitionOfDone: [
          "- [ ] Migration exists",
          "- [x] API returns the field",
          "- [ ] UI shows the saved note",
        ].join("\n"),
      },
      boardId: testBoardColumn.boardId,
      columnName: "To Review",
    };

    track(spyOn(database, "getWorkItemById")
      .mockImplementation(async () => reviewWorkItem as never));
    track(spyOn(database.db, "select")
      .mockImplementation(() => ({
        from: () => ({
          where: () => ({
            limit: async () => [testBoardColumn],
          }),
        }),
      }) as never));
    track(spyOn(database, "moveWorkItem")
      .mockImplementation(async () => true as never));
    track(spyOn(database, "setWorkItemAiProcessing")
      .mockImplementation(async () => true as never));
    const updateWorkItemSpy = track(spyOn(database, "updateWorkItem")
      .mockImplementation(async () => reviewWorkItem as never));

    const tools = buildToolsRegistry();
    const handler = tools.get("complete_definition_of_done_review");

    const result = await handler!(
      {
        workItemId: testWorkItem.id,
        result: "incompleted",
        report: "DoD failed because the UI criterion is still unverified.",
        backlogColumnId: testBoardColumn.id,
        definitionOfDoneCriteria: [
          { text: "Migration exists", status: "pass" },
          { text: "API returns the field", status: "fail" },
        ],
      },
      withoutUser,
    );

    expect(result.isError).toBeUndefined();
    expect(updateWorkItemSpy).toHaveBeenCalledWith(
      "org-test-1",
      testWorkItem.id,
      {
        metadata: expect.objectContaining({
          dod_incompleted: true,
          definitionOfDone: [
            "- [x] Migration exists",
            "- [ ] API returns the field",
            "- [ ] UI shows the saved note",
          ].join("\n"),
        }),
      },
    );
  });

  it("does not fail the DoD completion when the visible comment cannot be inserted", async () => {
    setActivityLogger({ log: () => undefined });

    const reviewWorkItem = {
      ...testWorkItem,
      metadata: { definitionOfDone: "Must pass DoD" },
      boardId: testBoardColumn.boardId,
      columnName: "To Review",
    };

    const getWorkItemByIdSpy = track(spyOn(database, "getWorkItemById")
      .mockImplementation(async () => reviewWorkItem as never));
    const dbSelectSpy = track(spyOn(database.db, "select")
      .mockImplementation(() => ({
        from: () => ({
          where: () => ({
            limit: async () => [testBoardColumn],
          }),
        }),
      }) as never));
    const moveWorkItemSpy = track(spyOn(database, "moveWorkItem")
      .mockImplementation(async () => true as never));
    const setAiSpy = track(spyOn(database, "setWorkItemAiProcessing")
      .mockImplementation(async () => true as never));
    const updateWorkItemSpy = track(spyOn(database, "updateWorkItem")
      .mockImplementation(async () => reviewWorkItem as never));
    const createCommentSpy = track(spyOn(database, "createEntityComment")
      .mockImplementation(async () => {
        throw new Error("insert or update on table entity_comments violates foreign key constraint");
      }));

    const tools = buildToolsRegistry();
    const handler = tools.get("complete_definition_of_done_review");

    expect(handler).toBeDefined();

    const result = await handler!(
      {
        workItemId: testWorkItem.id,
        result: "incompleted",
        report: "DoD failed because visible legacy routes remain.",
        backlogColumnId: testBoardColumn.id,
      },
      withUser,
    );

    expect(result.isError).toBeUndefined();

    const payload = JSON.parse(result.content[0]!.text) as {
      completed: boolean;
      result: string;
      comment: { created: boolean; error: string | null };
    };

    expect(payload.completed).toBe(true);
    expect(payload.result).toBe("incompleted");
    expect(payload.comment.created).toBe(false);
    expect(payload.comment.error).toContain("foreign key constraint");

    expect(dbSelectSpy).toHaveBeenCalled();
    expect(moveWorkItemSpy).toHaveBeenCalled();
    expect(setAiSpy).toHaveBeenCalled();
    expect(updateWorkItemSpy).toHaveBeenCalled();
    expect(createCommentSpy).toHaveBeenCalled();
    expect(createCommentSpy.mock.calls[0]?.[2]).toBe("user-test-1");
    expect(getWorkItemByIdSpy).toHaveBeenCalled();
  });

  it("skips the visible comment instead of using a synthetic system user when no user is available", async () => {
    setActivityLogger({ log: () => undefined });

    const reviewWorkItem = {
      ...testWorkItem,
      metadata: { definitionOfDone: "Must pass DoD" },
      boardId: testBoardColumn.boardId,
      columnName: "To Review",
    };

    track(spyOn(database, "getWorkItemById")
      .mockImplementation(async () => reviewWorkItem as never));
    track(spyOn(database.db, "select")
      .mockImplementation(() => ({
        from: () => ({
          where: () => ({
            limit: async () => [testBoardColumn],
          }),
        }),
      }) as never));
    track(spyOn(database, "moveWorkItem")
      .mockImplementation(async () => true as never));
    track(spyOn(database, "setWorkItemAiProcessing")
      .mockImplementation(async () => true as never));
    track(spyOn(database, "updateWorkItem")
      .mockImplementation(async () => reviewWorkItem as never));
    const createCommentSpy = track(spyOn(database, "createEntityComment")
      .mockImplementation(async () => ({ id: "comment-1" }) as never));

    const tools = buildToolsRegistry();
    const handler = tools.get("complete_definition_of_done_review");

    expect(handler).toBeDefined();

    const result = await handler!(
      {
        workItemId: testWorkItem.id,
        result: "incompleted",
        report: "DoD failed because visible legacy routes remain.",
        backlogColumnId: testBoardColumn.id,
      },
      withoutUser,
    );

    expect(result.isError).toBeUndefined();

    const payload = JSON.parse(result.content[0]!.text) as {
      completed: boolean;
      comment: { created: boolean; id: string | null; error: string | null };
    };

    expect(payload.completed).toBe(true);
    expect(payload.comment).toEqual({ created: false, id: null, error: null });
    expect(createCommentSpy).not.toHaveBeenCalled();
  });

  it("increments DoD incomplete count and marks repeated failures for human review without moving the item to Backlog", async () => {
    setActivityLogger({ log: () => undefined });

    const reviewWorkItem = {
      ...testWorkItem,
      metadata: {
        definitionOfDone: "Must pass DoD",
        dod_incompleted_count: 3,
      },
      boardId: testBoardColumn.boardId,
      columnName: "To Review",
    };

    track(spyOn(database, "getWorkItemById")
      .mockImplementation(async () => reviewWorkItem as never));
    track(spyOn(database.db, "select")
      .mockImplementation(() => ({
        from: () => ({
          where: () => ({
            limit: async () => [testBoardColumn],
          }),
        }),
      }) as never));
    const moveWorkItemSpy = track(spyOn(database, "moveWorkItem")
      .mockImplementation(async () => true as never));
    track(spyOn(database, "setWorkItemAiProcessing")
      .mockImplementation(async () => true as never));
    const updateWorkItemSpy = track(spyOn(database, "updateWorkItem")
      .mockImplementation(async () => reviewWorkItem as never));

    const tools = buildToolsRegistry();
    const handler = tools.get("complete_definition_of_done_review");

    const result = await handler!(
      {
        workItemId: testWorkItem.id,
        result: "incompleted",
        report: "DoD failed for the fourth time.",
        backlogColumnId: testBoardColumn.id,
      },
      withoutUser,
    );

    expect(result.isError).toBeUndefined();
    expect(updateWorkItemSpy).toHaveBeenCalledWith(
      "org-test-1",
      testWorkItem.id,
      {
        metadata: expect.objectContaining({
          dod_incompleted: true,
          dod_incompleted_count: 4,
          dod_human_review_required: true,
          dod_auto_remediation_blocked: true,
        }),
      },
    );

    // Item must stay in Review when human intervention is required: no agent
    // will retry it, so moving it to Backlog would just bury it where the
    // human reviewer cannot find it.
    expect(moveWorkItemSpy).not.toHaveBeenCalled();

    const payload = JSON.parse(result.content[0]!.text) as {
      flags: {
        dod_incompleted_count: number;
        dod_human_review_required: boolean;
      };
      movedTo: string | null;
    };
    expect(payload.flags.dod_incompleted_count).toBe(4);
    expect(payload.flags.dod_human_review_required).toBe(true);
    expect(payload.movedTo).toBe("To Review");
  });
});
