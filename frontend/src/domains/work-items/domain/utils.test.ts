import { describe, expect, it } from "bun:test";
import { toOptionalIsoString, toOptionalFormDate } from "./utils";

// Covers the start-date gate (work item won't be auto-picked up before this
// date): the value must be settable AND clearable back to null/undefined
// across the form <-> request round trip.

describe("toOptionalIsoString (form Date -> request value)", () => {
  it("fijar: converts a set Date to its ISO string", () => {
    const date = new Date("2026-08-15T00:00:00.000Z");
    expect(toOptionalIsoString(date)).toBe("2026-08-15T00:00:00.000Z");
  });

  it("limpiar: converts undefined (cleared field) to null", () => {
    expect(toOptionalIsoString(undefined)).toBeNull();
  });
});

describe("toOptionalFormDate (persisted value -> form Date)", () => {
  it("hydrates an ISO string into a Date instance", () => {
    const result = toOptionalFormDate("2026-08-15T00:00:00.000Z");
    expect(result).toBeInstanceOf(Date);
    expect(result?.toISOString()).toBe("2026-08-15T00:00:00.000Z");
  });

  it("hydrates a Date instance as-is", () => {
    const date = new Date("2026-08-15T00:00:00.000Z");
    const result = toOptionalFormDate(date);
    expect(result).toBeInstanceOf(Date);
    expect(result?.toISOString()).toBe(date.toISOString());
  });

  it("maps null (no start date persisted) to undefined", () => {
    expect(toOptionalFormDate(null)).toBeUndefined();
  });

  it("maps undefined to undefined", () => {
    expect(toOptionalFormDate(undefined)).toBeUndefined();
  });

  it("round-trips: set then clear then re-hydrate stays empty", () => {
    const cleared = toOptionalIsoString(undefined); // user cleared the field
    expect(cleared).toBeNull();
    // Server would persist `null`; re-hydrating that into the form must stay empty.
    expect(toOptionalFormDate(cleared)).toBeUndefined();
  });
});
