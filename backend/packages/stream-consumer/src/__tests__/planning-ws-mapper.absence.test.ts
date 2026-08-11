import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const streamConsumerRoot = resolve(import.meta.dir, "../..");
const retiredPaths = [
  "src/planning-ws-mapper.ts",
  "src/__tests__/planning-ws-mapper.test.ts",
] as const;

describe("planning WebSocket mapper source contract", () => {
  test("keeps issue #125 orphan mapper files absent", () => {
    for (const retiredPath of retiredPaths) {
      expect(existsSync(resolve(streamConsumerRoot, retiredPath))).toBe(false);
    }
  });
});
