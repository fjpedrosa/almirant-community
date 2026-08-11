import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const apiRoot = resolve(import.meta.dir, "..");
const orphanPaths = [
  "src/shared/middleware/session-token-auth.middleware.ts",
  "src/shared/middleware/trace-id.ts",
  "src/shared/middleware/admin-auth.middleware.ts",
  "src/shared/ports/storage.port.ts",
  "src/shared/ports/notification.port.ts",
  "src/shared/ports/websocket.port.ts",
  "src/domains/documents/ports.ts",
  "src/deps.ts",
] as const;
const liveAdminGuardPath = "src/middleware/require-admin.middleware.ts";

describe("API orphan source contract", () => {
  test("keeps issue #121 orphan files absent and the live admin guard present", () => {
    for (const orphanPath of orphanPaths) {
      expect(existsSync(resolve(apiRoot, orphanPath))).toBe(false);
    }

    expect(existsSync(resolve(apiRoot, liveAdminGuardPath))).toBe(true);
  });

  test("keeps recurrence retired and fingerprint live", () => {
    for (const [path, present] of [["src/mcp/tools/error-recurrence.ts", false],
      ["src/mcp/tools/error-recurrence.test.ts", false],
      ["src/mcp/tools/error-fingerprint.ts", true],
      ["src/mcp/tools/error-fingerprint.test.ts", true]] as const) {
      expect(existsSync(resolve(apiRoot, path))).toBe(present);
    }
  });
});
