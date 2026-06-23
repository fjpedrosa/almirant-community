import { db } from "../../client";
import { workerLifecycleEvents, workerRegistrations, agentJobs } from "../../schema";
import { eq, desc, gte, lte, and, inArray, sql } from "drizzle-orm";
import type { WorkerLifecycleMetadata } from "../../schema/worker-lifecycle";

/**
 * Get worker hostnames (workerNames) that belong to an org via agentJobs.
 * workerRegistrations.workerId <-> agentJobs.workerId, hostname = workerName in lifecycle events.
 */
const getOrgWorkerNames = (orgId: string) =>
  db
    .selectDistinct({ hostname: workerRegistrations.hostname })
    .from(workerRegistrations)
    .innerJoin(
      agentJobs,
      and(
        eq(workerRegistrations.workerId, agentJobs.workerId),
        eq(agentJobs.organizationId, orgId)
      )
    );

/**
 * Verify that a specific worker (by hostname) belongs to an org.
 */
const verifyWorkerBelongsToOrg = async (
  workerName: string,
  orgId: string
): Promise<boolean> => {
  const [match] = await db
    .select({ hostname: workerRegistrations.hostname })
    .from(workerRegistrations)
    .innerJoin(
      agentJobs,
      and(
        eq(workerRegistrations.workerId, agentJobs.workerId),
        eq(agentJobs.organizationId, orgId)
      )
    )
    .where(eq(workerRegistrations.hostname, workerName))
    .limit(1);

  return !!match;
};

export type InsertLifecycleEventInput = {
  workerName: string;
  eventType: "started" | "stopped" | "ip_changed" | "draining_started" | "draining_stopped";
  ip?: string | null;
  metadata?: WorkerLifecycleMetadata;
};

export const insertLifecycleEvent = async (
  input: InsertLifecycleEventInput
): Promise<typeof workerLifecycleEvents.$inferSelect> => {
  const [row] = await db
    .insert(workerLifecycleEvents)
    .values({
      workerName: input.workerName,
      eventType: input.eventType,
      ip: input.ip ?? null,
      metadata: input.metadata ?? {},
    })
    .returning();

  if (!row) throw new Error("Failed to insert lifecycle event");
  return row;
};

export const getLifecycleEvents = async (
  workerName: string,
  options?: { limit?: number; offset?: number; orgId?: string }
): Promise<typeof workerLifecycleEvents.$inferSelect[]> => {
  const limit = options?.limit ?? 100;
  const offset = options?.offset ?? 0;

  // If orgId provided, verify the worker belongs to this org
  if (options?.orgId) {
    const belongs = await verifyWorkerBelongsToOrg(workerName, options.orgId);
    if (!belongs) return [];
  }

  return db
    .select()
    .from(workerLifecycleEvents)
    .where(eq(workerLifecycleEvents.workerName, workerName))
    .orderBy(desc(workerLifecycleEvents.createdAt))
    .limit(limit)
    .offset(offset);
};

export interface WorkerAuditSummary {
  workerName: string;
  totalStarts: number;
  totalStops: number;
  totalUptimeMs: number;
  uniqueIps: string[];
  lastEvent: typeof workerLifecycleEvents.$inferSelect | null;
}

export const getWorkerAuditSummary = async (
  workerName: string,
  orgId?: string
): Promise<WorkerAuditSummary> => {
  // If orgId provided, verify the worker belongs to this org
  if (orgId) {
    const belongs = await verifyWorkerBelongsToOrg(workerName, orgId);
    if (!belongs) {
      return {
        workerName,
        totalStarts: 0,
        totalStops: 0,
        totalUptimeMs: 0,
        uniqueIps: [],
        lastEvent: null,
      };
    }
  }

  // Get all events for this worker ordered by time
  const events = await db
    .select()
    .from(workerLifecycleEvents)
    .where(eq(workerLifecycleEvents.workerName, workerName))
    .orderBy(workerLifecycleEvents.createdAt);

  let totalStarts = 0;
  let totalStops = 0;
  let totalUptimeMs = 0;
  const ipSet = new Set<string>();
  let lastStartedAt: Date | null = null;

  for (const event of events) {
    if (event.eventType === "started") {
      totalStarts++;
      lastStartedAt = event.createdAt;
    } else if (event.eventType === "stopped") {
      totalStops++;
      if (lastStartedAt) {
        totalUptimeMs += event.createdAt.getTime() - lastStartedAt.getTime();
        lastStartedAt = null;
      }
    }
    if (event.ip) {
      ipSet.add(event.ip);
    }
  }

  // If currently running (started but not stopped), count uptime until now
  if (lastStartedAt) {
    totalUptimeMs += Date.now() - lastStartedAt.getTime();
  }

  const lastEvent = events.length > 0 ? events[events.length - 1]! : null;

  return {
    workerName,
    totalStarts,
    totalStops,
    totalUptimeMs,
    uniqueIps: Array.from(ipSet),
    lastEvent,
  };
};

/**
 * Get lifecycle events within a time range across all workers.
 * Also fetches the last event before range start per worker (to determine initial state).
 * Includes draining transitions so callers can distinguish planned scale-downs from incidents.
 */
export const getLifecycleEventsInRange = async (
  from: Date,
  to: Date,
  orgId?: string
): Promise<(typeof workerLifecycleEvents.$inferSelect)[]> => {
  const relevantTypes = [
    "started",
    "stopped",
    "draining_started",
    "draining_stopped",
  ] as const;

  // Build conditions for the in-range query
  const inRangeConditions = [
    gte(workerLifecycleEvents.createdAt, from),
    lte(workerLifecycleEvents.createdAt, to),
    inArray(workerLifecycleEvents.eventType, [...relevantTypes]),
  ];

  // If orgId provided, restrict to worker names belonging to this org
  if (orgId) {
    inRangeConditions.push(
      inArray(
        workerLifecycleEvents.workerName,
        getOrgWorkerNames(orgId)
      )
    );
  }

  // Events within the range
  const inRangeEvents = await db
    .select()
    .from(workerLifecycleEvents)
    .where(and(...inRangeConditions))
    .orderBy(workerLifecycleEvents.createdAt);

  // Get the last event before range start per worker (to determine initial state)
  const workerNames = [...new Set(inRangeEvents.map((e) => e.workerName))];

  // Also look for workers that may have events only before the range
  const allWorkerNamesConditions = [
    inArray(workerLifecycleEvents.eventType, [...relevantTypes]),
  ];
  if (orgId) {
    allWorkerNamesConditions.push(
      inArray(
        workerLifecycleEvents.workerName,
        getOrgWorkerNames(orgId)
      )
    );
  }

  const allWorkerNames = await db
    .selectDistinct({ workerName: workerLifecycleEvents.workerName })
    .from(workerLifecycleEvents)
    .where(and(...allWorkerNamesConditions));

  const uniqueWorkers = [
    ...new Set([
      ...workerNames,
      ...allWorkerNames.map((w) => w.workerName),
    ]),
  ];

  const preRangeEvents: (typeof workerLifecycleEvents.$inferSelect)[] = [];

  for (const wn of uniqueWorkers) {
    const [lastBefore] = await db
      .select()
      .from(workerLifecycleEvents)
      .where(
        and(
          eq(workerLifecycleEvents.workerName, wn),
          lte(workerLifecycleEvents.createdAt, from),
          inArray(workerLifecycleEvents.eventType, [...relevantTypes])
        )
      )
      .orderBy(desc(workerLifecycleEvents.createdAt))
      .limit(1);

    if (lastBefore) {
      preRangeEvents.push(lastBefore);
    }
  }

  // Combine and sort by createdAt
  return [...preRangeEvents, ...inRangeEvents].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
  );
};
