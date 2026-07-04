import { describe, expect, it } from "bun:test";
import { computeSessionModalGates } from "./session-modal-gating";

// The OLD inline gate in use-session-detail-modal.ts serialized the modal's
// secondary queries BEHIND the `detail` query:
//   useSessionOutput(..., { enabled: isOpen && !!detail })
//   useResourceTimeline(..., { enabled: isOpen && !!detail })
// Since the jobId is known from the URL, they must fire in PARALLEL with `detail`.
const oldGate = (isOpen: boolean, hasDetail: boolean): boolean => isOpen && hasDetail;

describe("computeSessionModalGates (parallelize modal pollers)", () => {
  it("enables output + resource-timeline whenever the modal is open", () => {
    expect(computeSessionModalGates(true)).toEqual({
      output: true,
      resourceTimeline: true,
    });
  });

  it("disables everything when the modal is closed", () => {
    expect(computeSessionModalGates(false)).toEqual({
      output: false,
      resourceTimeline: false,
    });
  });

  it("does NOT depend on `detail`: open modal enables pollers even before detail loads", () => {
    // new behavior: parallel with detail
    expect(computeSessionModalGates(true).output).toBe(true);
    expect(computeSessionModalGates(true).resourceTimeline).toBe(true);

    // old behavior would have kept them OFF until detail arrived (the waterfall):
    expect(oldGate(/* isOpen */ true, /* hasDetail */ false)).toBe(false);
  });
});
