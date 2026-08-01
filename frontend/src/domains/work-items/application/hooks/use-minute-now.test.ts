import { describe, expect, it, spyOn } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import { useMinuteNow } from "./use-minute-now";

// Review fix (T2.1 #2): the "Scheduled" badge (`ScheduledBadge`) evaluates
// `isFutureDate(startDate, now)` at render time, but `WorkItemCard` is
// memoized and the board query has a 5-minute `staleTime` — so an open tab
// never re-evaluates the badge once startDate passes. `useMinuteNow` forces
// a periodic re-render (every 60s) so the board/detail panel re-check
// visibility on a fixed cadence instead of relying on an unrelated refetch.
describe("useMinuteNow", () => {
  it("returns the current time on mount", () => {
    const before = Date.now();
    const { result, unmount } = renderHook(() => useMinuteNow());
    try {
      expect(result.current).toBeInstanceOf(Date);
      expect(result.current.getTime()).toBeGreaterThanOrEqual(before);
    } finally {
      unmount();
    }
  });

  it("registers a 60s interval and refreshes `now` when it fires", () => {
    const setIntervalSpy = spyOn(globalThis, "setInterval");
    const { result, unmount } = renderHook(() => useMinuteNow());
    try {
      expect(setIntervalSpy).toHaveBeenCalledTimes(1);
      const [tick, delay] = setIntervalSpy.mock.calls[0] as unknown as [() => void, number];
      expect(delay).toBe(60_000);

      const initial = result.current;
      act(() => {
        tick();
      });

      expect(result.current).not.toBe(initial);
      expect(result.current.getTime()).toBeGreaterThanOrEqual(initial.getTime());
    } finally {
      unmount();
      setIntervalSpy.mockRestore();
    }
  });

  it("clears the interval on unmount (no leaked timers on a closed tab)", () => {
    const clearIntervalSpy = spyOn(globalThis, "clearInterval");
    const { unmount } = renderHook(() => useMinuteNow());

    unmount();

    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
    clearIntervalSpy.mockRestore();
  });
});
