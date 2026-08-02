import { describe, expect, it } from "bun:test";
import {
  AgentOutputCapabilityDeniedError,
  AgentOutputValidationError,
  createAgentOutputCapabilityService,
  hashCanonicalAgentOutput,
  type AgentOutputCapabilityRecord,
} from "./agent-output-capability";

const JOB_ID = "10000000-0000-4000-8000-000000000001";
const RUN_ID = "20000000-0000-4000-8000-000000000002";
const SINK_ID = "30000000-0000-4000-8000-000000000003";

const record = (): AgentOutputCapabilityRecord => ({
  job: {
    id: JOB_ID,
    workspaceId: "workspace-output",
    status: "running",
    config: {
      scheduledConfigId: "40000000-0000-4000-8000-000000000004",
      outputPolicy: {
        sinkId: SINK_ID,
        sinkVersion: 3,
        required: true,
        schemaHash: "ee52628cf2b7d10e8d9cd8b9a96eb2468b541a9eabb05aef91693a3ed4abba64",
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["answer"],
          properties: { answer: { type: "string", minLength: 1 } },
        },
        maxPayloadBytes: 128,
      },
    },
  },
  run: {
    id: RUN_ID,
    agentJobId: JOB_ID,
    workspaceId: "workspace-output",
  },
  sink: {
    id: SINK_ID,
    workspaceId: "workspace-output",
    version: 3,
    enabled: true,
  },
  submission: null,
});

const actor = {
  jobId: JOB_ID,
  workspaceId: "workspace-output",
  permissions: ["mcp:write"],
  sessionType: "agent",
};

describe("agent output capability", () => {
  it("derives scope from authenticated actor and rejects cross-job/cross-workspace use", async () => {
    const service = createAgentOutputCapabilityService({
      findByJobId: async () => record(),
      submit: async () => ({ submissionId: "submission-1", replay: false }),
    });

    await expect(
      service.submit({ ...actor, jobId: "forged-job" }, { answer: "ok" }),
    ).rejects.toBeInstanceOf(AgentOutputCapabilityDeniedError);
    await expect(
      service.submit({ ...actor, workspaceId: "forged-workspace" }, { answer: "ok" }),
    ).rejects.toBeInstanceOf(AgentOutputCapabilityDeniedError);
    await expect(
      service.submit({ ...actor, permissions: [] }, { answer: "ok" }),
    ).rejects.toBeInstanceOf(AgentOutputCapabilityDeniedError);
  });

  it("validates the snapshotted schema and exact UTF-8 byte limit before persistence", async () => {
    let calls = 0;
    const service = createAgentOutputCapabilityService({
      findByJobId: async () => record(),
      submit: async () => {
        calls += 1;
        return { submissionId: "submission-1", replay: false };
      },
    });

    await expect(service.submit(actor, { answer: "" })).rejects.toBeInstanceOf(
      AgentOutputValidationError,
    );
    await expect(
      service.submit(actor, { answer: "x".repeat(200) }),
    ).rejects.toBeInstanceOf(AgentOutputValidationError);
    expect(calls).toBe(0);
  });

  it("accepts a JSON-serialized object, since agents routinely stringify it", async () => {
    const persisted: string[] = [];
    const service = createAgentOutputCapabilityService({
      findByJobId: async () => record(),
      submit: async ({ canonicalPayload }) => {
        persisted.push(canonicalPayload);
        return { submissionId: "s", replay: false };
      },
    });

    const result = await service.submit(actor, JSON.stringify({ answer: "ok" }));

    expect(result.status).toBe("submitted");
    // Persisted as the parsed object, so the canonical hash and everything
    // downstream match a caller that sent the object directly.
    expect(persisted).toEqual(['{"answer":"ok"}']);
  });

  it("does not reinterpret a string the schema legitimately accepts", async () => {
    const stringRecord = (): AgentOutputCapabilityRecord => {
      const base = record();
      const policy = base.job.config.outputPolicy;
      if (!policy) throw new Error("expected an output policy");
      policy.schema = { type: "string" };
      policy.schemaHash = hashCanonicalAgentOutput(policy.schema);
      return base;
    };
    const persisted: string[] = [];
    const service = createAgentOutputCapabilityService({
      findByJobId: async () => stringRecord(),
      submit: async ({ canonicalPayload }) => {
        persisted.push(canonicalPayload);
        return { submissionId: "s", replay: false };
      },
    });

    // Valid as-is against a string schema: it must NOT be parsed into 123.
    await service.submit(actor, "123");
    expect(persisted).toEqual(['"123"']);
  });

  it("reports which fields violated the schema, without echoing their values", async () => {
    const service = createAgentOutputCapabilityService({
      findByJobId: async () => record(),
      submit: async () => ({ submissionId: "s", replay: false }),
    });

    // Wrong type for `answer`; the offending value must not travel back.
    // (Ajv runs with allErrors:false, so a stray extra property would mask this
    // by reporting additionalProperties first.)
    const error: unknown = await service
      .submit(actor, { answer: ["must-not-appear"] })
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(AgentOutputValidationError);
    const details = (error as AgentOutputValidationError).details ?? [];
    // Enough for the agent to fix its payload: the path and the broken rule.
    expect(details.join(" ")).toContain("/answer");
    expect(details.join(" ")).toContain("type");
    // Never the offending value, and never an unbounded dump.
    expect(details.join(" ")).not.toContain("must-not-appear");
    expect(details.length).toBeLessThanOrEqual(5);
    for (const detail of details) expect(detail.length).toBeLessThanOrEqual(200);
  });

  it("submits a canonical hash and surfaces identical replay without accepting changed output", async () => {
    const captured: Array<{ payloadHash: string; canonicalPayload: string }> = [];
    const service = createAgentOutputCapabilityService({
      findByJobId: async () => record(),
      submit: async (input) => {
        captured.push({
          payloadHash: input.payloadHash,
          canonicalPayload: input.canonicalPayload,
        });
        return {
          submissionId: "submission-1",
          replay: captured.length > 1,
        };
      },
    });

    const first = await service.submit(actor, { answer: "ok" });
    const replay = await service.submit(actor, { answer: "ok" });

    expect(first).toEqual({ submissionId: "submission-1", status: "submitted", replay: false });
    expect(replay).toEqual({ submissionId: "submission-1", status: "submitted", replay: true });
    expect(captured[0]?.payloadHash).toMatch(/^[a-f0-9]{64}$/);
    expect(captured[0]).toEqual(captured[1]);
  });

  it("fails closed when the job snapshot, run and persisted sink are not exactly bound", async () => {
    const mismatches: AgentOutputCapabilityRecord[] = [
      { ...record(), run: { ...record().run, agentJobId: "another-job" } },
      { ...record(), sink: { ...record().sink, version: 4 } },
      { ...record(), sink: { ...record().sink, enabled: false } },
      {
        ...record(),
        job: {
          ...record().job,
          config: { ...record().job.config, outputPolicy: undefined },
        },
      },
    ];

    for (const mismatch of mismatches) {
      const service = createAgentOutputCapabilityService({
        findByJobId: async () => mismatch,
        submit: async () => ({ submissionId: "submission-1", replay: false }),
      });
      await expect(service.submit(actor, { answer: "ok" })).rejects.toBeInstanceOf(
        AgentOutputCapabilityDeniedError,
      );
    }
  });
});
