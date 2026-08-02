import { describe, expect, test } from "bun:test";
import { createExecutionBoundary } from "./execution-boundary";

describe("createExecutionBoundary", () => {
  test("is always open when no deadline is configured", () => {
    const boundary = createExecutionBoundary();

    expect(() => boundary.assertOpen()).not.toThrow();
    expect(boundary.timeoutMs(30_000)).toBe(30_000);
  });

  test("clamps the configured timeout to the remaining budget before the deadline", () => {
    const now = new Date("2026-07-20T12:00:00.000Z");
    const boundary = createExecutionBoundary({
      deadlineAt: new Date("2026-07-20T12:00:00.500Z"),
      now: () => now,
    });

    expect(boundary.timeoutMs(30_000)).toBe(500);
  });

  test("does not clamp when the configured timeout is already inside the remaining budget", () => {
    const now = new Date("2026-07-20T12:00:00.000Z");
    const boundary = createExecutionBoundary({
      deadlineAt: new Date("2026-07-20T13:00:00.000Z"),
      now: () => now,
    });

    expect(boundary.timeoutMs(30_000)).toBe(30_000);
  });

  test("subtracts the terminal margin from the remaining budget", () => {
    const now = new Date("2026-07-20T12:00:00.000Z");
    const boundary = createExecutionBoundary({
      deadlineAt: new Date("2026-07-20T12:00:01.000Z"),
      now: () => now,
      terminalMarginMs: 400,
    });

    expect(boundary.timeoutMs(30_000)).toBe(600);
  });

  test("assertOpen throws once the deadline (minus margin) has passed", () => {
    const now = new Date("2026-07-20T12:00:00.500Z");
    const boundary = createExecutionBoundary({
      deadlineAt: new Date("2026-07-20T12:00:00.500Z"),
      now: () => now,
    });

    expect(() => boundary.assertOpen()).toThrow(
      "execution_boundary_deadline_exceeded",
    );
  });

  test("the clock is re-read on every call so an earlier check cannot authorize later work", () => {
    let current = new Date("2026-07-20T12:00:00.000Z");
    const boundary = createExecutionBoundary({
      deadlineAt: new Date("2026-07-20T12:00:00.500Z"),
      now: () => current,
    });

    expect(() => boundary.assertOpen()).not.toThrow();
    current = new Date("2026-07-20T12:00:00.600Z");
    expect(() => boundary.assertOpen()).toThrow(
      "execution_boundary_deadline_exceeded",
    );
  });

  test("signal() returns a fresh AbortSignal bounded by the configured timeout", () => {
    const boundary = createExecutionBoundary();
    const signal = boundary.signal(30_000);

    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(false);
  });

  test("signal() throws immediately once the deadline has already passed", () => {
    const now = new Date("2026-07-20T12:00:01.000Z");
    const boundary = createExecutionBoundary({
      deadlineAt: new Date("2026-07-20T12:00:00.000Z"),
      now: () => now,
    });

    expect(() => boundary.signal(30_000)).toThrow(
      "execution_boundary_deadline_exceeded",
    );
  });

  test("rejects a non-positive configured timeout", () => {
    const boundary = createExecutionBoundary();

    expect(() => boundary.timeoutMs(0)).toThrow("execution_boundary_invalid");
    expect(() => boundary.timeoutMs(-1)).toThrow("execution_boundary_invalid");
  });

  test("rejects an invalid (NaN) deadline", () => {
    const boundary = createExecutionBoundary({
      deadlineAt: new Date(Number.NaN),
      now: () => new Date(),
    });

    expect(() => boundary.assertOpen()).toThrow("execution_boundary_invalid");
  });
});
