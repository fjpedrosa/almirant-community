import { createHash } from "crypto";
import { db } from "../../client";
import { skills } from "../../schema";
import { eq, and, or, ilike, desc, sql, isNull } from "drizzle-orm";
import type { PaginationParams } from "../../domain/types";
import type { SkillDb, NewSkill } from "../../schema/skills";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const computeContentHash = (content: string): string =>
  createHash("sha256").update(content.trim()).digest("hex");

/**
 * Builds the dual-scope WHERE condition:
 *  - Official skills (organizationId IS NULL)
 *  - Workspace skills (organizationId = orgId AND projectId IS NULL)
 *  - Project-specific skills (organizationId = orgId AND projectId = projectId)
 *
 * When no projectId is provided, only official + workspace skills are returned.
 */
const buildScopeCondition = (orgId: string, projectId?: string) => {
  const officialScope = isNull(skills.organizationId);
  const workspaceScope = and(
    eq(skills.organizationId, orgId),
    isNull(skills.projectId),
  );

  if (projectId) {
    const projectScope = and(
      eq(skills.organizationId, orgId),
      eq(skills.projectId, projectId),
    );
    return or(officialScope, workspaceScope, projectScope);
  }

  return or(officialScope, workspaceScope);
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SkillFilters = {
  projectId?: string;
  source?: "official" | "custom" | "repo";
  search?: string;
  archived?: boolean;
};

export type CreateSkillData = {
  name: string;
  slug: string;
  description?: string | null;
  content: string;
  source?: "official" | "custom" | "repo";
  sourcePath?: string | null;
  projectId?: string | null;
  createdByUserId?: string | null;
};

export type UpdateSkillData = {
  name?: string;
  slug?: string;
  description?: string | null;
  content?: string;
  source?: "official" | "custom" | "repo";
  sourcePath?: string | null;
  projectId?: string | null;
};

// ---------------------------------------------------------------------------
// 1. getSkills — list with pagination, dual-scope, filters
// ---------------------------------------------------------------------------

export const getSkills = async (
  orgId: string,
  pagination: PaginationParams,
  filters?: SkillFilters,
): Promise<{ items: SkillDb[]; total: number }> => {
  const conditions = [];

  // Dual-scope: official + workspace + (optionally) project
  conditions.push(buildScopeCondition(orgId, filters?.projectId)!);

  // Source filter
  if (filters?.source) {
    conditions.push(eq(skills.source, filters.source));
  }

  // Search filter (name or description)
  if (filters?.search) {
    conditions.push(
      or(
        ilike(skills.name, `%${filters.search}%`),
        ilike(skills.description, `%${filters.search}%`),
      ),
    );
  }

  // Archive filter — exclude archived by default
  if (filters?.archived) {
    // Show only archived
    conditions.push(sql`${skills.archivedAt} IS NOT NULL`);
  } else {
    conditions.push(isNull(skills.archivedAt));
  }

  const whereClause = and(...conditions);

  const [itemsResult, countResult] = await Promise.all([
    db
      .select()
      .from(skills)
      .where(whereClause)
      .orderBy(desc(skills.updatedAt))
      .limit(pagination.limit)
      .offset(pagination.offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(skills)
      .where(whereClause),
  ]);

  return {
    items: itemsResult,
    total: countResult[0]?.count ?? 0,
  };
};

// ---------------------------------------------------------------------------
// 2. getSkillById — detail with access validation
// ---------------------------------------------------------------------------

export const getSkillById = async (
  orgId: string,
  id: string,
): Promise<SkillDb | null> => {
  const [row] = await db
    .select()
    .from(skills)
    .where(
      and(
        eq(skills.id, id),
        or(
          isNull(skills.organizationId), // official
          eq(skills.organizationId, orgId), // belongs to org
        ),
      ),
    )
    .limit(1);

  return row ?? null;
};

// ---------------------------------------------------------------------------
// 3. getSkillBySlug — lookup by slug for runner resolution
// ---------------------------------------------------------------------------

export const getSkillBySlug = async (
  orgId: string,
  slug: string,
  projectId?: string,
): Promise<SkillDb | null> => {
  const [row] = await db
    .select()
    .from(skills)
    .where(
      and(
        eq(skills.slug, slug),
        isNull(skills.archivedAt),
        buildScopeCondition(orgId, projectId),
      ),
    )
    // Prefer the most specific match: project > workspace > official
    .orderBy(
      sql`CASE
        WHEN ${skills.organizationId} IS NOT NULL AND ${skills.projectId} IS NOT NULL THEN 0
        WHEN ${skills.organizationId} IS NOT NULL AND ${skills.projectId} IS NULL THEN 1
        ELSE 2
      END`,
    )
    .limit(1);

  return row ?? null;
};

// ---------------------------------------------------------------------------
// 4. createSkill — create with contentHash and sizeBytes
// ---------------------------------------------------------------------------

export const createSkill = async (
  orgId: string,
  data: CreateSkillData,
): Promise<SkillDb> => {
  const contentHash = computeContentHash(data.content);
  const sizeBytes = Buffer.byteLength(data.content, "utf8");

  const values: NewSkill = {
    organizationId: orgId,
    projectId: data.projectId ?? null,
    name: data.name,
    slug: data.slug,
    description: data.description ?? null,
    content: data.content,
    contentHash,
    sizeBytes,
    source: data.source ?? "custom",
    sourcePath: data.sourcePath ?? null,
    createdByUserId: data.createdByUserId ?? null,
  };

  const [created] = await db.insert(skills).values(values).returning();

  if (!created) throw new Error("Failed to create skill");
  return created;
};

// ---------------------------------------------------------------------------
// 5. updateSkill — update, recalculate hash if content changed, bump version
// ---------------------------------------------------------------------------

export const updateSkill = async (
  orgId: string,
  id: string,
  data: UpdateSkillData,
): Promise<SkillDb | null> => {
  // Verify ownership first (must belong to org, cannot edit official skills)
  const existing = await getSkillById(orgId, id);
  if (!existing || existing.organizationId !== orgId) return null;

  const updateData: Record<string, unknown> = {
    updatedAt: new Date(),
  };

  if (data.name !== undefined) updateData.name = data.name;
  if (data.slug !== undefined) updateData.slug = data.slug;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.source !== undefined) updateData.source = data.source;
  if (data.sourcePath !== undefined) updateData.sourcePath = data.sourcePath;
  if (data.projectId !== undefined) updateData.projectId = data.projectId;

  if (data.content !== undefined) {
    updateData.content = data.content;
    updateData.contentHash = computeContentHash(data.content);
    updateData.sizeBytes = Buffer.byteLength(data.content, "utf8");
  }

  // Always bump version on update
  updateData.version = sql`${skills.version} + 1`;

  const [updated] = await db
    .update(skills)
    .set(updateData)
    .where(and(eq(skills.id, id), eq(skills.organizationId, orgId)))
    .returning();

  return updated ?? null;
};

// ---------------------------------------------------------------------------
// 6. deleteSkill — soft delete (set archivedAt)
// ---------------------------------------------------------------------------

export const deleteSkill = async (
  orgId: string,
  id: string,
): Promise<SkillDb | null> => {
  const [archived] = await db
    .update(skills)
    .set({
      archivedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(skills.id, id), eq(skills.organizationId, orgId)))
    .returning();

  return archived ?? null;
};

// ---------------------------------------------------------------------------
// 7. findSkillByContentHash — dedup for auto-import
// ---------------------------------------------------------------------------

export const findSkillByContentHash = async (
  orgId: string,
  hash: string,
): Promise<SkillDb | null> => {
  const [row] = await db
    .select()
    .from(skills)
    .where(
      and(
        eq(skills.contentHash, hash),
        isNull(skills.archivedAt),
        or(
          isNull(skills.organizationId), // official
          eq(skills.organizationId, orgId), // belongs to org
        ),
      ),
    )
    .limit(1);

  return row ?? null;
};

// ---------------------------------------------------------------------------
// 8. importSkillsFromRepo — batch upsert for auto-import from repo scanning
// ---------------------------------------------------------------------------

export type ImportSkillInput = {
  name: string;
  slug: string;
  content: string;
  contentHash: string;
  sizeBytes: number;
  sourcePath: string;
};

export type ImportSkillsResult = {
  created: number;
  updated: number;
  skipped: number;
};

/**
 * Imports skills scanned from a repository. For each skill:
 * - If a skill with the same slug+org+project exists and has the same contentHash -> skip
 * - If a skill with the same slug+org+project exists but different contentHash -> update
 * - If no matching skill exists -> create with source "repo"
 *
 * Uses the unique index on (slug, organizationId, projectId) for matching.
 */
export const importSkillsFromRepo = async (
  orgId: string,
  projectId: string,
  incoming: ImportSkillInput[],
): Promise<ImportSkillsResult> => {
  const result: ImportSkillsResult = { created: 0, updated: 0, skipped: 0 };

  for (const skill of incoming) {
    // Look up existing skill by slug + org + project scope
    const [existing] = await db
      .select()
      .from(skills)
      .where(
        and(
          eq(skills.slug, skill.slug),
          eq(skills.organizationId, orgId),
          eq(skills.projectId, projectId),
          isNull(skills.archivedAt),
        ),
      )
      .limit(1);

    if (existing) {
      if (existing.contentHash === skill.contentHash) {
        // Same content — nothing to do
        result.skipped++;
        continue;
      }

      // Content changed — update
      await db
        .update(skills)
        .set({
          name: skill.name,
          content: skill.content,
          contentHash: skill.contentHash,
          sizeBytes: skill.sizeBytes,
          sourcePath: skill.sourcePath,
          source: "repo",
          version: sql`${skills.version} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(skills.id, existing.id));

      result.updated++;
    } else {
      // New skill — create
      await db.insert(skills).values({
        organizationId: orgId,
        projectId,
        name: skill.name,
        slug: skill.slug,
        content: skill.content,
        contentHash: skill.contentHash,
        sizeBytes: skill.sizeBytes,
        source: "repo",
        sourcePath: skill.sourcePath,
      });

      result.created++;
    }
  }

  return result;
};

// ---------------------------------------------------------------------------
// 9. getSkillsForSelector — lightweight query for dropdowns
// ---------------------------------------------------------------------------

export const getSkillsForSelector = async (
  orgId: string,
  projectId?: string,
): Promise<
  Array<{
    id: string;
    name: string;
    slug: string;
    source: string;
    description: string | null;
  }>
> => {
  return db
    .select({
      id: skills.id,
      name: skills.name,
      slug: skills.slug,
      source: skills.source,
      description: skills.description,
    })
    .from(skills)
    .where(
      and(
        isNull(skills.archivedAt),
        buildScopeCondition(orgId, projectId),
      ),
    )
    .orderBy(skills.name);
};
