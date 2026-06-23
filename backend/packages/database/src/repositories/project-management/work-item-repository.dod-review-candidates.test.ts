import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

type DodReviewRow = {
  id: string;
  taskId: string | null;
  title: string;
  description: string | null;
  type: string;
  priority: string;
  parentId: string | null;
  boardId: string;
  projectId: string | null;
  organizationId: string | null;
  columnName: string | null;
  updatedAt: Date;
  metadata: Record<string, unknown> | null;
};

let getDefinitionOfDoneReviewCandidates: typeof import("./work-item-repository").getDefinitionOfDoneReviewCandidates;
let capturedWhere: SQL | undefined;
let reviewRows: DodReviewRow[] = [];
let parentRows: DodReviewRow[] = [];
let descendantRows: Array<{ id: string; boardColumnId: string | null }> = [];
let selectCall = 0;

const createQueryBuilder = (callIndex: number) => {
  const builder = {
    from: () => builder,
    innerJoin: () => builder,
    leftJoin: () => builder,
    where: (whereClause: SQL) => {
      if (callIndex === 1) {
        capturedWhere = whereClause;
        return {
          orderBy: async () => reviewRows,
        };
      }
      if (callIndex === 2) {
        return Promise.resolve(parentRows);
      }
      return Promise.resolve(descendantRows);
    },
  };
  return builder;
};

beforeAll(async () => {
  mock.module("../../client", () => ({
    db: {
      select: () => {
        selectCall += 1;
        return createQueryBuilder(selectCall);
      },
    },
  }));

  ({ getDefinitionOfDoneReviewCandidates } = await import("./work-item-repository"));
});

beforeEach(() => {
  capturedWhere = undefined;
  reviewRows = [];
  parentRows = [];
  descendantRows = [];
  selectCall = 0;
});

afterAll(() => {
  mock.restore();
});

describe("Definition of Done review candidate query", () => {
  test("serializes the stabilization cutoff as an ISO timestamptz-safe value", async () => {
    const originalDateNow = Date.now;
    Date.now = () => new Date("2026-05-02T15:39:58.000Z").getTime();

    try {
      await getDefinitionOfDoneReviewCandidates(undefined, undefined, 1, {
        minAgeMinutes: 15,
      });
    } finally {
      Date.now = originalDateNow;
    }

    expect(capturedWhere).toBeDefined();

    const query = new PgDialect().sqlToQuery(capturedWhere!);
    expect(query.sql).toContain('"work_items"."updated_at" <=');
    expect(query.params).toContain("2026-05-02T15:24:58.000Z");
    expect(query.params.some((param) => param instanceof Date)).toBe(false);
  });

  test("excludes review tasks that are waiting for human action or external validators", async () => {
    await getDefinitionOfDoneReviewCandidates(undefined, undefined, 1);

    expect(capturedWhere).toBeDefined();

    const query = new PgDialect().sqlToQuery(capturedWhere!);
    expect(query.sql).toContain("dod_human_action_required");
    expect(query.sql).toContain("dod_human_review_required");
    expect(query.sql).toContain("dod_auto_remediation_blocked");
    expect(query.sql).toContain("dod_external_validation_required");
    expect(query.sql).toContain("dod_external_validation_tools");
  });

  test("groups review-column child tasks under their parent block", async () => {
    const parentId = "parent-feature";
    reviewRows = [
      {
        id: "child-1",
        taskId: "ZC-152",
        title: "Create refinement route",
        description: "Child 1",
        type: "task",
        priority: "medium",
        parentId,
        boardId: "board-1",
        projectId: "project-1",
        organizationId: "org-1",
        columnName: "To Review",
        updatedAt: new Date("2026-05-02T10:00:00.000Z"),
        metadata: { definitionOfDone: "- Route exists" },
      },
      {
        id: "child-2",
        taskId: "ZC-153",
        title: "Create refinement agent",
        description: "Child 2",
        type: "task",
        priority: "medium",
        parentId,
        boardId: "board-1",
        projectId: "project-1",
        organizationId: "org-1",
        columnName: "To Review",
        updatedAt: new Date("2026-05-02T10:05:00.000Z"),
        metadata: { definitionOfDone: "- Agent exists" },
      },
    ];
    parentRows = [
      {
        id: parentId,
        taskId: "ZC-F-38",
        title: "Refinement de pitch decks aceptados",
        description: "Parent block",
        type: "feature",
        priority: "medium",
        parentId: null,
        boardId: "board-1",
        projectId: "project-1",
        organizationId: "org-1",
        columnName: null,
        updatedAt: new Date("2026-05-02T09:00:00.000Z"),
        metadata: { definitionOfDone: "- All refinement tasks pass" },
      },
    ];
    descendantRows = [
      { id: "child-1", boardColumnId: "review-column" },
      { id: "child-2", boardColumnId: "review-column" },
    ];

    const candidates = await getDefinitionOfDoneReviewCandidates(undefined, "project-1");

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      id: parentId,
      taskId: "ZC-F-38",
      title: "Refinement de pitch decks aceptados",
      type: "feature",
      columnName: "To Review",
      childIds: ["child-1", "child-2"],
      updatedAt: "2026-05-02T10:05:00.000Z",
      definitionOfDone: "- All refinement tasks pass",
    });
  });

  test("returns a parent block when any leaf child is pending DoD review", async () => {
    const parentId = "parent-feature";
    reviewRows = [
      {
        id: "child-1",
        taskId: "ZC-152",
        title: "Create refinement route",
        description: "Child 1",
        type: "task",
        priority: "medium",
        parentId,
        boardId: "board-1",
        projectId: "project-1",
        organizationId: "org-1",
        columnName: "To Review",
        updatedAt: new Date("2026-05-02T10:00:00.000Z"),
        metadata: { definitionOfDone: "- Route exists" },
      },
    ];
    parentRows = [
      {
        id: parentId,
        taskId: "ZC-F-38",
        title: "Refinement de pitch decks aceptados",
        description: "Parent block",
        type: "feature",
        priority: "medium",
        parentId: null,
        boardId: "board-1",
        projectId: "project-1",
        organizationId: "org-1",
        columnName: null,
        updatedAt: new Date("2026-05-02T09:00:00.000Z"),
        metadata: { definitionOfDone: "- All refinement tasks pass" },
      },
    ];
    descendantRows = [
      { id: "child-1", boardColumnId: "review-column" },
      { id: "child-2", boardColumnId: "backlog-column" },
    ];

    const candidates = await getDefinitionOfDoneReviewCandidates(undefined, "project-1");

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      id: parentId,
      taskId: "ZC-F-38",
      title: "Refinement de pitch decks aceptados",
      type: "feature",
      columnName: "To Review",
      childIds: ["child-1"],
      updatedAt: "2026-05-02T10:00:00.000Z",
      definitionOfDone: "- All refinement tasks pass",
    });
  });
});
