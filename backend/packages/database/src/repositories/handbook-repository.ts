import { createHash } from "node:crypto";
import { db } from "../client";
import {
  handbookCaptureProposals,
  handbookChunks,
  handbookEntries,
  handbookEntryVersions,
  handbookSearchVector,
  projects,
} from "../schema";
import { and, asc, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import type { PaginationParams } from "../domain/types";
import type {
  HandbookEntry,
  NewHandbookCaptureProposal,
} from "../schema";

export type HandbookEntryStatus = "draft" | "verified" | "deprecated";
export type HandbookEntrySourceType = "import" | "agent_capture" | "manual";
export type HandbookCaptureProposalStatus = "pending" | "approved" | "rejected";

export type HandbookEntryInput = {
  title: string;
  slug: string;
  summary?: string | null;
  content: string;
  category?: string;
  status?: HandbookEntryStatus;
  sourceType?: HandbookEntrySourceType;
  sourcePath?: string | null;
  sourceProjectId?: string | null;
  metadata?: Record<string, unknown>;
  createdByUserId?: string | null;
  createdByAgentJobId?: string | null;
};

export type HandbookChunkInput = {
  chunkIndex: number;
  headingPath?: string | null;
  content: string;
  tokenCount?: number | null;
  embedding?: number[] | null;
  metadata?: Record<string, unknown>;
};

export type HandbookCaptureProposalInput = {
  title: string;
  slug: string;
  summary?: string | null;
  proposedContent: string;
  category?: string;
  rationale?: string | null;
  sourceProjectId?: string | null;
  sourceFiles?: string[];
  targetEntryId?: string | null;
  createdByUserId?: string | null;
  createdByAgentJobId?: string | null;
};

export const hashHandbookEntryContent = (content: string): string =>
  createHash("sha256").update(content).digest("hex");

const contentMetrics = (content: string) => ({
  wordCount: content.trim().split(/\s+/).filter(Boolean).length,
  sizeBytes: new TextEncoder().encode(content).length,
});

const orgProjectIds = (workspaceId: string) =>
  db.select({ id: projects.id }).from(projects).where(eq(projects.workspaceId, workspaceId));

const computeNextVersion = async (entryId: string): Promise<number> => {
  const [row] = await db
    .select({ maxVersion: sql<number>`coalesce(max(${handbookEntryVersions.version}), 0)::int` })
    .from(handbookEntryVersions)
    .where(eq(handbookEntryVersions.entryId, entryId));
  return (row?.maxVersion ?? 0) + 1;
};

export const createHandbookVersion = async ({
  entry,
  changeSummary,
  createdByUserId,
  createdByAgentJobId,
}: {
  entry: HandbookEntry;
  changeSummary?: string | null;
  createdByUserId?: string | null;
  createdByAgentJobId?: string | null;
}) => {
  const version = await computeNextVersion(entry.id);
  const [created] = await db
    .insert(handbookEntryVersions)
    .values({
      entryId: entry.id,
      version,
      title: entry.title,
      summary: entry.summary,
      content: entry.content,
      contentHash: entry.contentHash,
      changeSummary: changeSummary ?? null,
      createdByUserId: createdByUserId ?? entry.createdByUserId,
      createdByAgentJobId: createdByAgentJobId ?? entry.createdByAgentJobId,
    })
    .returning();
  return created;
};

export const replaceHandbookChunks = async (
  entryId: string,
  chunks: HandbookChunkInput[],
) => {
  await db.delete(handbookChunks).where(eq(handbookChunks.entryId, entryId));
  if (chunks.length === 0) return [];

  const values = chunks.map((chunk) => ({
    entryId,
    chunkIndex: chunk.chunkIndex,
    headingPath: chunk.headingPath ?? null,
    content: chunk.content,
    tokenCount: chunk.tokenCount ?? null,
    embedding: chunk.embedding ?? null,
    metadata: chunk.metadata ?? {},
    searchVector: handbookSearchVector(sql`${chunk.headingPath ?? ""}`, sql`''`, sql`${chunk.content}`),
  }));

  return db.insert(handbookChunks).values(values).returning();
};

const entrySelect = {
  id: handbookEntries.id,
  workspaceId: handbookEntries.workspaceId,
  title: handbookEntries.title,
  slug: handbookEntries.slug,
  summary: handbookEntries.summary,
  content: handbookEntries.content,
  category: handbookEntries.category,
  status: handbookEntries.status,
  sourceType: handbookEntries.sourceType,
  sourcePath: handbookEntries.sourcePath,
  sourceProjectId: handbookEntries.sourceProjectId,
  contentHash: handbookEntries.contentHash,
  metadata: handbookEntries.metadata,
  createdByUserId: handbookEntries.createdByUserId,
  createdByAgentJobId: handbookEntries.createdByAgentJobId,
  archivedAt: handbookEntries.archivedAt,
  createdAt: handbookEntries.createdAt,
  updatedAt: handbookEntries.updatedAt,
  sourceProjectName: projects.name,
  sourceProjectColor: projects.color,
};

export const listHandbookEntries = async (
  workspaceId: string,
  pagination: PaginationParams,
  filters?: {
    search?: string;
    category?: string;
    status?: HandbookEntryStatus;
    includeArchived?: boolean;
  },
) => {
  const conditions = [eq(handbookEntries.workspaceId, workspaceId)];
  if (!filters?.includeArchived) conditions.push(isNull(handbookEntries.archivedAt));
  if (filters?.category) conditions.push(eq(handbookEntries.category, filters.category));
  if (filters?.status) conditions.push(eq(handbookEntries.status, filters.status));

  const search = filters?.search?.trim();
  const useTsvector = Boolean(search && search.length >= 2);
  const tsqueryExpr = search
    ? sql`(plainto_tsquery('spanish', ${search}) || plainto_tsquery('english', ${search}))`
    : null;

  if (search) {
    conditions.push(
      useTsvector && tsqueryExpr
        ? sql`${handbookEntries.searchVector} @@ ${tsqueryExpr}`
        : or(
            ilike(handbookEntries.title, `%${search}%`),
            ilike(handbookEntries.summary, `%${search}%`),
            ilike(handbookEntries.content, `%${search}%`),
          )!,
    );
  }

  const whereClause = and(...conditions);

  const [items, countRows] = await Promise.all([
    db
      .select({
        ...entrySelect,
        rank: useTsvector && tsqueryExpr
          ? sql<number>`ts_rank(${handbookEntries.searchVector}, ${tsqueryExpr})`.as("rank")
          : sql<number>`0`.as("rank"),
      })
      .from(handbookEntries)
      .leftJoin(projects, eq(handbookEntries.sourceProjectId, projects.id))
      .where(whereClause)
      .orderBy(
        useTsvector ? sql`rank DESC` : desc(handbookEntries.updatedAt),
        desc(handbookEntries.updatedAt),
      )
      .limit(pagination.limit)
      .offset(pagination.offset),
    db.select({ count: sql<number>`count(*)::int` }).from(handbookEntries).where(whereClause),
  ]);

  return { items, total: countRows[0]?.count ?? 0 };
};

export const getHandbookEntryById = async (workspaceId: string, id: string) => {
  const [entry] = await db
    .select(entrySelect)
    .from(handbookEntries)
    .leftJoin(projects, eq(handbookEntries.sourceProjectId, projects.id))
    .where(and(eq(handbookEntries.workspaceId, workspaceId), eq(handbookEntries.id, id)))
    .limit(1);
  return entry ?? null;
};

export const getHandbookEntryBySlug = async (workspaceId: string, slug: string) => {
  const [entry] = await db
    .select()
    .from(handbookEntries)
    .where(and(eq(handbookEntries.workspaceId, workspaceId), eq(handbookEntries.slug, slug)))
    .limit(1);
  return entry ?? null;
};

export const createHandbookEntry = async (
  workspaceId: string,
  input: HandbookEntryInput,
  chunks: HandbookChunkInput[] = [],
) => {
  const contentHash = hashHandbookEntryContent(input.content);
  const [entry] = await db
    .insert(handbookEntries)
    .values({
      workspaceId,
      title: input.title,
      slug: input.slug,
      summary: input.summary ?? null,
      content: input.content,
      category: input.category ?? "general",
      status: input.status ?? "draft",
      sourceType: input.sourceType ?? "manual",
      sourcePath: input.sourcePath ?? null,
      sourceProjectId: input.sourceProjectId ?? null,
      contentHash,
      metadata: { ...contentMetrics(input.content), ...(input.metadata ?? {}) },
      createdByUserId: input.createdByUserId ?? null,
      createdByAgentJobId: input.createdByAgentJobId ?? null,
      searchVector: handbookSearchVector(sql`${input.title}`, sql`${input.summary ?? ""}`, sql`${input.content}`),
    })
    .returning();

  if (!entry) throw new Error("Failed to create handbook entry");
  await createHandbookVersion({ entry, changeSummary: "Initial version" });
  await replaceHandbookChunks(entry.id, chunks);
  return getHandbookEntryById(workspaceId, entry.id);
};

export const updateHandbookEntry = async (
  workspaceId: string,
  id: string,
  input: Partial<HandbookEntryInput> & { changeSummary?: string | null },
  chunks?: HandbookChunkInput[],
) => {
  const existing = await getHandbookEntryById(workspaceId, id);
  if (!existing) return null;

  const nextTitle = input.title ?? existing.title;
  const nextSummary = input.summary !== undefined ? input.summary : existing.summary;
  const nextContent = input.content ?? existing.content;
  const updateData: Record<string, unknown> = {
    updatedAt: new Date(),
  };

  if (input.title !== undefined) updateData.title = input.title;
  if (input.slug !== undefined) updateData.slug = input.slug;
  if (input.summary !== undefined) updateData.summary = input.summary;
  if (input.content !== undefined) {
    updateData.content = input.content;
    updateData.contentHash = hashHandbookEntryContent(input.content);
    updateData.metadata = { ...(existing.metadata ?? {}), ...contentMetrics(input.content), ...(input.metadata ?? {}) };
  } else if (input.metadata !== undefined) {
    updateData.metadata = { ...(existing.metadata ?? {}), ...input.metadata };
  }
  if (input.category !== undefined) updateData.category = input.category;
  if (input.status !== undefined) updateData.status = input.status;
  if (input.sourcePath !== undefined) updateData.sourcePath = input.sourcePath;
  if (input.sourceProjectId !== undefined) updateData.sourceProjectId = input.sourceProjectId;
  updateData.searchVector = handbookSearchVector(sql`${nextTitle}`, sql`${nextSummary ?? ""}`, sql`${nextContent}`);

  const [updated] = await db
    .update(handbookEntries)
    .set(updateData)
    .where(and(eq(handbookEntries.workspaceId, workspaceId), eq(handbookEntries.id, id)))
    .returning();

  if (!updated) return null;

  if (input.content !== undefined || input.title !== undefined || input.summary !== undefined) {
    await createHandbookVersion({
      entry: updated,
      changeSummary: input.changeSummary ?? "Updated handbook entry",
      createdByUserId: input.createdByUserId,
      createdByAgentJobId: input.createdByAgentJobId,
    });
  }

  if (chunks) await replaceHandbookChunks(updated.id, chunks);
  return getHandbookEntryById(workspaceId, updated.id);
};

export const upsertImportedHandbookEntry = async (
  workspaceId: string,
  input: HandbookEntryInput,
  chunks: HandbookChunkInput[] = [],
) => {
  const existing = await getHandbookEntryBySlug(workspaceId, input.slug);
  if (!existing) {
    const created = await createHandbookEntry(workspaceId, {
      ...input,
      sourceType: "import",
      status: input.status ?? "verified",
    }, chunks);
    return { entry: created, action: "created" as const };
  }

  const nextHash = hashHandbookEntryContent(input.content);
  if (existing.contentHash === nextHash) {
    return { entry: await getHandbookEntryById(workspaceId, existing.id), action: "skipped" as const };
  }

  const updated = await updateHandbookEntry(
    workspaceId,
    existing.id,
    {
      ...input,
      sourceType: "import",
      changeSummary: `Re-imported from ${input.sourcePath ?? "external source"}`,
    },
    chunks,
  );
  return { entry: updated, action: "updated" as const };
};

export const archiveHandbookEntry = async (workspaceId: string, id: string) => {
  const [archived] = await db
    .update(handbookEntries)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(handbookEntries.workspaceId, workspaceId), eq(handbookEntries.id, id)))
    .returning();
  return archived ?? null;
};

export const getHandbookEntryChunks = async (workspaceId: string, entryId: string) => {
  const entry = await getHandbookEntryById(workspaceId, entryId);
  if (!entry) return [];
  return db
    .select()
    .from(handbookChunks)
    .where(eq(handbookChunks.entryId, entryId))
    .orderBy(asc(handbookChunks.chunkIndex));
};

export const searchHandbookChunks = async (
  workspaceId: string,
  query: string,
  options?: { limit?: number; status?: HandbookEntryStatus; category?: string },
) => {
  const limit = Math.min(options?.limit ?? 8, 30);
  const tsqueryExpr = sql`(plainto_tsquery('spanish', ${query}) || plainto_tsquery('english', ${query}))`;
  const conditions = [
    eq(handbookEntries.workspaceId, workspaceId),
    isNull(handbookEntries.archivedAt),
    sql`${handbookChunks.searchVector} @@ ${tsqueryExpr}`,
  ];
  if (options?.status) conditions.push(eq(handbookEntries.status, options.status));
  if (options?.category) conditions.push(eq(handbookEntries.category, options.category));

  return db
    .select({
      entryId: handbookEntries.id,
      title: handbookEntries.title,
      slug: handbookEntries.slug,
      summary: handbookEntries.summary,
      category: handbookEntries.category,
      status: handbookEntries.status,
      headingPath: handbookChunks.headingPath,
      content: handbookChunks.content,
      rank: sql<number>`ts_rank(${handbookChunks.searchVector}, ${tsqueryExpr})`.as("rank"),
    })
    .from(handbookChunks)
    .innerJoin(handbookEntries, eq(handbookChunks.entryId, handbookEntries.id))
    .where(and(...conditions))
    .orderBy(sql`rank DESC`, desc(handbookEntries.updatedAt))
    .limit(limit);
};

export const listHandbookCategories = async (workspaceId: string) => {
  return db
    .select({
      category: handbookEntries.category,
      count: sql<number>`count(*)::int`,
    })
    .from(handbookEntries)
    .where(and(eq(handbookEntries.workspaceId, workspaceId), isNull(handbookEntries.archivedAt)))
    .groupBy(handbookEntries.category)
    .orderBy(asc(handbookEntries.category));
};

export const createHandbookCaptureProposal = async (
  workspaceId: string,
  input: HandbookCaptureProposalInput,
) => {
  const [created] = await db
    .insert(handbookCaptureProposals)
    .values({
      workspaceId,
      title: input.title,
      slug: input.slug,
      summary: input.summary ?? null,
      proposedContent: input.proposedContent,
      category: input.category ?? "general",
      rationale: input.rationale ?? null,
      sourceProjectId: input.sourceProjectId ?? null,
      sourceFiles: input.sourceFiles ?? [],
      targetEntryId: input.targetEntryId ?? null,
      createdByUserId: input.createdByUserId ?? null,
      createdByAgentJobId: input.createdByAgentJobId ?? null,
    } satisfies NewHandbookCaptureProposal)
    .returning();

  if (!created) throw new Error("Failed to create handbook capture proposal");
  return created;
};

export const listHandbookCaptureProposals = async (
  workspaceId: string,
  status?: HandbookCaptureProposalStatus,
) => {
  const conditions = [eq(handbookCaptureProposals.workspaceId, workspaceId)];
  if (status) conditions.push(eq(handbookCaptureProposals.status, status));

  return db
    .select()
    .from(handbookCaptureProposals)
    .where(and(...conditions))
    .orderBy(desc(handbookCaptureProposals.createdAt));
};

export const getHandbookCaptureProposalById = async (workspaceId: string, id: string) => {
  const [proposal] = await db
    .select()
    .from(handbookCaptureProposals)
    .where(and(eq(handbookCaptureProposals.workspaceId, workspaceId), eq(handbookCaptureProposals.id, id)))
    .limit(1);
  return proposal ?? null;
};

export const approveHandbookCaptureProposal = async (
  workspaceId: string,
  id: string,
  reviewerUserId?: string | null,
  chunks: HandbookChunkInput[] = [],
) => {
  const proposal = await getHandbookCaptureProposalById(workspaceId, id);
  if (!proposal || proposal.status !== "pending") return null;

  const entryInput: HandbookEntryInput = {
    title: proposal.title,
    slug: proposal.slug,
    summary: proposal.summary,
    content: proposal.proposedContent,
    category: proposal.category,
    status: "verified",
    sourceType: "agent_capture",
    sourceProjectId: proposal.sourceProjectId,
    metadata: { sourceFiles: proposal.sourceFiles ?? [], rationale: proposal.rationale },
    createdByUserId: proposal.createdByUserId,
    createdByAgentJobId: proposal.createdByAgentJobId,
  };

  const proposalChunks = chunks.length > 0
    ? chunks
    : [{
        chunkIndex: 0,
        headingPath: proposal.title,
        content: proposal.proposedContent,
        tokenCount: Math.ceil(proposal.proposedContent.trim().split(/\s+/).filter(Boolean).length * 1.35),
      }];

  const created = await createHandbookEntry(workspaceId, entryInput, proposalChunks);
  if (!created) return null;

  await db
    .update(handbookCaptureProposals)
    .set({
      status: "approved",
      targetEntryId: created.id,
      reviewedByUserId: reviewerUserId ?? null,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(handbookCaptureProposals.id, id));

  return created;
};

export const rejectHandbookCaptureProposal = async (
  workspaceId: string,
  id: string,
  reviewerUserId?: string | null,
) => {
  const [updated] = await db
    .update(handbookCaptureProposals)
    .set({
      status: "rejected",
      reviewedByUserId: reviewerUserId ?? null,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(handbookCaptureProposals.workspaceId, workspaceId), eq(handbookCaptureProposals.id, id)))
    .returning();
  return updated ?? null;
};

export const ensureHandbookSourceProjectVisible = async (workspaceId: string, sourceProjectId?: string | null) => {
  if (!sourceProjectId) return true;
  const rows = await orgProjectIds(workspaceId);
  return rows.some((row) => row.id === sourceProjectId);
};

const vectorToSqlString = (embedding: number[]): string => `[${embedding.join(",")}]`;

export const searchHandbookChunksByEmbedding = async (
  workspaceId: string,
  embedding: number[],
  options?: { limit?: number; status?: HandbookEntryStatus; category?: string },
) => {
  const limit = Math.min(options?.limit ?? 8, 30);
  const vector = vectorToSqlString(embedding);
  const conditions = [
    eq(handbookEntries.workspaceId, workspaceId),
    isNull(handbookEntries.archivedAt),
    sql`${handbookChunks.embedding} IS NOT NULL`,
  ];
  if (options?.status) conditions.push(eq(handbookEntries.status, options.status));
  if (options?.category) conditions.push(eq(handbookEntries.category, options.category));

  return db
    .select({
      entryId: handbookEntries.id,
      title: handbookEntries.title,
      slug: handbookEntries.slug,
      summary: handbookEntries.summary,
      category: handbookEntries.category,
      status: handbookEntries.status,
      headingPath: handbookChunks.headingPath,
      content: handbookChunks.content,
      rank: sql<number>`1 - (${handbookChunks.embedding} <=> ${vector}::vector)`.as("rank"),
    })
    .from(handbookChunks)
    .innerJoin(handbookEntries, eq(handbookChunks.entryId, handbookEntries.id))
    .where(and(...conditions))
    .orderBy(sql`${handbookChunks.embedding} <=> ${vector}::vector`)
    .limit(limit);
};
