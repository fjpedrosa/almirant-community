import { describe, expect, it } from "bun:test";
import { buildBoardAssigneeOptions } from "./board-assignee-options";
import type { WorkItemWithContext } from "./types";

const createMockItem = (
  id: string,
  overrides: Partial<WorkItemWithContext> = {}
): WorkItemWithContext => ({
  id,
  projectId: null,
  boardId: "board-1",
  boardColumnId: "col-1",
  parentId: null,
  type: "task",
  title: `Item ${id}`,
  description: null,
  priority: "medium",
  assignee: null,
  position: 0,
  startDate: null,
  dueDate: null,
  estimatedHours: null,
  metadata: {},
  isAiProcessing: false,
  taskId: `T-${id}`,
  createdByUserId: null,
  requestedByUserId: null,
  codingAgent: null,
  aiModel: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  tags: [],
  assignees: [],
  childrenCount: 0,
  parentTitle: null,
  parentType: null,
  parentTaskId: null,
  createdBy: null,
  projectName: null,
  projectColor: null,
  isVirtualColumn: false,
  ...overrides,
});

describe("buildBoardAssigneeOptions", () => {
  it("prioriza nombres visibles desde la relación de assignees", () => {
    const options = buildBoardAssigneeOptions([
      {
        items: [
          createMockItem("1", {
            assignees: [
              {
                id: "a-1",
                workItemId: "1",
                userId: "u-1",
                role: "responsible",
                assignedAt: new Date().toISOString(),
                user: {
                  id: "u-1",
                  name: "Sam Rivera",
                  email: "sam@example.com",
                  image: null,
                },
              },
            ],
          }),
        ],
      },
    ]);

    expect(options).toEqual([{ value: "Sam Rivera", label: "Sam Rivera" }]);
  });

  it("mantiene valores legacy legibles cuando no parecen identificadores opacos", () => {
    const options = buildBoardAssigneeOptions([
      {
        items: [
          createMockItem("1", { assignee: "Alex Rivera" }),
          createMockItem("2", { assignee: "soporte@almirant.ai" }),
        ],
      },
    ]);

    expect(options).toEqual([
      { value: "Alex Rivera", label: "Alex Rivera" },
      { value: "soporte@almirant.ai", label: "soporte@almirant.ai" },
    ]);
  });

  it("excluye strings alfanuméricos largos del campo legacy", () => {
    const options = buildBoardAssigneeOptions([
      {
        items: [
          createMockItem("1", { assignee: "8X3UKM7isakSAtnkpKuhiilbznUmUZJj" }),
          createMockItem("2", {
            assignees: [
              {
                id: "a-2",
                workItemId: "2",
                userId: "u-2",
                role: "responsible",
                assignedAt: new Date().toISOString(),
                user: {
                  id: "u-2",
                  name: "Ana Perez",
                  email: "ana@almirant.ai",
                  image: null,
                },
              },
            ],
          }),
        ],
      },
    ]);

    expect(options).toEqual([{ value: "Ana Perez", label: "Ana Perez" }]);
  });

  it("deduplica nombres repetidos entre assignees y legacy", () => {
    const options = buildBoardAssigneeOptions([
      {
        items: [
          createMockItem("1", {
            assignee: "Ana Perez",
            assignees: [
              {
                id: "a-3",
                workItemId: "1",
                userId: "u-3",
                role: "responsible",
                assignedAt: new Date().toISOString(),
                user: {
                  id: "u-3",
                  name: "Ana Perez",
                  email: "ana@almirant.ai",
                  image: null,
                },
              },
            ],
          }),
        ],
      },
    ]);

    expect(options).toEqual([{ value: "Ana Perez", label: "Ana Perez" }]);
  });
});
