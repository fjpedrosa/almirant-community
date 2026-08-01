import { describe, expect, it } from "bun:test";
import { workItemCardPropsAreEqual, type WorkItemCardProps } from "./work-item-card.memo";
import type { WorkItemWithContext } from "../../domain/types";

// Review fix (T2.1 #2): `WorkItemCard` is memoized so the board doesn't
// re-render every card on every state change. The board now ticks a `now`
// prop every 60s (`useMinuteNow`) so the "Scheduled" badge stops going stale
// once its startDate passes. These tests pin down the comparator's new rule:
// only bail out of memoization for a `now` tick when it could actually flip
// THIS card's badge visibility — most cards have no startDate at all and
// must stay memoized across every tick.

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

const baseProps = (overrides: Partial<WorkItemCardProps> = {}): WorkItemCardProps => ({
  item: createMockItem("wi-1"),
  columnName: "Todo",
  now: new Date("2026-08-01T12:00:00.000Z"),
  ...overrides,
});

describe("workItemCardPropsAreEqual", () => {
  it("stays memoized (returns true) when only `now` ticks on an item without a startDate", () => {
    const prev = baseProps({ now: new Date("2026-08-01T12:00:00.000Z") });
    const next = baseProps({ item: prev.item, now: new Date("2026-08-01T12:01:00.000Z") });

    expect(workItemCardPropsAreEqual(prev, next)).toBe(true);
  });

  it("forces a re-render (returns false) when `now` advances past the item's startDate", () => {
    const scheduledItem = createMockItem("wi-2", {
      startDate: new Date("2026-08-01T12:30:00.000Z"),
    });
    const prev = baseProps({ item: scheduledItem, now: new Date("2026-08-01T12:00:00.000Z") });
    const next = baseProps({ item: scheduledItem, now: new Date("2026-08-01T13:00:00.000Z") });

    expect(workItemCardPropsAreEqual(prev, next)).toBe(false);
  });

  it("stays memoized when `now` ticks but the item's startDate is still far in the future", () => {
    const scheduledItem = createMockItem("wi-3", {
      startDate: new Date("2026-12-01T00:00:00.000Z"),
    });
    const prev = baseProps({ item: scheduledItem, now: new Date("2026-08-01T12:00:00.000Z") });
    const next = baseProps({ item: scheduledItem, now: new Date("2026-08-01T12:01:00.000Z") });

    expect(workItemCardPropsAreEqual(prev, next)).toBe(true);
  });

  it("still forces a re-render for unrelated field changes (sanity check on the refactor)", () => {
    const prev = baseProps();
    const next = baseProps({ item: { ...prev.item, title: "Renamed" }, now: prev.now });

    expect(workItemCardPropsAreEqual(prev, next)).toBe(false);
  });
});
