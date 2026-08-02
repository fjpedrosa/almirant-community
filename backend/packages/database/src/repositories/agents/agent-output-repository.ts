import { randomUUID } from "node:crypto";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lte,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import { db, type Database } from "../../client";
import {
  agentJobs,
  agentOutputBindings,
  agentOutputDeliveries,
  agentOutputSinks,
  agentOutputSubmissions,
  scheduledAgentOutputSinks,
  scheduledAgentConfigs,
  scheduledAgentRuns,
  type AgentJobConfig,
  type AgentOutputDeliveryDb,
  type AgentOutputPolicySnapshot,
  type AgentOutputSinkDb,
  type AgentOutputSubmissionDb,
} from "../../schema";

const stableDeliveryKey = (submissionId: string): string =>
  `agent-output:${submissionId}`;

export interface AgentOutputPolicyRecord {
  required: boolean;
  sink: AgentOutputSinkDb;
}

export interface PutAgentOutputBindingInput {
  runId: string;
  sinkId: string;
  encryptedBinding: string;
  bindingIv: string;
  bindingAuthTag: string;
  bindingHash: string;
  keyVersion: number;
}

export interface SubmitAgentOutputInput {
  runId: string;
  jobId: string;
  sinkId: string;
  payload: unknown;
  payloadHash: string;
  submittedAt: Date;
}

export interface CreateAgentOutputTerminalFailureInput {
  runId: string;
  jobId: string;
  sinkId: string;
  errorCode: string;
  errorMessage: string;
  submittedAt: Date;
}

export interface AgentOutputCapabilityDatabaseRecord {
  job: {
    id: string;
    workspaceId: string | null;
    status: string;
    config: AgentJobConfig;
  };
  run: {
    id: string;
    agentJobId: string | null;
    workspaceId: string;
  };
  sink: Pick<AgentOutputSinkDb, "id" | "workspaceId" | "version" | "enabled">;
  submission: AgentOutputSubmissionDb | null;
}

export interface ClaimedAgentOutputDelivery extends AgentOutputDeliveryDb {
  jobId: string;
  runId: string;
  endpointOrigin: string;
  pathTemplate: string;
  headerTemplates: Record<string, string>;
  encryptedHeaders: string | null;
  headersIv: string | null;
  headersAuthTag: string | null;
  encryptedBinding: string | null;
  bindingIv: string | null;
  bindingAuthTag: string | null;
  payload: unknown | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export const createAgentOutputRepository = (database: Database) => {
  const pinSink = async (input: {
    configId: string;
    workspaceId: string;
    sinkId: string;
    required: boolean;
  }) =>
    database.transaction(async (transaction) => {
      const [[config], [sink]] = await Promise.all([
        transaction
          .select({ id: scheduledAgentConfigs.id })
          .from(scheduledAgentConfigs)
          .where(
            and(
              eq(scheduledAgentConfigs.id, input.configId),
              eq(scheduledAgentConfigs.workspaceId, input.workspaceId),
            ),
          )
          .limit(1),
        transaction
          .select({
            id: agentOutputSinks.id,
            version: agentOutputSinks.version,
          })
          .from(agentOutputSinks)
          .where(
            and(
              eq(agentOutputSinks.id, input.sinkId),
              eq(agentOutputSinks.workspaceId, input.workspaceId),
              eq(agentOutputSinks.enabled, true),
            ),
          )
          .limit(1),
      ]);
      if (!config) {
        throw new Error("Scheduled agent config is not available");
      }
      if (!sink) {
        throw new Error("Agent output sink is not available");
      }
      const [pinned] = await transaction
        .insert(scheduledAgentOutputSinks)
        .values({
          configId: config.id,
          sinkId: sink.id,
          sinkVersion: sink.version,
          required: input.required,
        })
        .onConflictDoUpdate({
          target: scheduledAgentOutputSinks.configId,
          set: {
            sinkId: sink.id,
            sinkVersion: sink.version,
            required: input.required,
            updatedAt: new Date(),
          },
        })
        .returning();
      if (!pinned) throw new Error("Failed to pin agent output sink");
      return pinned;
    });

  const unpinSink = async (
    configId: string,
    workspaceId: string,
  ): Promise<boolean> => {
    const [deleted] = await database
      .delete(scheduledAgentOutputSinks)
      .where(
        and(
          eq(scheduledAgentOutputSinks.configId, configId),
          sql`EXISTS (
            SELECT 1
            FROM ${scheduledAgentConfigs}
            WHERE ${scheduledAgentConfigs.id} = ${configId}
              AND ${scheduledAgentConfigs.workspaceId} = ${workspaceId}
          )`,
        ),
      )
      .returning({ configId: scheduledAgentOutputSinks.configId });
    return Boolean(deleted);
  };

  const findPolicyByConfigId = async (
    configId: string,
    workspaceId: string,
  ): Promise<AgentOutputPolicyRecord | null> => {
    const [record] = await database
      .select({
        required: scheduledAgentOutputSinks.required,
        sink: agentOutputSinks,
      })
      .from(scheduledAgentOutputSinks)
      .innerJoin(
        agentOutputSinks,
        and(
          eq(scheduledAgentOutputSinks.sinkId, agentOutputSinks.id),
          eq(scheduledAgentOutputSinks.sinkVersion, agentOutputSinks.version),
        ),
      )
      .where(
        and(
          eq(scheduledAgentOutputSinks.configId, configId),
          eq(agentOutputSinks.workspaceId, workspaceId),
          eq(agentOutputSinks.enabled, true),
        ),
      )
      .limit(1);
    return record ?? null;
  };

  const putBinding = async (
    input: PutAgentOutputBindingInput,
  ): Promise<{ created: boolean; replay?: true; bindingId: string }> => {
    const [created] = await database
      .insert(agentOutputBindings)
      .values(input)
      .onConflictDoNothing({ target: agentOutputBindings.runId })
      .returning({ id: agentOutputBindings.id });
    if (created) return { created: true, bindingId: created.id };

    const [existing] = await database
      .select({
        id: agentOutputBindings.id,
        sinkId: agentOutputBindings.sinkId,
        bindingHash: agentOutputBindings.bindingHash,
        keyVersion: agentOutputBindings.keyVersion,
      })
      .from(agentOutputBindings)
      .where(eq(agentOutputBindings.runId, input.runId))
      .limit(1);
    if (
      existing &&
      existing.sinkId === input.sinkId &&
      existing.bindingHash === input.bindingHash &&
      existing.keyVersion === input.keyVersion
    ) {
      return { created: false, replay: true, bindingId: existing.id };
    }
    throw new Error("Agent output binding conflict");
  };

  const getSubmissionAndDelivery = async (
    executor: Pick<Database, "select">,
    jobId: string,
  ): Promise<{
    submission: AgentOutputSubmissionDb;
    delivery: AgentOutputDeliveryDb;
  } | null> => {
    const [existing] = await executor
      .select({
        submission: agentOutputSubmissions,
        delivery: agentOutputDeliveries,
      })
      .from(agentOutputSubmissions)
      .innerJoin(
        agentOutputDeliveries,
        eq(agentOutputDeliveries.submissionId, agentOutputSubmissions.id),
      )
      .where(eq(agentOutputSubmissions.jobId, jobId))
      .limit(1);
    return existing ?? null;
  };

  const submit = async (
    input: SubmitAgentOutputInput,
  ): Promise<{
    submissionId: string;
    deliveryId: string;
    replay: boolean;
  }> =>
    database.transaction(async (transaction) => {
      const [created] = await transaction
        .insert(agentOutputSubmissions)
        .values({
          runId: input.runId,
          jobId: input.jobId,
          sinkId: input.sinkId,
          status: "submitted",
          payload: input.payload,
          payloadHash: input.payloadHash,
          submittedAt: input.submittedAt,
        })
        .onConflictDoNothing({ target: agentOutputSubmissions.jobId })
        .returning();

      if (created) {
        const [delivery] = await transaction
          .insert(agentOutputDeliveries)
          .values({
            submissionId: created.id,
            idempotencyKey: stableDeliveryKey(created.id),
            availableAt: input.submittedAt,
          })
          .returning();
        if (!delivery) {
          throw new Error("Failed to create agent output delivery");
        }
        return {
          submissionId: created.id,
          deliveryId: delivery.id,
          replay: false,
        };
      }

      const existing = await getSubmissionAndDelivery(
        transaction as unknown as Pick<Database, "select">,
        input.jobId,
      );
      if (
        existing?.submission.status === "submitted" &&
        existing.submission.runId === input.runId &&
        existing.submission.sinkId === input.sinkId &&
        existing.submission.payloadHash === input.payloadHash
      ) {
        return {
          submissionId: existing.submission.id,
          deliveryId: existing.delivery.id,
          replay: true,
        };
      }
      throw new Error("Agent output submission conflict");
    });

  const createTerminalFailure = async (
    input: CreateAgentOutputTerminalFailureInput,
  ): Promise<{ created: boolean; submissionId: string }> =>
    database.transaction(async (transaction) => {
      const [created] = await transaction
        .insert(agentOutputSubmissions)
        .values({
          runId: input.runId,
          jobId: input.jobId,
          sinkId: input.sinkId,
          status: "terminal_error",
          errorCode: input.errorCode,
          errorMessage: input.errorMessage,
          submittedAt: input.submittedAt,
        })
        .onConflictDoNothing({ target: agentOutputSubmissions.jobId })
        .returning({ id: agentOutputSubmissions.id });
      if (created) {
        await transaction.insert(agentOutputDeliveries).values({
          submissionId: created.id,
          idempotencyKey: stableDeliveryKey(created.id),
          availableAt: input.submittedAt,
        });
        return { created: true, submissionId: created.id };
      }

      const [existing] = await transaction
        .select()
        .from(agentOutputSubmissions)
        .where(eq(agentOutputSubmissions.jobId, input.jobId))
        .limit(1);
      if (
        existing?.runId === input.runId &&
        existing.sinkId === input.sinkId &&
        existing.status === "terminal_error" &&
        existing.errorCode === input.errorCode
      ) {
        return { created: false, submissionId: existing.id };
      }
      throw new Error("Agent output terminal submission conflict");
    });

  const findCapabilityByJobId = async (
    jobId: string,
  ): Promise<AgentOutputCapabilityDatabaseRecord | null> => {
    const [record] = await database
      .select({
        job: {
          id: agentJobs.id,
          workspaceId: agentJobs.workspaceId,
          status: agentJobs.status,
          config: agentJobs.config,
        },
        run: {
          id: scheduledAgentRuns.id,
          agentJobId: scheduledAgentRuns.agentJobId,
          workspaceId: scheduledAgentRuns.workspaceId,
        },
        sink: {
          id: agentOutputSinks.id,
          workspaceId: agentOutputSinks.workspaceId,
          version: agentOutputSinks.version,
          enabled: agentOutputSinks.enabled,
        },
        submission: agentOutputSubmissions,
      })
      .from(agentJobs)
      .innerJoin(
        scheduledAgentRuns,
        eq(scheduledAgentRuns.agentJobId, agentJobs.id),
      )
      .innerJoin(
        agentOutputSinks,
        and(
          sql`${agentOutputSinks.id}::text = ${agentJobs.config}->'outputPolicy'->>'sinkId'`,
          sql`${agentOutputSinks.version} = ((${agentJobs.config}->'outputPolicy'->>'sinkVersion')::integer)`,
        ),
      )
      .leftJoin(
        agentOutputSubmissions,
        eq(agentOutputSubmissions.jobId, agentJobs.id),
      )
      .where(eq(agentJobs.id, jobId))
      .limit(1);
    return record ?? null;
  };

  const claimDeliveries = async (options: {
    leaseOwner?: string;
    leaseMs?: number;
    limit?: number;
    now?: Date;
  }): Promise<ClaimedAgentOutputDelivery[]> => {
    const now = options.now ?? new Date();
    const leaseOwner = options.leaseOwner ?? randomUUID();
    const leaseMs = Math.min(
      Math.max(options.leaseMs ?? 60_000, 10_000),
      10 * 60_000,
    );
    const limit = Math.min(Math.max(options.limit ?? 25, 1), 100);
    const leaseExpiresAt = new Date(now.getTime() + leaseMs);

    return database.transaction(async (transaction) => {
      const candidates = await transaction
        .select({ id: agentOutputDeliveries.id })
        .from(agentOutputDeliveries)
        .where(
          or(
            and(
              inArray(agentOutputDeliveries.status, ["pending", "retry_wait"]),
              lte(agentOutputDeliveries.availableAt, now),
            ),
            and(
              eq(agentOutputDeliveries.status, "delivering"),
              lte(agentOutputDeliveries.leaseExpiresAt, now),
            ),
          ),
        )
        .orderBy(
          asc(agentOutputDeliveries.availableAt),
          asc(agentOutputDeliveries.createdAt),
        )
        .limit(limit)
        .for("update", { skipLocked: true });
      if (candidates.length === 0) return [];
      const ids = candidates.map(({ id }) => id);
      await transaction
        .update(agentOutputDeliveries)
        .set({
          status: "delivering",
          stateVersion: sql`${agentOutputDeliveries.stateVersion} + 1`,
          attempts: sql`${agentOutputDeliveries.attempts} + 1`,
          leaseOwner,
          leaseExpiresAt,
          lastErrorCode: null,
          updatedAt: now,
        })
        .where(inArray(agentOutputDeliveries.id, ids));

      return transaction
        .select({
          id: agentOutputDeliveries.id,
          submissionId: agentOutputDeliveries.submissionId,
          status: agentOutputDeliveries.status,
          stateVersion: agentOutputDeliveries.stateVersion,
          attempts: agentOutputDeliveries.attempts,
          availableAt: agentOutputDeliveries.availableAt,
          leaseOwner: agentOutputDeliveries.leaseOwner,
          leaseExpiresAt: agentOutputDeliveries.leaseExpiresAt,
          idempotencyKey: agentOutputDeliveries.idempotencyKey,
          responseStatus: agentOutputDeliveries.responseStatus,
          lastErrorCode: agentOutputDeliveries.lastErrorCode,
          deliveredAt: agentOutputDeliveries.deliveredAt,
          deadLetteredAt: agentOutputDeliveries.deadLetteredAt,
          createdAt: agentOutputDeliveries.createdAt,
          updatedAt: agentOutputDeliveries.updatedAt,
          jobId: agentOutputSubmissions.jobId,
          runId: agentOutputSubmissions.runId,
          endpointOrigin: agentOutputSinks.endpointOrigin,
          pathTemplate: agentOutputSinks.pathTemplate,
          headerTemplates: agentOutputSinks.headerTemplates,
          encryptedHeaders: agentOutputSinks.encryptedHeaders,
          headersIv: agentOutputSinks.headersIv,
          headersAuthTag: agentOutputSinks.headersAuthTag,
          encryptedBinding: agentOutputBindings.encryptedBinding,
          bindingIv: agentOutputBindings.bindingIv,
          bindingAuthTag: agentOutputBindings.bindingAuthTag,
          payload: agentOutputSubmissions.payload,
          errorCode: agentOutputSubmissions.errorCode,
          errorMessage: agentOutputSubmissions.errorMessage,
        })
        .from(agentOutputDeliveries)
        .innerJoin(
          agentOutputSubmissions,
          eq(agentOutputSubmissions.id, agentOutputDeliveries.submissionId),
        )
        .innerJoin(
          agentOutputSinks,
          eq(agentOutputSinks.id, agentOutputSubmissions.sinkId),
        )
        .leftJoin(
          agentOutputBindings,
          eq(agentOutputBindings.runId, agentOutputSubmissions.runId),
        )
        .where(
          and(
            inArray(agentOutputDeliveries.id, ids),
            eq(agentOutputDeliveries.leaseOwner, leaseOwner),
          ),
        );
    });
  };

  const completeDelivery = async (input: {
    deliveryId: string;
    expectedStateVersion: number;
    leaseOwner: string;
    responseStatus: number;
    now?: Date;
  }): Promise<boolean> => {
    const now = input.now ?? new Date();
    const [completed] = await database
      .update(agentOutputDeliveries)
      .set({
        status: "delivered",
        stateVersion: sql`${agentOutputDeliveries.stateVersion} + 1`,
        responseStatus: input.responseStatus,
        deliveredAt: now,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastErrorCode: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(agentOutputDeliveries.id, input.deliveryId),
          eq(agentOutputDeliveries.status, "delivering"),
          eq(agentOutputDeliveries.stateVersion, input.expectedStateVersion),
          eq(agentOutputDeliveries.leaseOwner, input.leaseOwner),
          gt(agentOutputDeliveries.leaseExpiresAt, now),
        ),
      )
      .returning({ id: agentOutputDeliveries.id });
    return Boolean(completed);
  };

  const failDelivery = async (input: {
    deliveryId: string;
    expectedStateVersion: number;
    leaseOwner: string;
    disposition: "retry" | "dead_letter";
    errorCode: string;
    retryAt?: Date;
    responseStatus?: number;
    now?: Date;
  }): Promise<boolean> => {
    const now = input.now ?? new Date();
    if (input.disposition === "retry" && !input.retryAt) {
      throw new Error("Agent output retryAt is required");
    }
    const [failed] = await database
      .update(agentOutputDeliveries)
      .set({
        status:
          input.disposition === "retry" ? "retry_wait" : "dead_letter",
        stateVersion: sql`${agentOutputDeliveries.stateVersion} + 1`,
        availableAt: input.retryAt ?? now,
        responseStatus: input.responseStatus ?? null,
        lastErrorCode: input.errorCode,
        deadLetteredAt:
          input.disposition === "dead_letter" ? now : null,
        leaseOwner: null,
        leaseExpiresAt: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(agentOutputDeliveries.id, input.deliveryId),
          eq(agentOutputDeliveries.status, "delivering"),
          eq(agentOutputDeliveries.stateVersion, input.expectedStateVersion),
          eq(agentOutputDeliveries.leaseOwner, input.leaseOwner),
          gt(agentOutputDeliveries.leaseExpiresAt, now),
        ),
      )
      .returning({ id: agentOutputDeliveries.id });
    return Boolean(failed);
  };

  return {
    pinSink,
    unpinSink,
    findPolicyByConfigId,
    putBinding,
    submit,
    createTerminalFailure,
    findCapabilityByJobId,
    claimDeliveries,
    completeDelivery,
    failDelivery,
  };
};

const repository = createAgentOutputRepository(db);

export const findScheduledAgentOutputPolicy =
  repository.findPolicyByConfigId;
export const pinScheduledAgentOutputSink = repository.pinSink;
export const unpinScheduledAgentOutputSink = repository.unpinSink;
export const putAgentOutputBinding = repository.putBinding;
export const submitAgentOutput = repository.submit;
export const createAgentOutputTerminalFailure =
  repository.createTerminalFailure;
export const findAgentOutputCapabilityByJobId =
  repository.findCapabilityByJobId;
export const claimAgentOutputDeliveries = repository.claimDeliveries;
export const completeAgentOutputDelivery = repository.completeDelivery;
export const failAgentOutputDelivery = repository.failDelivery;

export interface AgentOutputSubmissionSummary {
  status: string;
  payload: unknown;
  payloadHash: string | null;
  errorCode: string | null;
  submittedAt: Date;
}

/**
 * The validated output of a job, for display.
 *
 * Read-only and payload-only on purpose: the delivery record carries the sink
 * and its response, which is operational detail nobody reading a transcript
 * needs. The payload is whatever the job's sink schema accepted, so callers must
 * treat its shape as data to be inspected, never as a type to be trusted.
 */
export const findAgentOutputSubmissionByJobId = async (
  jobId: string,
): Promise<AgentOutputSubmissionSummary | null> => {
  const [row] = await db
    .select({
      status: agentOutputSubmissions.status,
      payload: agentOutputSubmissions.payload,
      payloadHash: agentOutputSubmissions.payloadHash,
      errorCode: agentOutputSubmissions.errorCode,
      submittedAt: agentOutputSubmissions.submittedAt,
    })
    .from(agentOutputSubmissions)
    .where(eq(agentOutputSubmissions.jobId, jobId))
    .orderBy(desc(agentOutputSubmissions.submittedAt))
    .limit(1);
  return row ?? null;
};

/**
 * Whether this job already produced output the server itself validated.
 *
 * The table's check constraint makes `submitted` mean payload and payload hash
 * are both present, so a true here is not "the agent claimed something": it is a
 * schema-valid result this service accepted and persisted. Recovery sweeps use it
 * to avoid destroying finished work over a status report that never arrived.
 */
export const hasValidatedAgentOutputSubmission = async (
  jobId: string,
): Promise<boolean> => {
  const [row] = await db
    .select({ id: agentOutputSubmissions.id })
    .from(agentOutputSubmissions)
    .where(
      and(
        eq(agentOutputSubmissions.jobId, jobId),
        eq(agentOutputSubmissions.status, "submitted"),
      ),
    )
    .limit(1);
  return row !== undefined;
};

export interface UnreconciledTerminalAgentOutputJob {
  id: string;
  workspaceId: string | null;
  status: "completed" | "incomplete" | "failed" | "cancelled";
  errorType: string | null;
  errorMessage: string | null;
  config: AgentJobConfig;
}

export const findUnreconciledTerminalAgentOutputJobs = async (options?: {
  limit?: number;
}): Promise<UnreconciledTerminalAgentOutputJob[]> => {
  const limit = Math.min(Math.max(options?.limit ?? 25, 1), 100);
  return db
    .select({
      id: agentJobs.id,
      workspaceId: agentJobs.workspaceId,
      status: agentJobs.status,
      errorType: agentJobs.errorType,
      errorMessage: agentJobs.errorMessage,
      config: agentJobs.config,
    })
    .from(agentJobs)
    .where(
      and(
        inArray(agentJobs.status, [
          "completed",
          "incomplete",
          "failed",
          "cancelled",
        ]),
        sql`${agentJobs.config}->'outputPolicy'->>'required' = 'true'`,
        notExists(
          db
            .select({ id: agentOutputSubmissions.id })
            .from(agentOutputSubmissions)
            .where(eq(agentOutputSubmissions.jobId, agentJobs.id)),
        ),
      ),
    )
    .orderBy(asc(agentJobs.completedAt))
    .limit(limit) as Promise<UnreconciledTerminalAgentOutputJob[]>;
};

export const buildAgentOutputPolicySnapshot = (
  policy: AgentOutputPolicyRecord,
): AgentOutputPolicySnapshot => ({
  sinkId: policy.sink.id,
  sinkVersion: policy.sink.version,
  required: policy.required,
  schemaHash: policy.sink.schemaHash,
  schema: policy.sink.payloadSchema,
  maxPayloadBytes: policy.sink.maxPayloadBytes,
});
