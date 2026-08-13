import { describe, expect, it } from "bun:test";
import { mapErrorCategory } from "./error-classification";

describe("mapErrorCategory", () => {
  // No production caller ever passes a ContainerFailureSignal (verified: the
  // parameter had zero callers anywhere in this service, with or without a
  // signal argument) — carrying it kept oomEvidence/oomConfidence dead on
  // arrival, since they could never reach the events they were meant to enrich.
  it("does not declare an unused container-failure-signal parameter", () => {
    expect(mapErrorCategory.length).toBe(1);
  });

  it("maps recoverable_oom to the oom error code", () => {
    expect(mapErrorCategory("recoverable_oom")).toEqual({
      errorCode: "oom",
      errorCategory: "infra",
      recoverable: true,
    });
  });

  it("maps recoverable_timeout to the timeout error code", () => {
    expect(mapErrorCategory("recoverable_timeout")).toEqual({
      errorCode: "timeout",
      errorCategory: "infra",
      recoverable: true,
    });
  });
});
