import { describe, expect, it } from "bun:test";
import { classifyError, type ErrorClassification } from "./types";

describe("classifyError", () => {
  it("no longer classifies a bare mention of memory as a recoverable OOM", () => {
    expect(classifyError("could not allocate the memory pool config")).not.toBe(
      "recoverable_oom",
    );
  });

  it("still honours an explicitly attached classification", () => {
    const error = new Error("out of memory") as Error & {
      classification?: ErrorClassification;
    };
    error.classification = "recoverable_disconnect";

    expect(classifyError(error)).toBe("recoverable_disconnect");
  });
});
