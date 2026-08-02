import { describe, expect, it } from "bun:test";
import { createAgentOutputFinalizer } from "./agent-output-finalizer";

const terminalJob = {
  id: "10000000-0000-4000-8000-000000000001",
  workspaceId: "workspace-output",
  status: "completed" as const,
  errorType: null,
  errorMessage: null,
  config: {
    outputPolicy: {
      sinkId: "30000000-0000-4000-8000-000000000003",
      sinkVersion: 1,
      required: true,
      schemaHash: "a".repeat(64),
      schema: { type: "object" },
      maxPayloadBytes: 1024,
    },
  },
};

describe("agent output finalizer", () => {
  it("turns completed-without-required-submission into missing_structured_submission", async () => {
    const failures: unknown[] = [];
    const finalizer = createAgentOutputFinalizer({
      findContext: async () => ({
        job: terminalJob,
        run: {
          id: "20000000-0000-4000-8000-000000000002",
          agentJobId: terminalJob.id,
          workspaceId: terminalJob.workspaceId,
        },
        submission: null,
      }),
      createTerminalFailure: async (input) => {
        failures.push(input);
        return { created: true, submissionId: "submission-1" };
      },
    });

    const result = await finalizer.reconcile(terminalJob.id);

    expect(result).toEqual({ reconciled: true, code: "missing_structured_submission" });
    expect(failures).toEqual([
      expect.objectContaining({
        jobId: terminalJob.id,
        errorCode: "missing_structured_submission",
      }),
    ]);
  });

  it.each([
    [
      "failed",
      "agent_job_failed",
      "Agent job failed before structured output was submitted",
    ],
    [
      "incomplete",
      "agent_job_incomplete",
      "Agent job completed incompletely before structured output was submitted",
    ],
    [
      "cancelled",
      "agent_job_cancelled",
      "Agent job was cancelled before structured output was submitted",
    ],
  ] as const)(
    "persists a safe terminal envelope when a required-output job ends %s",
    async (status, errorCode, errorMessage) => {
      const failures: unknown[] = [];
      const job = {
        ...terminalJob,
        status,
        errorType: "provider_internal_secret_code",
        errorMessage: "Authorization: Bearer must-not-leave-Almirant",
      };
      const finalizer = createAgentOutputFinalizer({
        findContext: async () => ({
          job,
          run: {
            id: "20000000-0000-4000-8000-000000000002",
            agentJobId: job.id,
            workspaceId: job.workspaceId,
          },
          submission: null,
        }),
        createTerminalFailure: async (input) => {
          failures.push(input);
          return { created: true, submissionId: "submission-1" };
        },
      });

      expect(await finalizer.reconcile(job.id)).toEqual({
        reconciled: true,
        code: errorCode,
      });
      expect(failures).toEqual([
        expect.objectContaining({
          jobId: job.id,
          errorCode,
          errorMessage,
        }),
      ]);
      expect(JSON.stringify(failures)).not.toContain("must-not-leave-Almirant");
    },
  );

  it("is a no-op for optional policies, non-terminal jobs, or existing submissions", async () => {
    const variants = [
      {
        ...terminalJob,
        config: {
          outputPolicy: { ...terminalJob.config.outputPolicy, required: false },
        },
      },
      { ...terminalJob, status: "running" as const },
    ];

    for (const job of variants) {
      const finalizer = createAgentOutputFinalizer({
        findContext: async () => ({
          job,
          run: {
            id: "20000000-0000-4000-8000-000000000002",
            agentJobId: terminalJob.id,
            workspaceId: terminalJob.workspaceId,
          },
          submission: null,
        }),
        createTerminalFailure: async () => {
          throw new Error("must not persist");
        },
      });
      expect(await finalizer.reconcile(job.id)).toEqual({ reconciled: false });
    }

    const withSubmission = createAgentOutputFinalizer({
      findContext: async () => ({
        job: terminalJob,
        run: {
          id: "20000000-0000-4000-8000-000000000002",
          agentJobId: terminalJob.id,
          workspaceId: terminalJob.workspaceId,
        },
        submission: { id: "submission-existing" },
      }),
      createTerminalFailure: async () => {
        throw new Error("must not persist");
      },
    });
    expect(await withSubmission.reconcile(terminalJob.id)).toEqual({
      reconciled: false,
    });
  });
});
