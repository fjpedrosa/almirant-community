/**
 * Gate for the session-detail modal's SECONDARY queries (output/session-events and
 * resource-timeline).
 *
 * The jobId is known from the URL, so these must fire in PARALLEL with the `detail`
 * query — they used to be gated on `isOpen && !!detail`, which serialized them one
 * extra network round-trip BEHIND `detail` (a waterfall). The gate now depends ONLY
 * on whether the modal is open.
 *
 * Any gate that genuinely needs data unavailable until `detail` loads (e.g. live-poll
 * cadence, which keys off `detail.job.status`) stays in the hook — this covers only
 * the enable/fire decision.
 */
export interface SessionModalGates {
  /** enable the output (transcript + session-events) queries */
  output: boolean;
  /** enable the resource-timeline query */
  resourceTimeline: boolean;
}

export const computeSessionModalGates = (isOpen: boolean): SessionModalGates => ({
  output: isOpen,
  resourceTimeline: isOpen,
});
