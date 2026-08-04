import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const apiRoot = resolve(import.meta.dir, "../../../");
const databaseRoot = resolve(import.meta.dir, "../../../../packages/database/src");
const read = (root: string, relativePath: string) => readFileSync(resolve(root, relativePath), "utf8");

describe("legacy webhook trigger guard", () => {
  test("keeps the historical enum but blocks legacy records in runtime repository paths", () => {
    const repository = read(databaseRoot, "repositories/project-management/webhook-repository.ts");
    const schema = read(databaseRoot, "schema/enums.ts");
    expect(schema).toContain('"sprint_closed"');
    expect(repository).toContain("LEGACY_SPRINT_TRIGGER");
    expect(repository).toContain("activeWebhookCondition");
    expect(repository).toContain('if (trigger === LEGACY_SPRINT_TRIGGER) return []');
    expect(repository).toContain('throw new Error("Unsupported webhook trigger")');
  });

  test("rejects create/update attempts before they reach the enum-backed repository", () => {
    const routes = read(apiRoot, "src/domains/webhooks/routes/webhooks.routes.ts");
    expect(routes).toContain('const LEGACY_SPRINT_TRIGGER = "sprint_closed"');
    expect(routes.match(/body\.trigger === LEGACY_SPRINT_TRIGGER/g)).toHaveLength(2);
    expect(routes).toContain('errorResponse("Unsupported webhook trigger")');
  });
});
