import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const read = (relativePath: string) => readFileSync(resolve(root, relativePath), "utf8");
const retiredTerm = ["spr", "int"].join("");

describe("retired cycle surface guard", () => {
  test("does not expose retired board, project, or API surfaces", () => {
    expect(read("src/lib/api/client.ts")).not.toContain("sprintsApi");
    expect(read("src/domains/projects/presentation/containers/project-detail-container.tsx")).not.toContain(
      retiredTerm
    );
    expect(read("src/domains/work-items/presentation/containers/work-item-board-container.tsx")).not.toContain(
      retiredTerm
    );
  });

  test("does not keep retired route or domain files", () => {
    expect(existsSync(resolve(root, "src/domains/sprints"))).toBe(false);
    expect(existsSync(resolve(root, "src/app/(app-shell)/(dashboard)/board/[area]/sprints"))).toBe(false);
  });

  test("does not keep retired copy or tool labels", () => {
    for (const relativePath of [
      "messages/en.json",
      "messages/es.json",
      "src/domains/shared/presentation/components/streaming-blocks/tool-icon.tsx",
      "src/domains/shared/domain/types.ts",
      "src/domains/webhooks/application/hooks/use-webhook-form.ts",
    ]) {
      expect(read(relativePath).toLowerCase()).not.toContain(retiredTerm);
    }
  });
});
