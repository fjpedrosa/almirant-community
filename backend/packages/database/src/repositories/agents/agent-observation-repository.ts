import {
  and,
  count,
  desc,
  eq,
  ilike,
  isNotNull,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import { db } from "../../client";
import { agentObservations } from "../../schema";
import type {
  AgentObservation,
  NewAgentObservation,
} from "../../schema/agent-observations";

export interface ObservationFilters {
  projectId?: string;
  agentJobId?: string;
  workItemId?: string;
  feedbackItemId?: string;
  type?: string;
  types?: string[];
  topicKey?: string;
  scope?: string;
  visibility?: "personal" | "project" | "org";
  ownerUserId?: string;
  minConfidence?: number;
  includeQuarantined?: boolean;
  includeArchived?: boolean;
  includeExpired?: boolean;
  includeSuperseded?: boolean;
  archived?: boolean;
  recencyDays?: number;
  limit?: number;
  offset?: number;
}

export interface ObservationSearchRow extends AgentObservation {
  rank: number;
}

const DEFAULT_RETRIEVAL_MIN_CONFIDENCE = 0.4;

const buildSearchVector = (title: string, content: string) =>
  sql`(
    setweight(to_tsvector('spanish', coalesce(${title}, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(${title}, '')), 'A') ||
    setweight(to_tsvector('spanish', coalesce(${content}, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(${content}, '')), 'B')
  )`;

const buildTsQuery = (query: string) =>
  sql`(plainto_tsquery('spanish', ${query}) || plainto_tsquery('english', ${query}))`;

const normalizeConfidence = (value: unknown): string => {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  if (Number.isNaN(parsed)) return "0.50";
  return Math.min(1, Math.max(0, parsed)).toFixed(2);
};

const activeLifecycleConditions = (filters?: ObservationFilters) => {
  const conditions: ReturnType<typeof eq>[] | any[] = [];

  if (filters?.archived === true) {
    conditions.push(isNotNull(agentObservations.archivedAt));
  } else if (!filters?.includeArchived) {
    conditions.push(isNull(agentObservations.archivedAt));
  }

  if (!filters?.includeExpired) {
    conditions.push(
      sql`(${agentObservations.expiresAt} IS NULL OR ${agentObservations.expiresAt} > now())`
    );
  }

  if (!filters?.includeSuperseded) {
    conditions.push(sql`NOT EXISTS (
      SELECT 1
      FROM agent_observations child
      WHERE child.supersedes_observation_id = ${agentObservations.id}
        AND child.archived_at IS NULL
        AND (child.expires_at IS NULL OR child.expires_at > now())
    )`);
  }

  return conditions;
};

const buildBaseConditions = (orgId: string, filters?: ObservationFilters) => {
  const conditions: ReturnType<typeof eq>[] | any[] = [
    eq(agentObservations.workspaceId, orgId),
    ...activeLifecycleConditions(filters),
  ];

  if (filters?.projectId) {
    conditions.push(eq(agentObservations.projectId, filters.projectId));
  }
  if (filters?.agentJobId) {
    conditions.push(eq(agentObservations.agentJobId, filters.agentJobId));
  }
  if (filters?.workItemId) {
    conditions.push(eq(agentObservations.workItemId, filters.workItemId));
  }
  if (filters?.feedbackItemId) {
    conditions.push(eq(agentObservations.feedbackItemId, filters.feedbackItemId));
  }
  if (filters?.type) {
    conditions.push(
      sql`${agentObservations.type} = ${filters.type}` as ReturnType<typeof eq>
    );
  }
  if (filters?.types && filters.types.length > 0) {
    conditions.push(
      sql`${agentObservations.type} = ANY(${filters.types})` as ReturnType<
        typeof eq
      >
    );
  }
  if (filters?.topicKey) {
    conditions.push(eq(agentObservations.topicKey, filters.topicKey));
  }
  if (filters?.scope) {
    conditions.push(eq(agentObservations.scope, filters.scope));
  }
  if (filters?.visibility) {
    conditions.push(eq(agentObservations.visibility, filters.visibility));
  }
  if (filters?.ownerUserId) {
    conditions.push(eq(agentObservations.ownerUserId, filters.ownerUserId));
  }

  const minConfidence = filters?.includeQuarantined
    ? filters.minConfidence
    : Math.max(
        filters?.minConfidence ?? DEFAULT_RETRIEVAL_MIN_CONFIDENCE,
        DEFAULT_RETRIEVAL_MIN_CONFIDENCE
      );
  if (minConfidence != null) {
    conditions.push(
      sql`${agentObservations.confidence} >= ${normalizeConfidence(minConfidence)}`
    );
  }

  if (filters?.recencyDays && filters.recencyDays > 0) {
    conditions.push(
      sql`${agentObservations.createdAt} >= now() - (${filters.recencyDays} * interval '1 day')`
    );
  }

  return conditions;
};

const findActiveDuplicate = async (
  data: Pick<
    NewAgentObservation,
    | "workspaceId"
    | "contentHash"
    | "visibility"
    | "projectId"
    | "ownerUserId"
  >
) => {
  const visibility = data.visibility ?? "project";
  const conditions: ReturnType<typeof eq>[] | any[] = [
    eq(agentObservations.workspaceId, data.workspaceId),
    eq(agentObservations.contentHash, data.contentHash),
    eq(agentObservations.visibility, visibility),
    isNull(agentObservations.archivedAt),
  ];

  if (visibility === "project") {
    conditions.push(
      data.projectId
        ? eq(agentObservations.projectId, data.projectId)
        : isNull(agentObservations.projectId)
    );
  } else if (visibility === "personal") {
    conditions.push(
      data.ownerUserId
        ? eq(agentObservations.ownerUserId, data.ownerUserId)
        : isNull(agentObservations.ownerUserId)
    );
  }

  const [existing] = await db
    .select({ id: agentObservations.id })
    .from(agentObservations)
    .where(and(...conditions))
    .orderBy(desc(agentObservations.updatedAt))
    .limit(1);

  return existing?.id ?? null;
};

const buildUpsertPayload = (data: NewAgentObservation) => ({
  ...data,
  visibility: data.visibility ?? "project",
  createdByKind: data.createdByKind ?? "agent",
  confidence: normalizeConfidence(data.confidence),
  searchVector: buildSearchVector(data.title, data.content),
  verifiedAt:
    data.verifiedByUserId && !data.verifiedAt ? sql`now()` : data.verifiedAt,
  updatedAt: data.updatedAt ?? sql`now()`,
});

export const createObservation = async (
  data: NewAgentObservation,
  options?: { onDuplicate?: "update" | "skip" }
) => {
  const payload = buildUpsertPayload(data);

  try {
    const [created] = await db
      .insert(agentObservations)
      .values(payload)
      .returning();
    return created!;
  } catch (error) {
    const dbError = error as { code?: string };
    if (dbError?.code !== "23505") throw error;

    const duplicateId = await findActiveDuplicate({
      workspaceId: data.workspaceId,
      contentHash: data.contentHash,
      visibility: data.visibility,
      projectId: data.projectId,
      ownerUserId: data.ownerUserId,
    });
    if (!duplicateId) throw error;

    if (options?.onDuplicate === "skip") {
      const [existing] = await db
        .select()
        .from(agentObservations)
        .where(eq(agentObservations.id, duplicateId))
        .limit(1);
      return existing!;
    }

    const [updated] = await db
      .update(agentObservations)
      .set({
        ...payload,
        revision: sql`${agentObservations.revision} + 1`,
      })
      .where(eq(agentObservations.id, duplicateId))
      .returning();

    return updated!;
  }
};

export const getObservationById = async (
  id: string,
  options?: { includeArchived?: boolean; includeExpired?: boolean }
) => {
  const conditions: ReturnType<typeof eq>[] | any[] = [
    eq(agentObservations.id, id),
  ];

  if (!options?.includeArchived) {
    conditions.push(isNull(agentObservations.archivedAt));
  }
  if (!options?.includeExpired) {
    conditions.push(
      sql`(${agentObservations.expiresAt} IS NULL OR ${agentObservations.expiresAt} > now())`
    );
  }

  const [observation] = await db
    .select()
    .from(agentObservations)
    .where(and(...conditions))
    .limit(1);
  return observation;
};

export const getObservationsByOrg = async (
  orgId: string,
  filters?: ObservationFilters
) => {
  const conditions = buildBaseConditions(orgId, filters);
  const query = db
    .select()
    .from(agentObservations)
    .where(and(...conditions))
    .orderBy(desc(agentObservations.updatedAt));

  const effectiveLimit = filters?.limit ?? 50;
  const limited = query.limit(effectiveLimit);
  return filters?.offset ? limited.offset(filters.offset) : limited;
};

export const countObservationsByOrg = async (
  orgId: string,
  filters?: ObservationFilters
) => {
  const conditions = buildBaseConditions(orgId, filters);
  const [row] = await db
    .select({ value: count() })
    .from(agentObservations)
    .where(and(...conditions));
  return row?.value ?? 0;
};

export const getObservationsByTopicKey = async (
  orgId: string,
  topicKey: string,
  projectId?: string
) => {
  const conditions = buildBaseConditions(orgId, {
    topicKey,
    projectId,
    includeArchived: true,
    includeExpired: true,
    includeSuperseded: true,
    includeQuarantined: true,
  });

  return db
    .select()
    .from(agentObservations)
    .where(and(...conditions))
    .orderBy(desc(agentObservations.revision), desc(agentObservations.updatedAt));
};

export const searchObservations = async (
  orgId: string,
  query: string,
  filters?: ObservationFilters & { minScore?: number }
): Promise<ObservationSearchRow[]> => {
  const useTsvector = query.trim().length >= 2;
  const tsQuery = buildTsQuery(query);
  const conditions = buildBaseConditions(orgId, filters);

  if (useTsvector) {
    conditions.push(sql`${agentObservations.searchVector} @@ ${tsQuery}`);
  } else {
    conditions.push(
      or(
        ilike(agentObservations.title, `%${query}%`),
        ilike(agentObservations.content, `%${query}%`)
      )!
    );
  }

  const rankExpr = useTsvector
    ? sql<number>`ts_rank(${agentObservations.searchVector}, ${tsQuery})`
    : sql<number>`0.1`;

  if (filters?.minScore != null) {
    conditions.push(sql`${rankExpr} >= ${filters.minScore}`);
  }

  const queryBuilder = db
    .select({
      id: agentObservations.id,
      workspaceId: agentObservations.workspaceId,
      projectId: agentObservations.projectId,
      agentJobId: agentObservations.agentJobId,
      ownerUserId: agentObservations.ownerUserId,
      visibility: agentObservations.visibility,
      createdByKind: agentObservations.createdByKind,
      workItemId: agentObservations.workItemId,
      feedbackItemId: agentObservations.feedbackItemId,
      supersedesObservationId: agentObservations.supersedesObservationId,
      type: agentObservations.type,
      topicKey: agentObservations.topicKey,
      title: agentObservations.title,
      content: agentObservations.content,
      scope: agentObservations.scope,
      revision: agentObservations.revision,
      confidence: agentObservations.confidence,
      contentHash: agentObservations.contentHash,
      metadata: agentObservations.metadata,
      verifiedByUserId: agentObservations.verifiedByUserId,
      verifiedAt: agentObservations.verifiedAt,
      expiresAt: agentObservations.expiresAt,
      archivedAt: agentObservations.archivedAt,
      createdAt: agentObservations.createdAt,
      updatedAt: agentObservations.updatedAt,
      embedding: agentObservations.embedding,
      searchVector: agentObservations.searchVector,
      rank: rankExpr.as("rank"),
    })
    .from(agentObservations)
    .where(and(...conditions))
    .orderBy(sql`${rankExpr} DESC`, desc(agentObservations.updatedAt));

  const effectiveLimit = filters?.limit ?? 20;
  const limited = queryBuilder.limit(effectiveLimit);
  const results = filters?.offset ? await limited.offset(filters.offset) : await limited;
  return results as ObservationSearchRow[];
};

export const getRecentObservations = async (
  orgId: string,
  options?: ObservationFilters
) => {
  const conditions = buildBaseConditions(orgId, options);
  const effectiveLimit = options?.limit ?? 50;

  return db
    .select()
    .from(agentObservations)
    .where(and(...conditions))
    .orderBy(desc(agentObservations.createdAt))
    .limit(effectiveLimit);
};

export const archiveObservation = async (id: string) => {
  const [updated] = await db
    .update(agentObservations)
    .set({
      archivedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(eq(agentObservations.id, id))
    .returning();
  return updated;
};

export const verifyObservation = async (
  id: string,
  verifiedByUserId: string,
  confidence = 1
) => {
  const [updated] = await db
    .update(agentObservations)
    .set({
      verifiedByUserId,
      verifiedAt: sql`now()`,
      confidence: normalizeConfidence(confidence),
      updatedAt: sql`now()`,
    })
    .where(eq(agentObservations.id, id))
    .returning();
  return updated;
};

export const deleteObservation = async (id: string) => {
  const [deleted] = await db
    .delete(agentObservations)
    .where(eq(agentObservations.id, id))
    .returning();
  return deleted;
};

export const supersedeObservation = async (
  oldObservationId: string,
  newObservationId: string
) => {
  const [updated] = await db
    .update(agentObservations)
    .set({
      supersedesObservationId: oldObservationId,
      updatedAt: sql`now()`,
    })
    .where(eq(agentObservations.id, newObservationId))
    .returning();

  return updated;
};

export const findObservationsByWorkItemId = async (workItemId: string) => {
  return db
    .select()
    .from(agentObservations)
    .where(
      and(
        eq(agentObservations.workItemId, workItemId),
        ...activeLifecycleConditions()
      )
    )
    .orderBy(desc(agentObservations.updatedAt));
};

export const updateObservation = async (
  id: string,
  data: Partial<
    Pick<
      NewAgentObservation,
      | "title"
      | "content"
      | "scope"
      | "metadata"
      | "confidence"
      | "verifiedByUserId"
      | "verifiedAt"
      | "expiresAt"
      | "archivedAt"
      | "supersedesObservationId"
    >
  >
) => {
  const updateFields: Record<string, unknown> = {
    ...data,
    updatedAt: sql`now()`,
  };

  if (data.confidence !== undefined) {
    updateFields.confidence = normalizeConfidence(data.confidence);
  }

  if (data.verifiedByUserId !== undefined && data.verifiedByUserId !== null) {
    updateFields.verifiedAt = data.verifiedAt ?? sql`now()`;
  }

  if (data.title !== undefined || data.content !== undefined) {
    const [current] = await db
      .select({
        title: agentObservations.title,
        content: agentObservations.content,
      })
      .from(agentObservations)
      .where(eq(agentObservations.id, id))
      .limit(1);

    if (current) {
      const newTitle = data.title ?? current.title;
      const newContent = data.content ?? current.content;
      updateFields.searchVector = buildSearchVector(newTitle, newContent);
    }
  }

  const [updated] = await db
    .update(agentObservations)
    .set(updateFields)
    .where(eq(agentObservations.id, id))
    .returning();
  return updated;
};

export const archiveUnreadQuarantinedObservations = async (
  olderThanDays = 60
) => {
  return db
    .update(agentObservations)
    .set({
      archivedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(sql`
      ${agentObservations.archivedAt} IS NULL
      AND ${agentObservations.confidence} < 0.4
      AND ${agentObservations.updatedAt} < now() - (${olderThanDays} * interval '1 day')
      AND NOT EXISTS (
        SELECT 1
        FROM agent_memory_telemetry_hits hits
        INNER JOIN agent_memory_telemetry telemetry
          ON telemetry.id = hits.telemetry_id
        WHERE hits.observation_id = ${agentObservations.id}
      )
    `)
    .returning();
};

export const archiveSupersededObservations = async (olderThanDays = 30) => {
  return db
    .update(agentObservations)
    .set({
      archivedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(sql`
      ${agentObservations.archivedAt} IS NULL
      AND EXISTS (
        SELECT 1
        FROM agent_observations child
        WHERE child.supersedes_observation_id = ${agentObservations.id}
      )
      AND ${agentObservations.updatedAt} < now() - (${olderThanDays} * interval '1 day')
    `)
    .returning();
};
