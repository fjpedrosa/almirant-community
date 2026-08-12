import { describe, expect, it } from "bun:test";
import {
  MAX_LEGACY_CONVERSION_DEPTH,
  MAX_LEGACY_CONVERSION_NODES,
  MAX_LEGACY_CONVERSION_SNAPSHOT_BYTES,
  serializeLegacySnapshotForConversion,
} from "./legacy-snapshot-serializer";

describe("legacy snapshot conversion serializer", () => {
  it("preserves canonical PostgreSQL JSON text byte-for-byte without a parsed-object path", () => {
    const snapshotText = "{\"decimal\": 12345678901234567890.12345678901234567890, \"exponent\": 1e+100000, \"unsafeInteger\": 9007199254740993}";

    expect(serializeLegacySnapshotForConversion(snapshotText)).toBe(snapshotText);
    expect(() => serializeLegacySnapshotForConversion(
      JSON.parse("{\"unsafeInteger\":9007199254740993}") as never,
    )).toThrow("LEGACY_SNAPSHOT_INVALID");
  });

  it("bounds shallow bytes, structural depth, and width without recursion", () => {
    const shallow = "{\"title\": \"Bounded\", \"values\": [1, true, null]}";
    const nestedContainers = MAX_LEGACY_CONVERSION_DEPTH + 2;
    const deeplyNested = `${"[".repeat(nestedContainers)}0${"]".repeat(nestedContainers)}`;
    const wide = `[${new Array(MAX_LEGACY_CONVERSION_NODES).fill("0").join(",")}]`;
    const oversized = `\"${"x".repeat(MAX_LEGACY_CONVERSION_SNAPSHOT_BYTES)}\"`;

    expect(serializeLegacySnapshotForConversion(shallow)).toBe(shallow);
    expect(() => serializeLegacySnapshotForConversion(deeplyNested)).toThrow(
      "LEGACY_SNAPSHOT_TOO_LARGE",
    );
    expect(() => serializeLegacySnapshotForConversion(wide)).toThrow(
      "LEGACY_SNAPSHOT_TOO_LARGE",
    );
    expect(() => serializeLegacySnapshotForConversion(oversized)).toThrow(
      "LEGACY_SNAPSHOT_TOO_LARGE",
    );
  });

  it("validates opaque JSON text without JSON.parse or recursive object traversal", () => {
    for (const malformed of [
      "{",
      "[1,]",
      "{\"missing\":}",
      "01",
      "\"unterminated",
      "{\"badEscape\":\"\\x\"}",
      "true false",
    ]) {
      expect(() => serializeLegacySnapshotForConversion(malformed)).toThrow(
        "LEGACY_SNAPSHOT_INVALID",
      );
    }

    let getterCalls = 0;
    const accessor = {} as Record<string, unknown>;
    Object.defineProperty(accessor, "secret", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "must not execute";
      },
    });
    expect(() => serializeLegacySnapshotForConversion(accessor as never)).toThrow(
      "LEGACY_SNAPSHOT_INVALID",
    );
    expect(getterCalls).toBe(0);
  });
});
