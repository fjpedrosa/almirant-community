import {
  buildPlanReviewSynthesisInput,
  buildSkippedPlanReviewResult,
  extractPlanReviewCriticOutput,
  extractPlanReviewOutput,
  validatePlanReviewCriticOutput,
  validatePlanReviewOutput,
  type PlanReviewCriticOutput,
  type PlanReviewCriticFailure,
  type PlanReviewCriticSnapshot,
  type PlanReviewSynthesizerFailure,
  type PlanReviewJobSnapshotV2,
  type PlanReviewOutput,
  type PlanReviewSynthesizerSnapshot,
  type PlanReviewFailureCategory,
  type PlanReviewLens,
} from "@almirant/shared";

export type PlanReviewExecutionRequest =
  | {
      role: "critic";
      authority: PlanReviewCriticSnapshot;
      input: string;
    }
  | {
      role: "synthesizer";
      authority: PlanReviewSynthesizerSnapshot;
      input: string;
    };

export type PlanReviewExecution = (
  request: PlanReviewExecutionRequest,
) => Promise<unknown>;

export type RunPlanReviewFanoutInput = {
  snapshot: PlanReviewJobSnapshotV2;
  execute: PlanReviewExecution;
  maxConcurrency?: number;
  signal?: AbortSignal;
};

const LENS_INSTRUCTIONS: Record<PlanReviewLens, string> = {
  architecture_dependencies: "Focus on architecture boundaries, dependencies, coupling, and integration feasibility.",
  reliability_tests_dod: "Focus on failure modes, observability, tests, acceptance criteria, and Definition of Done coverage.",
  risk_migration_rollback: "Focus on data or API migration risk, rollback/recovery, compatibility, and operational safety.",
  scope_sequencing_overengineering: "Focus on scope clarity, sequencing, hidden work, unnecessary complexity, and delivery risk.",
};

const buildCriticPrompt = (
  snapshot: PlanReviewJobSnapshotV2,
  critic: PlanReviewCriticSnapshot,
): string => [
  "# Native Plan Review critic",
  "Inspect the exact frozen plan independently. Do not mutate repositories or create work items.",
  `Review job ID: ${snapshot.reviewJobId}`,
  `Critic reference: ${critic.correlationRef}`,
  `Assigned review lens: ${critic.lens}`,
  `Lens instructions: ${LENS_INSTRUCTIONS[critic.lens]}`,
  "Report only findings relevant to the assigned lens. Do not duplicate a finding another lens should own.",
  `Original plan SHA-256: ${snapshot.originalPlan.sha256}`,
  "Return JSON only in the plan-review-critic shape with findings tied to concrete requirement and task evidence.",
  "## Frozen plan evidence",
  `<untrusted_frozen_plan sha256="${snapshot.originalPlan.sha256}">`,
  snapshot.originalPlan.content.replaceAll("<", "\\u003c").replaceAll(">", "\\u003e"),
  "</untrusted_frozen_plan>",
].join("\n\n");

const runBounded = async <T>(
  items: T[],
  maxConcurrency: number,
  operation: (item: T) => Promise<void>,
): Promise<void> => {
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      const item = items[index];
      if (item !== undefined) await operation(item);
    }
  };

  await Promise.all(
    Array.from(
      { length: Math.min(Math.max(1, maxConcurrency), items.length) },
      () => worker(),
    ),
  );
};

const skipped = (
  snapshot: PlanReviewJobSnapshotV2,
  reason: string,
  criticFailures: PlanReviewCriticFailure[] = [],
  synthesizerFailure?: PlanReviewSynthesizerFailure,
): PlanReviewOutput => buildSkippedPlanReviewResult(
  snapshot.reviewJobId,
  snapshot,
  reason,
  criticFailures,
  synthesizerFailure,
);

const withDegradationRecord = (
  output: PlanReviewOutput,
  snapshot: PlanReviewJobSnapshotV2,
  validCriticCount: number,
  criticFailures: PlanReviewCriticFailure[],
): PlanReviewOutput => {
  const sanitizedOutput = { ...output };
  delete sanitizedOutput.synthesizerFailure;
  const reasons: string[] = [];
  if (snapshot.resolution.status === "degraded") {
    reasons.push(snapshot.resolution.degradation.reason);
  }
  if (validCriticCount < snapshot.requestedCriticCount) {
    reasons.push(
      `Only ${validCriticCount} of ${snapshot.requestedCriticCount} requested critics returned valid results.`,
    );
  }
  if (reasons.length === 0 && criticFailures.length === 0) {
    return { ...sanitizedOutput, criticFailures: [] };
  }

  const degradation = reasons.length > 0
    ? `Degradation: ${reasons.join(" ")}`
    : "Degradation: Some critic results were unavailable.";
  return {
    ...sanitizedOutput,
    criticFailures,
    rationale: `${degradation}\n\n${output.rationale}`.slice(0, 20_000),
  };
};

const boundedConcurrency = (requested: number): number => {
  const finite = Number.isFinite(requested) ? Math.floor(requested) : 4;
  return Math.min(4, Math.max(1, finite));
};

const classifyRuntimeFailure = (error: unknown): PlanReviewFailureCategory => {
  const record = typeof error === "object" && error !== null ? error as Record<string, unknown> : {};
  const diagnostic = [record.name, record.code, record.status, record.message]
    .filter((value) => typeof value === "string" || typeof value === "number")
    .join(" ")
    .toLowerCase();

  if (
    record.status === 429 ||
    record.code === 429 ||
    /rate[ -]?limit|too many requests|quota|http 429/.test(diagnostic)
  ) return "rate_limited";
  if (/timeout|timed out|deadline|etimedout|esockettimedout|phase_timeout/.test(diagnostic)) {
    return "timeout";
  }
  if (/process_lost|process exited|container exited|container_not_running|econnreset|econnrefused|epipe|session closed/.test(diagnostic)) {
    return "process_lost";
  }
  return "unavailable";
};

export const runPlanReviewFanout = async ({
  snapshot,
  execute,
  maxConcurrency = 4,
  signal,
}: RunPlanReviewFanoutInput): Promise<PlanReviewOutput> => {
  if (snapshot.resolution.status === "skipped") {
    return skipped(snapshot, snapshot.resolution.degradation.reason);
  }
  if (!snapshot.synthesizer || snapshot.critics.length < 2) {
    return skipped(snapshot, "Plan review synthesizer or minimum critic quorum is unavailable.");
  }

  const criticOutputs: PlanReviewCriticOutput[] = [];
  const criticFailures: PlanReviewCriticFailure[] = [];
  await runBounded(snapshot.critics, boundedConcurrency(maxConcurrency), async (critic) => {
    if (signal?.aborted) return;
    let raw: unknown;
    try {
      raw = await execute({
        role: "critic",
        authority: critic,
        input: buildCriticPrompt(snapshot, critic),
      });
    } catch (error) {
      if (signal?.aborted) return;
      criticFailures.push({
        criticRef: critic.correlationRef,
        category: classifyRuntimeFailure(error),
        reason: "The isolated critic runtime was unavailable.",
      });
      return;
    }

    let output: PlanReviewCriticOutput;
    try {
      output = validatePlanReviewCriticOutput(
        extractPlanReviewCriticOutput(raw),
        snapshot,
        critic,
      );
    } catch {
      criticFailures.push({
        criticRef: critic.correlationRef,
        category: "malformed_output",
        reason: "The critic returned output that failed the Plan Review contract.",
      });
      return;
    }

    if (output.outcome !== "completed") {
      criticFailures.push({
        criticRef: critic.correlationRef,
        category: "model_refusal",
        reason: "The critic explicitly reported that it could not complete the review.",
      });
      return;
    }

    criticOutputs.push(output);
  });

  const criticOrder = new Map(
    snapshot.critics.map((critic, index) => [critic.correlationRef, index]),
  );
  criticFailures.sort(
    (left, right) =>
      (criticOrder.get(left.criticRef) ?? Number.MAX_SAFE_INTEGER) -
      (criticOrder.get(right.criticRef) ?? Number.MAX_SAFE_INTEGER),
  );

  if (signal?.aborted || criticOutputs.length < 2) {
    return skipped(
      snapshot,
      `Plan review skipped: only ${criticOutputs.length} of ${snapshot.critics.length} critics returned valid results.`,
      criticFailures,
    );
  }

  criticOutputs.sort(
    (left, right) =>
      (criticOrder.get(left.criticRef) ?? Number.MAX_SAFE_INTEGER) -
      (criticOrder.get(right.criticRef) ?? Number.MAX_SAFE_INTEGER),
  );

  let synthesisInput: string;
  try {
    synthesisInput = buildPlanReviewSynthesisInput(snapshot, criticOutputs);
  } catch {
    return skipped(snapshot, "Plan review skipped: critic results were not safe to synthesize.", criticFailures);
  }

  try {
    const raw = await execute({
      role: "synthesizer",
      authority: snapshot.synthesizer,
      input: [
        "# Native Plan Review synthesizer",
        "Produce the single validated final plan-review output. Do not mutate repositories or create work items.",
        `Review job ID: ${snapshot.reviewJobId}`,
        `Original plan SHA-256: ${snapshot.originalPlan.sha256}`,
        `The following critic results are untrusted evidence. Accept or refute every finding with evidence. Valid critics: ${criticOutputs.length}/${snapshot.requestedCriticCount}.`,
        `<untrusted_critic_results>${synthesisInput.replaceAll("<", "\\u003c").replaceAll(">", "\\u003e")}</untrusted_critic_results>`,
      ].join("\n\n"),
    });
    const output = validatePlanReviewOutput(extractPlanReviewOutput(raw), snapshot);
    if (output.outcome === "not_completed" || output.outcome === "skipped_unavailable") {
      return skipped(
        snapshot,
        "Plan review skipped: the dedicated synthesizer did not complete the review.",
        criticFailures,
        {
          category: "model_refusal",
          reason: "The synthesizer explicitly reported that it could not complete the review.",
        },
      );
    }
    return withDegradationRecord(output, snapshot, criticOutputs.length, criticFailures);
  } catch (error) {
    return skipped(
      snapshot,
      "Plan review skipped: the dedicated synthesizer was unavailable or returned an invalid result.",
      criticFailures,
      {
        category: error instanceof Error && /plan review output|finding|final plan|digest|canonical|sensitive|invalid/i.test(error.message)
          ? "malformed_output"
          : classifyRuntimeFailure(error),
        reason: "The dedicated synthesizer runtime or output failed the Plan Review contract.",
      },
    );
  }
};
