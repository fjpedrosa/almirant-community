import { afterEach, describe, expect, it } from "bun:test";
import { formatDuration } from "./formatters";
import { calculatePacing } from "./pacing";

const realDateNow = Date.now;

describe("formatDuration", () => {
  it("formats mixed day, hour, and minute durations", () => {
    expect(formatDuration(74.5)).toBe("3d 2h 30m");
  });

  it("omits zero-value segments", () => {
    expect(formatDuration(2.25)).toBe("2h 15m");
    expect(formatDuration(0.5)).toBe("30m");
    expect(formatDuration(24)).toBe("1d");
  });

  it("returns 0h for empty durations", () => {
    expect(formatDuration(0)).toBe("0h");
    expect(formatDuration(-1)).toBe("0h");
  });
});

describe("calculatePacing", () => {
  afterEach(() => {
    Date.now = realDateNow;
  });

  it("marks windows ahead when usage is more than 5% above pace", () => {
    Date.now = () => new Date("2026-03-11T12:00:00.000Z").getTime();

    const result = calculatePacing(
      0.7,
      "2026-03-11T15:00:00.000Z",
      10,
    );

    expect(result.expectedPercent).toBe(70);
    expect(result.actualPercent).toBe(70);
    expect(result.deviationPercent).toBe(0);
    expect(result.status).toBe("on-track");
  });

  it("marks windows ahead when utilization exceeds expected pace", () => {
    Date.now = () => new Date("2026-03-11T12:00:00.000Z").getTime();

    const result = calculatePacing(
      0.9,
      "2026-03-11T17:00:00.000Z",
      10,
    );

    expect(result.expectedPercent).toBe(50);
    expect(result.actualPercent).toBe(90);
    expect(result.deviationPercent).toBe(40);
    expect(result.status).toBe("ahead");
  });

  it("marks windows behind when utilization is more than 5% below pace", () => {
    Date.now = () => new Date("2026-03-11T12:00:00.000Z").getTime();

    const result = calculatePacing(
      0.2,
      "2026-03-11T17:00:00.000Z",
      10,
    );

    expect(result.expectedPercent).toBe(50);
    expect(result.actualPercent).toBe(20);
    expect(result.deviationPercent).toBe(-30);
    expect(result.status).toBe("behind");
  });

  it("clamps expired windows to 100% expected pace", () => {
    Date.now = () => new Date("2026-03-11T12:00:00.000Z").getTime();

    const result = calculatePacing(
      125,
      "2026-03-11T11:00:00.000Z",
      5,
    );

    expect(result.expectedPercent).toBe(100);
    expect(result.actualPercent).toBe(125);
    expect(result.status).toBe("ahead");
  });
});
