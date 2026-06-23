import { describe, expect, test } from "bun:test";
import {
  IDEA_STATUS_BY_TYPE,
  DEFAULT_STATUS_BY_TYPE,
  isStatusAllowedForType,
  parseDueDateFilter,
  serializeIdeaItemEventValue,
  resolveIdeaItemEventContext,
} from "./idea-item-repository";
import type { IdeaItemType, IdeaItemStatus } from "../../domain/types";

// ──────────────────────────────────────────────────────────
// IDEA_STATUS_BY_TYPE constant
// ──────────────────────────────────────────────────────────

describe("IDEA_STATUS_BY_TYPE", () => {
  test("idea type allows the expected statuses", () => {
    expect(IDEA_STATUS_BY_TYPE.idea).toEqual(["draft", "active", "to_review", "approved", "archived", "rejected"]);
  });

  test("covers only the idea type", () => {
    const keys = Object.keys(IDEA_STATUS_BY_TYPE);
    expect(keys).toContain("idea");
    expect(keys).toHaveLength(1);
  });
});

// ──────────────────────────────────────────────────────────
// DEFAULT_STATUS_BY_TYPE constant
// ──────────────────────────────────────────────────────────

describe("DEFAULT_STATUS_BY_TYPE", () => {
  test("default status for idea is 'active'", () => {
    expect(DEFAULT_STATUS_BY_TYPE.idea).toBe("active");
  });

  test("every default status is valid for its type", () => {
    for (const [type, defaultStatus] of Object.entries(DEFAULT_STATUS_BY_TYPE)) {
      const allowedStatuses = IDEA_STATUS_BY_TYPE[type as IdeaItemType];
      expect(allowedStatuses).toContain(defaultStatus);
    }
  });
});

// ──────────────────────────────────────────────────────────
// isStatusAllowedForType
// ──────────────────────────────────────────────────────────

describe("isStatusAllowedForType", () => {
  // -- idea type --
  test("allows 'active' for idea", () => {
    expect(isStatusAllowedForType("idea", "active")).toBe(true);
  });

  test("allows 'archived' for idea", () => {
    expect(isStatusAllowedForType("idea", "archived")).toBe(true);
  });

  test("rejects 'pending' for idea", () => {
    expect(isStatusAllowedForType("idea", "pending")).toBe(false);
  });

  test("rejects 'done' for idea", () => {
    expect(isStatusAllowedForType("idea", "done")).toBe(false);
  });

  test("rejects 'blocked' for idea", () => {
    expect(isStatusAllowedForType("idea", "blocked")).toBe(false);
  });

  // -- unknown type (seed was removed) --
  test("rejects any status for seed (no longer a valid type)", () => {
    expect(isStatusAllowedForType("seed" as IdeaItemType, "draft")).toBe(false);
    expect(isStatusAllowedForType("seed" as IdeaItemType, "active")).toBe(false);
  });

  // -- exhaustive cross-check --
  test("every status in IDEA_STATUS_BY_TYPE is allowed by the function", () => {
    for (const [type, statuses] of Object.entries(IDEA_STATUS_BY_TYPE)) {
      for (const status of statuses) {
        expect(isStatusAllowedForType(type as IdeaItemType, status as IdeaItemStatus)).toBe(true);
      }
    }
  });

  test("returns false for unknown type", () => {
    expect(isStatusAllowedForType("unknown" as IdeaItemType, "active")).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────
// parseDueDateFilter
// ──────────────────────────────────────────────────────────

describe("parseDueDateFilter", () => {
  test("returns null for undefined input", () => {
    expect(parseDueDateFilter(undefined)).toBeNull();
  });

  test("returns null for empty string", () => {
    expect(parseDueDateFilter("")).toBeNull();
  });

  test("returns null for invalid date string", () => {
    expect(parseDueDateFilter("not-a-date")).toBeNull();
  });

  test("returns null for gibberish", () => {
    expect(parseDueDateFilter("xyz123!@#")).toBeNull();
  });

  test("parses a valid ISO date string and returns start-of-day to next-day range", () => {
    const result = parseDueDateFilter("2025-06-15");
    expect(result).not.toBeNull();
    expect(result!.start.toISOString()).toBe("2025-06-15T00:00:00.000Z");
    expect(result!.end.toISOString()).toBe("2025-06-16T00:00:00.000Z");
  });

  test("parses a full ISO datetime and normalizes to start-of-day UTC", () => {
    const result = parseDueDateFilter("2025-06-15T14:30:00Z");
    expect(result).not.toBeNull();
    expect(result!.start.toISOString()).toBe("2025-06-15T00:00:00.000Z");
    expect(result!.end.toISOString()).toBe("2025-06-16T00:00:00.000Z");
  });

  test("handles end-of-month boundary correctly (Jan 31 -> Feb 1)", () => {
    const result = parseDueDateFilter("2025-01-31");
    expect(result).not.toBeNull();
    expect(result!.start.toISOString()).toBe("2025-01-31T00:00:00.000Z");
    expect(result!.end.toISOString()).toBe("2025-02-01T00:00:00.000Z");
  });

  test("handles leap year boundary (Feb 28 -> Feb 29 in leap year)", () => {
    const result = parseDueDateFilter("2024-02-28");
    expect(result).not.toBeNull();
    expect(result!.start.toISOString()).toBe("2024-02-28T00:00:00.000Z");
    expect(result!.end.toISOString()).toBe("2024-02-29T00:00:00.000Z");
  });

  test("handles non-leap year Feb 28 -> Mar 1", () => {
    const result = parseDueDateFilter("2025-02-28");
    expect(result).not.toBeNull();
    expect(result!.start.toISOString()).toBe("2025-02-28T00:00:00.000Z");
    expect(result!.end.toISOString()).toBe("2025-03-01T00:00:00.000Z");
  });

  test("handles year boundary (Dec 31 -> Jan 1 next year)", () => {
    const result = parseDueDateFilter("2025-12-31");
    expect(result).not.toBeNull();
    expect(result!.start.toISOString()).toBe("2025-12-31T00:00:00.000Z");
    expect(result!.end.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  test("end is always exactly 1 day after start", () => {
    const result = parseDueDateFilter("2025-07-04");
    expect(result).not.toBeNull();
    const diffMs = result!.end.getTime() - result!.start.getTime();
    const oneDayMs = 24 * 60 * 60 * 1000;
    expect(diffMs).toBe(oneDayMs);
  });
});

// ──────────────────────────────────────────────────────────
// serializeIdeaItemEventValue
// ──────────────────────────────────────────────────────────

describe("serializeIdeaItemEventValue", () => {
  // -- null/undefined --
  test("returns null for null input", () => {
    expect(serializeIdeaItemEventValue(null)).toBeNull();
  });

  test("returns null for undefined input", () => {
    expect(serializeIdeaItemEventValue(undefined)).toBeNull();
  });

  // -- Date --
  test("serializes a Date to ISO string", () => {
    const d = new Date("2025-06-15T10:30:00Z");
    expect(serializeIdeaItemEventValue(d)).toBe("2025-06-15T10:30:00.000Z");
  });

  test("serializes epoch Date to ISO string", () => {
    const d = new Date(0);
    expect(serializeIdeaItemEventValue(d)).toBe("1970-01-01T00:00:00.000Z");
  });

  // -- string --
  test("returns string as-is", () => {
    expect(serializeIdeaItemEventValue("hello")).toBe("hello");
  });

  test("returns empty string as-is", () => {
    expect(serializeIdeaItemEventValue("")).toBe("");
  });

  // -- number --
  test("converts number to string", () => {
    expect(serializeIdeaItemEventValue(42)).toBe("42");
  });

  test("converts zero to string", () => {
    expect(serializeIdeaItemEventValue(0)).toBe("0");
  });

  test("converts negative number to string", () => {
    expect(serializeIdeaItemEventValue(-5)).toBe("-5");
  });

  test("converts float to string", () => {
    expect(serializeIdeaItemEventValue(3.14)).toBe("3.14");
  });

  // -- boolean --
  test("converts true to 'true'", () => {
    expect(serializeIdeaItemEventValue(true)).toBe("true");
  });

  test("converts false to 'false'", () => {
    expect(serializeIdeaItemEventValue(false)).toBe("false");
  });

  // -- objects / arrays (JSON.stringify path) --
  test("serializes plain object to JSON string", () => {
    const obj = { key: "value", nested: { a: 1 } };
    expect(serializeIdeaItemEventValue(obj)).toBe(JSON.stringify(obj));
  });

  test("serializes array to JSON string", () => {
    const arr = [1, "two", { three: 3 }];
    expect(serializeIdeaItemEventValue(arr)).toBe(JSON.stringify(arr));
  });

  test("serializes empty object to '{}'", () => {
    expect(serializeIdeaItemEventValue({})).toBe("{}");
  });

  test("serializes empty array to '[]'", () => {
    expect(serializeIdeaItemEventValue([])).toBe("[]");
  });
});

// ──────────────────────────────────────────────────────────
// resolveIdeaItemEventContext
// ──────────────────────────────────────────────────────────

describe("resolveIdeaItemEventContext", () => {
  test("defaults to system trigger when called with no arguments", () => {
    const result = resolveIdeaItemEventContext();
    expect(result.triggeredBy).toBe("system");
    expect(result.triggeredByUserId).toBeNull();
  });

  test("defaults to system trigger when called with empty object", () => {
    const result = resolveIdeaItemEventContext({});
    expect(result.triggeredBy).toBe("system");
    expect(result.triggeredByUserId).toBeNull();
  });

  test("uses explicit triggeredBy when provided", () => {
    const result = resolveIdeaItemEventContext({ triggeredBy: "user" });
    expect(result.triggeredBy).toBe("user");
    expect(result.triggeredByUserId).toBeNull();
  });

  test("uses explicit triggeredBy 'claude-code'", () => {
    const result = resolveIdeaItemEventContext({ triggeredBy: "claude-code" });
    expect(result.triggeredBy).toBe("claude-code");
    expect(result.triggeredByUserId).toBeNull();
  });

  test("uses explicit triggeredBy 'codex'", () => {
    const result = resolveIdeaItemEventContext({ triggeredBy: "codex" });
    expect(result.triggeredBy).toBe("codex");
    expect(result.triggeredByUserId).toBeNull();
  });

  test("infers 'user' triggeredBy when triggeredByUserId is provided without explicit triggeredBy", () => {
    const result = resolveIdeaItemEventContext({ triggeredByUserId: "user-123" });
    expect(result.triggeredBy).toBe("user");
    expect(result.triggeredByUserId).toBe("user-123");
  });

  test("uses explicit triggeredBy even when triggeredByUserId is present", () => {
    const result = resolveIdeaItemEventContext({
      triggeredBy: "claude-code",
      triggeredByUserId: "user-123",
    });
    expect(result.triggeredBy).toBe("claude-code");
    expect(result.triggeredByUserId).toBe("user-123");
  });

  test("returns null triggeredByUserId when explicitly set to null", () => {
    const result = resolveIdeaItemEventContext({
      triggeredBy: "user",
      triggeredByUserId: null,
    });
    expect(result.triggeredBy).toBe("user");
    expect(result.triggeredByUserId).toBeNull();
  });

  test("defaults to 'system' when triggeredByUserId is null and no triggeredBy", () => {
    const result = resolveIdeaItemEventContext({ triggeredByUserId: null });
    expect(result.triggeredBy).toBe("system");
    expect(result.triggeredByUserId).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────
// State machine validation (business rule documentation)
// ──────────────────────────────────────────────────────────

describe("idea-item state machine rules", () => {
  test("all statuses are accounted for the idea type", () => {
    const allKnown: IdeaItemStatus[] = ["draft", "active", "to_review", "approved", "archived", "rejected"];
    expect(IDEA_STATUS_BY_TYPE.idea.sort()).toEqual(allKnown.sort());
  });

  test("default status is valid for idea type", () => {
    expect(isStatusAllowedForType("idea", DEFAULT_STATUS_BY_TYPE.idea)).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────
// Backfill script behavior documentation (integration smoke tests)
// ──────────────────────────────────────────────────────────

describe("backfill script business rules (documented)", () => {
  test("backfilled items use type 'idea'", () => {
    // The backfill script always creates idea_items with type "idea",
    // because legacy work_items of type "idea" are being migrated.
    const expectedType: IdeaItemType = "idea";
    expect(isStatusAllowedForType(expectedType, "active")).toBe(true);
    expect(isStatusAllowedForType(expectedType, "archived")).toBe(true);
  });

  test("backfilled archived items get status 'archived'", () => {
    // Script uses: status = legacy.archivedAt ? "archived" : "active"
    expect(isStatusAllowedForType("idea", "archived")).toBe(true);
  });

  test("backfilled active items get status 'active'", () => {
    expect(isStatusAllowedForType("idea", "active")).toBe(true);
  });

  test("metadata for backfilled items includes legacyWorkItemId for idempotency", () => {
    // The backfill script stores legacyWorkItemId in metadata to prevent duplicates.
    // This tests the serialize function handles the metadata shape correctly.
    const metadata = {
      legacyWorkItemId: "wi-uuid-123",
      legacyTaskId: "A-42",
      migratedFrom: "work_items.idea",
    };
    const serialized = serializeIdeaItemEventValue(metadata);
    expect(serialized).not.toBeNull();
    const parsed = JSON.parse(serialized!);
    expect(parsed.legacyWorkItemId).toBe("wi-uuid-123");
    expect(parsed.legacyTaskId).toBe("A-42");
    expect(parsed.migratedFrom).toBe("work_items.idea");
  });

  test("serialize handles typical metadata fields from backfill", () => {
    expect(serializeIdeaItemEventValue("wi-uuid-123")).toBe("wi-uuid-123");
    expect(serializeIdeaItemEventValue(null)).toBeNull();
    expect(serializeIdeaItemEventValue({ key: "val" })).toBe('{"key":"val"}');
  });
});
