import { describe, expect, it } from "bun:test";
import { DEVELOPMENT_BOARD_WORKFLOW, getDevelopmentBoardColumns } from "./development-board-workflow";

const boardRepositorySource = await Bun.file(
  new URL("../repositories/project-management/board-repository.ts", import.meta.url),
).text();
const updateBoardSource = boardRepositorySource.slice(
  boardRepositorySource.indexOf("export const updateBoard"),
  boardRepositorySource.indexOf("// Delete board"),
);

describe("development board workflow", () => {
  it("defines the exact canonical seven-column contract", () => {
    expect(DEVELOPMENT_BOARD_WORKFLOW).toEqual([
      { name: "Backlog", role: "backlog", order: 0, color: "#94a3b8", isDone: false },
      { name: "To Do", role: "todo", order: 1, color: "#6366f1", isDone: false },
      { name: "In Progress", role: "in_progress", order: 2, color: "#f59e0b", isDone: false },
      { name: "To Review", role: "review", order: 3, color: "#8b5cf6", isDone: false },
      { name: "Validating", role: "validating", order: 4, color: "#ec4899", isDone: false },
      { name: "To Release", role: "release", order: 5, color: "#a855f7", isDone: false },
      { name: "Done", role: "done", order: 6, color: "#22c55e", isDone: true },
    ]);
  });

  it("returns a fresh canonical copy so consumers cannot mutate the contract", () => {
    const columns = getDevelopmentBoardColumns();
    columns[0]!.name = "mutated";
    columns[0]!.color = "#000000";
    expect(DEVELOPMENT_BOARD_WORKFLOW[0]).toMatchObject({ name: "Backlog", color: "#94a3b8" });
  });

  it("serializes transitions and guards the canonical workflow", () => {
    expect(updateBoardSource).toContain("db.transaction(async (tx)");
    expect(updateBoardSource).toContain('.for("update")');
    expect(updateBoardSource.indexOf("db.transaction(async (tx)"))
      .toBeLessThan(updateBoardSource.indexOf(".update(boards)"));
    expect(updateBoardSource).toContain("isCanonicalDevelopmentColumns");
    expect(updateBoardSource).toContain("developmentColumns.length === 0");
    expect(updateBoardSource).toContain("Cannot move populated noncanonical board to Desarrollo");
    expect(updateBoardSource).toContain("tx.insert(boardColumns)");
  });
});
