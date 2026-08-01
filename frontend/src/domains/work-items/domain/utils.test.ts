import { describe, expect, it } from "bun:test";
import { toOptionalIsoString, toOptionalFormDate, isFutureDate, scheduledVisibilityChanged } from "./utils";

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

// Covers the "Scheduled" badge visibility rule: mirrors the backend's
// `isScheduledForLater` in backlog-drain-selection.ts (gate #47) — a
// null/undefined start date, or one already in the past, is NOT "scheduled"
// and must not surface the badge.
describe("isFutureDate", () => {
  const now = new Date("2026-08-01T12:00:00.000Z");

  it("is true for a date strictly after now", () => {
    expect(isFutureDate("2026-08-15T00:00:00.000Z", now)).toBe(true);
  });

  it("is false for a date in the past", () => {
    expect(isFutureDate("2026-07-01T00:00:00.000Z", now)).toBe(false);
  });

  it("is false when exactly equal to now (not strictly future)", () => {
    expect(isFutureDate(new Date(now), now)).toBe(false);
  });

  it("is false for null", () => {
    expect(isFutureDate(null, now)).toBe(false);
  });

  it("is false for undefined", () => {
    expect(isFutureDate(undefined, now)).toBe(false);
  });

  it("is false for an unparsable date string", () => {
    expect(isFutureDate("not-a-date", now)).toBe(false);
  });

  it("accepts a Date instance directly", () => {
    expect(isFutureDate(new Date("2026-08-15T00:00:00.000Z"), now)).toBe(true);
  });

  it("defaults `now` to the current time when omitted", () => {
    const farFuture = new Date(Date.now() + 1000 * 60 * 60 * 24 * 365);
    expect(isFutureDate(farFuture)).toBe(true);
    const farPast = new Date(Date.now() - 1000 * 60 * 60 * 24 * 365);
    expect(isFutureDate(farPast)).toBe(false);
  });
});

// Review fix (T2.1 #2): drives `WorkItemCard`'s memo comparator. The board
// ticks `now` every 60s (`useMinuteNow`) so the "Scheduled" badge stops going
// stale once its startDate passes — but re-rendering EVERY card on EVERY tick
// would defeat the point of memoizing the (expensive) card. This pure
// predicate isolates exactly when a tick can flip `isFutureDate`'s result for
// a given item, so the comparator only bails out of memoization then.
describe("scheduledVisibilityChanged", () => {
  const before = new Date("2026-08-01T11:00:00.000Z");
  const boundary = new Date("2026-08-01T12:00:00.000Z");
  const after = new Date("2026-08-01T13:00:00.000Z");

  it("is false when the item has no startDate — a tick must never re-render it", () => {
    expect(scheduledVisibilityChanged(null, before, after)).toBe(false);
    expect(scheduledVisibilityChanged(undefined, before, after)).toBe(false);
  });

  it("is true when `now` advances past startDate (badge must disappear)", () => {
    // now < startDate < after: badge visible -> hidden.
    expect(scheduledVisibilityChanged(boundary, before, after)).toBe(true);
  });

  it("is true when `now` moves backward before startDate (badge must reappear)", () => {
    expect(scheduledVisibilityChanged(boundary, after, before)).toBe(true);
  });

  it("is false when startDate stays in the future across both `now` values", () => {
    const farFuture = new Date("2026-12-01T00:00:00.000Z");
    expect(scheduledVisibilityChanged(farFuture, before, after)).toBe(false);
  });

  it("is false when startDate stays in the past across both `now` values", () => {
    const farPast = new Date("2026-01-01T00:00:00.000Z");
    expect(scheduledVisibilityChanged(farPast, before, after)).toBe(false);
  });

  it("is false when `now` doesn't change at all", () => {
    expect(scheduledVisibilityChanged(boundary, before, before)).toBe(false);
  });
});
