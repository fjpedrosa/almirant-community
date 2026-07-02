import { afterAll, beforeAll, describe, expect, test, mock } from "bun:test";
import { PgDialect } from "drizzle-orm/pg-core";

// Capture the real client module BEFORE the mock is registered so afterAll
// can restore it: mock.restore() does NOT clear mock.module() registrations,
// and a leaked client mock poisons later suites in the same run (e.g. the
// DB-gated bug-fix-attempt-cancel-cascade tests) that import the real db.
const realClient = { ...(await import("../../client")) };

type Selection = Record<string, unknown> & {
  description?: { sql: Parameters<PgDialect["sqlToQuery"]>[0] };
};

let getWorkItemsByBoard: typeof import("./work-item-repository").getWorkItemsByBoard;
let capturedBoardSelection: Selection | undefined;
let selectCall = 0;

const getCapturedBoardSelection = (): Selection | undefined => capturedBoardSelection;

beforeAll(async () => {
  mock.module("../../client", () => ({
    db: {
      select: (selection?: Selection) => {
        const call = ++selectCall;
        if (selection?.description) capturedBoardSelection = selection;

        return {
          from: () => ({
            where: () => ({
              limit: async () => [{ id: "board-1" }],
              orderBy: async () => {
                if (call === 2) {
                  return [
                    {
                      id: "column-1",
                      boardId: "board-1",
                      name: "Todo",
                      color: null,
                      order: 0,
                      role: "todo",
                      isDone: false,
                      createdAt: new Date("2026-01-01T00:00:00.000Z"),
                      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
                    },
                  ];
                }
                return [];
              },
            }),
          }),
        };
      },
    },
  }));

  ({ getWorkItemsByBoard } = await import("./work-item-repository"));
});

afterAll(() => {
  mock.module("../../client", () => realClient);
  mock.restore();
});

describe("work item board projection", () => {
  test("uses built-in PostgreSQL left() for description previews", async () => {
    selectCall = 0;
    capturedBoardSelection = undefined;

    await getWorkItemsByBoard("org-1", "board-1");

    const selection = getCapturedBoardSelection();
    expect(selection?.description).toBeDefined();
    const descriptionSql = new PgDialect().sqlToQuery(selection!.description!.sql).sql;

    expect(descriptionSql).toBe('left("work_items"."description", 200)');
    expect(descriptionSql).not.toContain("safe_left");
  });
});
