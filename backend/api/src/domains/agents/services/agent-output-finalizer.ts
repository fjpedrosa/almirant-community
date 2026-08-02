import type { AgentOutputPolicySnapshot } from "@almirant/database";

export interface AgentOutputFinalizerJob {
  id: string;
  workspaceId: string | null;
  status: string;
  errorType: string | null;
  errorMessage: string | null;
  config: { outputPolicy?: AgentOutputPolicySnapshot };
}

export interface AgentOutputFinalizerContext {
  job: AgentOutputFinalizerJob;
  run: {
    id: string;
    agentJobId: string | null;
    workspaceId: string;
  };
  submission: { id: string } | null;
}

interface AgentOutputFinalizerDependencies {
  findContext(
    jobId: string,
  ): Promise<AgentOutputFinalizerContext | null>;
  createTerminalFailure(input: {
    runId: string;
    jobId: string;
    sinkId: string;
    errorCode: string;
    errorMessage: string;
    submittedAt: Date;
  }): Promise<{ created: boolean; submissionId: string }>;
  now?: () => Date;
}

const TERMINAL_FAILURES = {
  completed: {
    code: "missing_structured_submission",
    message: "Required structured output was not submitted",
  },
  failed: {
    code: "agent_job_failed",
    message: "Agent job failed before structured output was submitted",
  },
  incomplete: {
    code: "agent_job_incomplete",
    message:
      "Agent job completed incompletely before structured output was submitted",
  },
  cancelled: {
    code: "agent_job_cancelled",
    message: "Agent job was cancelled before structured output was submitted",
  },
} as const;

type TerminalFailure =
  (typeof TERMINAL_FAILURES)[keyof typeof TERMINAL_FAILURES];

const terminalFailureFor = (status: string): TerminalFailure | null =>
  Object.hasOwn(TERMINAL_FAILURES, status)
    ? TERMINAL_FAILURES[status as keyof typeof TERMINAL_FAILURES]
    : null;

/**
 * Crash-safe terminal reconciliation.
 *
 * Every terminal required-output job receives exactly one downstream envelope.
 * A completed job without a submission becomes `missing_structured_submission`;
 * failed, incomplete and cancelled jobs use stable generic errors so internal
 * provider messages cannot cross the output boundary. The envelope shares the
 * normal one-submission constraint, making concurrent reconciliation idempotent.
 */
export const createAgentOutputFinalizer = (
  dependencies: AgentOutputFinalizerDependencies,
) => ({
  reconcile: async (
    jobId: string,
  ): Promise<
    | { reconciled: false }
    | { reconciled: true; code: TerminalFailure["code"] }
  > => {
    const context = await dependencies.findContext(jobId);
    if (!context) return { reconciled: false };
    const policy = context.job.config.outputPolicy;
    const terminalFailure = terminalFailureFor(context.job.status);
    if (
      !terminalFailure ||
      !policy?.required ||
      context.submission ||
      context.run.agentJobId !== context.job.id ||
      !context.job.workspaceId ||
      context.run.workspaceId !== context.job.workspaceId
    ) {
      return { reconciled: false };
    }

    await dependencies.createTerminalFailure({
      runId: context.run.id,
      jobId: context.job.id,
      sinkId: policy.sinkId,
      errorCode: terminalFailure.code,
      errorMessage: terminalFailure.message,
      submittedAt: dependencies.now?.() ?? new Date(),
    });
    return {
      reconciled: true,
      code: terminalFailure.code,
    };
  },
});

export type AgentOutputFinalizer = ReturnType<
  typeof createAgentOutputFinalizer
>;
