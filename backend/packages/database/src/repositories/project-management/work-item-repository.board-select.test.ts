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

describe("work item board projection - slim board view (?view=board)", () => {
  const sqlOf = (field: unknown): string =>
    new PgDialect().sqlToQuery(
      (field as { sql: Parameters<PgDialect["sqlToQuery"]>[0] }).sql,
    ).sql;

  test("slim projection drops the description text (no left() preview)", async () => {
    selectCall = 0;
    capturedBoardSelection = undefined;

    await getWorkItemsByBoard("org-1", "board-1", undefined, { slim: true });

    const selection = getCapturedBoardSelection();
    expect(selection?.description).toBeDefined();
    const descriptionSql = sqlOf(selection!.description).toLowerCase();

    // Slim mode ships no description text — the detail panel loads it on demand.
    expect(descriptionSql).not.toContain("left(");
    expect(descriptionSql).toContain("null");
  });

  test("slim projection strips generatedPrompt + definitionOfDone from metadata", async () => {
    selectCall = 0;
    capturedBoardSelection = undefined;

    await getWorkItemsByBoard("org-1", "board-1", undefined, { slim: true });

    const selection = getCapturedBoardSelection();
    const metadataSql = sqlOf((selection as Record<string, unknown>).metadata);

    // jsonb `-` operator removes the two heavy blobs, keeping light card flags.
    expect(metadataSql).toContain("generatedPrompt");
    expect(metadataSql).toContain("definitionOfDone");
    expect(metadataSql).toContain("metadata");
  });

  test("slim projection ships a cheap descriptionPreview (left 200) for the card", async () => {
    selectCall = 0;
    capturedBoardSelection = undefined;

    await getWorkItemsByBoard("org-1", "board-1", undefined, { slim: true });

    const selection = getCapturedBoardSelection() as Record<string, unknown>;
    expect(selection.descriptionPreview).toBeDefined();
    const previewSql = sqlOf(selection.descriptionPreview);

    // ≤200-char preview (same truncation the full board DTO uses) — the card
    // renders this instead of the full text, which stays out of the payload.
    expect(previewSql).toBe('left("work_items"."description", 200)');
    // Guard: the full description text must NOT ride along in slim mode.
    const descriptionSql = sqlOf(selection.description).toLowerCase();
    expect(descriptionSql).not.toContain("left(");
  });

  test("slim projection exposes cheap existence flags without the content", async () => {
    selectCall = 0;
    capturedBoardSelection = undefined;

    await getWorkItemsByBoard("org-1", "board-1", undefined, { slim: true });

    const selection = getCapturedBoardSelection() as Record<string, unknown>;

    expect(selection.hasGeneratedPrompt).toBeDefined();
    expect(selection.hasDefinitionOfDone).toBeDefined();

    const generatedPromptSql = sqlOf(selection.hasGeneratedPrompt);
    const definitionOfDoneSql = sqlOf(selection.hasDefinitionOfDone);

    // Key-existence check (no content) so the card keeps button/popup affordances.
    expect(generatedPromptSql).toContain("jsonb_exists");
    expect(generatedPromptSql).toContain("generatedPrompt");
    expect(definitionOfDoneSql).toContain("jsonb_exists");
    expect(definitionOfDoneSql).toContain("definitionOfDone");
  });

  test("slim projection still exposes the fields the card renders", async () => {
    selectCall = 0;
    capturedBoardSelection = undefined;

    await getWorkItemsByBoard("org-1", "board-1", undefined, { slim: true });

    const selection = getCapturedBoardSelection() as Record<string, unknown>;
    for (const field of [
      "id",
      "taskId",
      "title",
      "type",
      "priority",
      "assignee",
      "boardColumnId",
      "position",
      "archivedAt",
      "metadata",
    ]) {
      expect(selection[field]).toBeDefined();
    }
  });
});
