import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const provider = readFileSync(resolve(import.meta.dir, "websocket-provider.tsx"), "utf8");
const wsTypes = readFileSync(resolve(import.meta.dir, "../../domain/ws-types.ts"), "utf8");

describe("retention WebSocket invalidation", () => {
  test("subscribes to the batch invalidation contract", () => {
    expect(provider).toContain('subscribeRef.current("work-items:invalidated"');
    expect(provider).toContain('queryClientRef.current.invalidateQueries({ queryKey: ["work-items"] });');
    expect(provider).toContain('queryClientRef.current.invalidateQueries({ queryKey: ["boards"] });');
    expect(wsTypes).toContain('type: "work-items:invalidated"');
  });

  test("does not turn background retention into per-item update toasts", () => {
    const handler = provider.slice(
      provider.indexOf('subscribeRef.current("work-items:invalidated"'),
      provider.indexOf('subscribeRef.current("work-item:updated"'),
    );
    expect(handler).not.toContain("showToast");
  });
});
