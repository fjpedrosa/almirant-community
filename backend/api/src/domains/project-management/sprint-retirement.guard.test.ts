import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../../../");
const read = (relativePath: string) => readFileSync(resolve(root, relativePath), "utf8");
const retiredSharePost = ["share", "Post"].join("");

describe("retired sprint runtime guard", () => {
  test("does not mount sprint REST routes or register sprint MCP tools", () => {
    expect(read("src/domains/project-management/index.ts")).not.toContain("sprintsModule");
    expect(read("src/domains/project-management/boards/routes/boards.routes.ts")).not.toContain("/sprints");
    expect(read("src/mcp/setup/public.ts")).not.toContain("registerSprintsTools");
  });

  test("removes retired copy, AI, and tool labels from active surfaces", () => {
    expect(read("src/domains/ai/generation/routes/ai.routes.ts")).not.toContain(retiredSharePost);
    expect(read("src/domains/ai/shared/services/ai-service.ts")).not.toContain(retiredSharePost);
    expect(read("../packages/i18n/src/translations/en.ts")).not.toContain("sprint");
    expect(read("../packages/i18n/src/translations/es.ts")).not.toContain("sprint");
    expect(read("../../services/discord-bridge/src/rendering/tool-humanizer.ts")).not.toContain("sprint");
  });

  test("does not keep the retired sprint route/module files", () => {
    expect(existsSync(resolve(root, "src/domains/project-management/sprints/routes/sprints.routes.ts"))).toBe(false);
    expect(existsSync(resolve(root, "src/domains/project-management/sprints/index.ts"))).toBe(false);
  });
});
