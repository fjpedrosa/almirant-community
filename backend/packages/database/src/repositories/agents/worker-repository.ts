import { db } from "../../client";
import { agentJobs, workerRegistrations, workItems } from "../../schema";
import { and, desc, eq, isNull, lt, or, sql, inArray } from "drizzle-orm";
import { insertLifecycleEvent } from "./worker-lifecycle-repository";

export type WorkerStatus = "online" | "offline";

const WORKER_BOUND_ACTIVE_JOB_STATUSES = [
  "queued",
  "running",
  "finalizing",
  "waiting_for_input",
  "paused",
] as const;

export type UpsertWorkerInput = {
  workerId: string;
  hostname: string;
  currentIp?: string | null;
  config: Record<string, unknown>;
  activeJobs?: number;
  maxConcurrentAgents?: number;
  isDraining?: boolean;
  availableSlots?: number;
  ramBudgetMb?: number | null;
  ramCommittedMb?: number | null;
  ramAvailableMb?: number | null;
  systemMetrics?: Record<string, unknown>;
};

export const upsertWorker = async (
  input: UpsertWorkerInput
): Promise<typeof workerRegistrations.$inferSelect> => {
  // Fetch existing worker to detect transitions
  const [existing] = await db
    .select()
    .from(workerRegistrations)
    .where(eq(workerRegistrations.hostname, input.hostname))
    .limit(1);

  const now = new Date();
  const [row] = await db
    .insert(workerRegistrations)
    .values({
      workerId: input.workerId,
      hostname: input.hostname,
      currentIp: input.currentIp ?? null,
      status: "online",
      config: input.config as never,
      activeJobs: input.activeJobs ?? 0,
      maxConcurrentAgents: input.maxConcurrentAgents ?? 2,
      isDraining: input.isDraining ?? false,
      availableSlots: input.availableSlots ?? 0,
      ramBudgetMb: input.ramBudgetMb ?? null,
      ramCommittedMb: input.ramCommittedMb ?? null,
      ramAvailableMb: input.ramAvailableMb ?? null,
      systemMetrics: input.systemMetrics ?? null,
      lastHeartbeatAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: workerRegistrations.hostname,
      set: {
        workerId: input.workerId,
        currentIp: input.currentIp ?? null,
        status: "online",
        config: input.config as never,
        activeJobs: input.activeJobs ?? 0,
        maxConcurrentAgents: input.maxConcurrentAgents ?? 2,
        isDraining: input.isDraining ?? false,
        availableSlots: input.availableSlots ?? 0,
        ramBudgetMb: input.ramBudgetMb ?? null,
        ramCommittedMb: input.ramCommittedMb ?? null,
        ramAvailableMb: input.ramAvailableMb ?? null,
        systemMetrics: input.systemMetrics ?? null,
        lastHeartbeatAt: now,
        updatedAt: now,
      },
    })
    .returning();

  if (!row) throw new Error("Failed to upsert worker");

  // Fire lifecycle events (fire-and-forget to avoid blocking heartbeat)
  const workerName = input.hostname;
  const ip = input.currentIp ?? null;

  if (!existing || existing.status === "offline") {
    // New worker or came back online → "started"
    insertLifecycleEvent({ workerName, eventType: "started", ip }).catch(() => {});
  }

  if (existing && existing.currentIp && ip && existing.currentIp !== ip) {
    // IP changed
    insertLifecycleEvent({
      workerName,
      eventType: "ip_changed",
      ip,
      metadata: { previousIp: existing.currentIp },
    }).catch(() => {});
  }

  const wasDraining = existing?.isDraining ?? false;
  const isDraining = row.isDraining;
  if (!existing && isDraining) {
    insertLifecycleEvent({
      workerName,
      eventType: "draining_started",
      ip,
      metadata: { reason: "initial_heartbeat" },
    }).catch(() => {});
  } else if (existing && wasDraining !== isDraining) {
    insertLifecycleEvent({
      workerName,
      eventType: isDraining ? "draining_started" : "draining_stopped",
      ip,
      metadata: { reason: "heartbeat_transition" },
    }).catch(() => {});
  }

  return row;
};

export const updateHeartbeat = async (
  workerId: string,
  data: {
    activeJobs?: number;
    config?: Record<string, unknown>;
    maxConcurrentAgents?: number;
    isDraining?: boolean;
    availableSlots?: number;
    ramBudgetMb?: number | null;
    ramCommittedMb?: number | null;
    ramAvailableMb?: number | null;
    systemMetrics?: Record<string, unknown>;
  }
): Promise<typeof workerRegistrations.$inferSelect | null> => {
  const [existing] = await db
    .select()
    .from(workerRegistrations)
    .where(eq(workerRegistrations.workerId, workerId))
    .limit(1);

  const now = new Date();
  const [row] = await db
    .update(workerRegistrations)
    .set({
      status: "online",
      lastHeartbeatAt: now,
      activeJobs: data.activeJobs ?? undefined,
      config: (data.config ?? undefined) as never,
      maxConcurrentAgents: data.maxConcurrentAgents ?? undefined,
      isDraining: data.isDraining ?? undefined,
      availableSlots: data.availableSlots ?? undefined,
      ramBudgetMb: data.ramBudgetMb ?? undefined,
      ramCommittedMb: data.ramCommittedMb ?? undefined,
      ramAvailableMb: data.ramAvailableMb ?? undefined,
      systemMetrics: data.systemMetrics ?? undefined,
      updatedAt: now,
    })
    .where(eq(workerRegistrations.workerId, workerId))
    .returning();

  if (
    row &&
    existing &&
    data.isDraining !== undefined &&
    existing.isDraining !== row.isDraining
  ) {
    insertLifecycleEvent({
      workerName: row.hostname,
      eventType: row.isDraining ? "draining_started" : "draining_stopped",
      ip: row.currentIp,
      metadata: { reason: "heartbeat_update" },
    }).catch(() => {});
  }

  return row ?? null;
};

export const getWorkers = async (): Promise<typeof workerRegistrations.$inferSelect[]> => {
  return db
    .select()
    .from(workerRegistrations)
    .orderBy(sql`${workerRegistrations.updatedAt} DESC`);
};

export const getOrphanedWorkerJobs = async () => {
  return db
    .select({
      id: agentJobs.id,
      status: agentJobs.status,
      jobType: agentJobs.jobType,
      skillName: agentJobs.skillName,
      promptTemplate: agentJobs.promptTemplate,
      workerId: agentJobs.workerId,
      workerHostname: workerRegistrations.hostname,
      workItemId: agentJobs.workItemId,
      workItemTaskId: workItems.taskId,
      workItemTitle: workItems.title,
      createdAt: agentJobs.createdAt,
      startedAt: agentJobs.startedAt,
    })
    .from(agentJobs)
    .leftJoin(
      workerRegistrations,
      eq(workerRegistrations.workerId, agentJobs.workerId),
    )
    .leftJoin(workItems, eq(workItems.id, agentJobs.workItemId))
    .where(
      and(
        sql`${agentJobs.workerId} IS NOT NULL`,
        inArray(agentJobs.status, WORKER_BOUND_ACTIVE_JOB_STATUSES),
        or(
          eq(workerRegistrations.status, "offline"),
          isNull(workerRegistrations.workerId),
        ),
      ),
    )
    .orderBy(desc(agentJobs.updatedAt));
};

export type OrphanedWorkerJobDb = Awaited<
  ReturnType<typeof getOrphanedWorkerJobs>
>[number];

export const getWorkerById = async (
  workerId: string
): Promise<typeof workerRegistrations.$inferSelect | null> => {
  const [row] = await db
    .select()
    .from(workerRegistrations)
    .where(eq(workerRegistrations.workerId, workerId))
    .limit(1);
  return row ?? null;
};

export const getWorkersWithJobs = async (orgId?: string) => {
  // Show all online workers plus any that have handled jobs for this org.
  // Shared runners may not yet have jobs for a given org but should still
  // appear so the user can enqueue work.
  let workers;
  if (orgId) {
    const orgWorkerIds = db
      .selectDistinct({ workerId: agentJobs.workerId })
      .from(agentJobs)
      .where(
        and(
          eq(agentJobs.organizationId, orgId),
          sql`${agentJobs.workerId} IS NOT NULL`
        )
      );

    workers = await db
      .select()
      .from(workerRegistrations)
      .where(
        or(
          inArray(workerRegistrations.workerId, orgWorkerIds),
          eq(workerRegistrations.status, "online"),
        )
      )
      .orderBy(sql`${workerRegistrations.updatedAt} DESC`);
  } else {
    workers = await db
      .select()
      .from(workerRegistrations)
      .orderBy(sql`${workerRegistrations.updatedAt} DESC`);
  }

  if (workers.length === 0) return [];

  const workerIds = workers.map((w) => w.workerId);

  const jobConditions = [
    inArray(agentJobs.workerId, workerIds),
    inArray(agentJobs.status, ["running", "queued"]),
  ];
  // Only show this org's jobs
  if (orgId) {
    jobConditions.push(eq(agentJobs.organizationId, orgId));
  }

  const activeJobRows = await db
    .select({
      workerId: agentJobs.workerId,
      id: agentJobs.id,
      jobType: agentJobs.jobType,
      status: agentJobs.status,
      workItemId: agentJobs.workItemId,
      workItemTaskId: workItems.taskId,
      workItemTitle: workItems.title,
      createdAt: agentJobs.createdAt,
      startedAt: agentJobs.startedAt,
      config: agentJobs.config,
      promptTemplate: agentJobs.promptTemplate,
      skillName: agentJobs.skillName,
    })
    .from(agentJobs)
    .leftJoin(workItems, eq(workItems.id, agentJobs.workItemId))
    .where(and(...jobConditions));

  const jobsByWorker = new Map<string, typeof activeJobRows>();
  for (const job of activeJobRows) {
    if (!job.workerId) continue;
    const list = jobsByWorker.get(job.workerId) ?? [];
    list.push(job);
    jobsByWorker.set(job.workerId, list);
  }

  return workers.map((w) => ({
    ...w,
    activeJobDetails: jobsByWorker.get(w.workerId) ?? [],
  }));
};

export const deleteWorker = async (workerId: string, orgId?: string): Promise<boolean> => {
  // If orgId is provided, verify the worker belongs to this org before deleting
  if (orgId) {
    const [hasOrgJob] = await db
      .select({ workerId: agentJobs.workerId })
      .from(agentJobs)
      .where(
        and(
          eq(agentJobs.workerId, workerId),
          eq(agentJobs.organizationId, orgId)
        )
      )
      .limit(1);

    if (!hasOrgJob) return false;
  }

  const deleted = await db
    .delete(workerRegistrations)
    .where(eq(workerRegistrations.workerId, workerId))
    .returning({ id: workerRegistrations.id });
  return deleted.length > 0;
};

export const markOfflineWorkers = async (
  thresholdMs: number
): Promise<number> => {
  const now = Date.now();
  const cutoff = new Date(now - Math.max(0, thresholdMs));

  const updated = await db
    .update(workerRegistrations)
    .set({
      status: "offline",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(workerRegistrations.status, "online"),
        lt(workerRegistrations.lastHeartbeatAt, cutoff)
      )
    )
    .returning({
      workerId: workerRegistrations.workerId,
      hostname: workerRegistrations.hostname,
      currentIp: workerRegistrations.currentIp,
      isDraining: workerRegistrations.isDraining,
    });

  // Fire "stopped" lifecycle events for each worker that went offline
  for (const worker of updated) {
    insertLifecycleEvent({
      workerName: worker.hostname,
      eventType: "stopped",
      ip: worker.currentIp,
      metadata: {
        reason: worker.isDraining ? "scale_down" : "heartbeat_timeout",
      },
    }).catch(() => {});
  }

  return updated.length;
};
