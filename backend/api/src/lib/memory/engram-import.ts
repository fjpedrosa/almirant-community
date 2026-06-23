import { Database as SqliteDatabase } from "bun:sqlite";
import {
  agentObservations,
  and,
  createObservation,
  db,
  eq,
  isNull,
  or,
  projects,
  sql,
} from "@almirant/database";
import { validateTopicKeyForType } from "./ranker";

export type EngramSourceType =
  | "architecture"
  | "bugfix"
  | "config"
  | "decision"
  | "discovery"
  | "learning"
  | "pattern"
  | "feedback"
  | "passive"
  | "preference"
  | "session_summary"
  | (string & {});

export type ImportDisposition = "active" | "archived" | "skip";

export type TargetObservationType =
  | "architecture"
  | "bugfix"
  | "config"
  | "decision"
  | "discovery"
  | "learning"
  | "pattern";

export interface EngramObservationRow {
  id: number;
  sessionId: string;
  type: EngramSourceType;
  title: string;
  content: string;
  toolName: string | null;
  project: string | null;
  scope: string;
  topicKey: string | null;
  normalizedHash: string | null;
  revisionCount: number;
  duplicateCount: number;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
  sessionStartedAt: string | null;
  sessionEndedAt: string | null;
  sourceDirectory: string;
}

export interface EngramHistoricalPolicies {
  sessionSummary: ImportDisposition;
  passive: ImportDisposition;
  preference: ImportDisposition;
  feedback: ImportDisposition;
}

export interface EngramImportOptions {
  engramDbPath: string;
  sourceProject: string;
  sourceDirectory?: string;
  organizationId: string;
  projectId: string;
  ownerUserId?: string;
  apply?: boolean;
  limit?: number;
  historicalPolicies?: Partial<EngramHistoricalPolicies>;
}

export interface EngramImportReport {
  sourceProject: string;
  sourceDirectory?: string;
  organizationId: string;
  projectId: string;
  apply: boolean;
  scanned: number;
  imported: number;
  importedActive: number;
  importedArchived: number;
  skipped: number;
  skippedAlreadyImported: number;
  skippedDuplicateContent: number;
  skippedByPolicy: number;
  failed: number;
  bySourceType: Record<
    string,
    {
      scanned: number;
      plannedActive: number;
      plannedArchived: number;
      plannedSkip: number;
      imported: number;
      skipped: number;
      failed: number;
    }
  >;
  failures: Array<{ observationId: number; title: string; reason: string }>;
}

interface TypeMapping {
  targetType: TargetObservationType;
  disposition: ImportDisposition;
  confidence: number;
}

const DEFAULT_HISTORICAL_POLICIES: EngramHistoricalPolicies = {
  sessionSummary: "archived",
  passive: "archived",
  preference: "archived",
  feedback: "archived",
};

const ACTIVE_TYPE_MAPPINGS: Record<string, TypeMapping> = {
  architecture: {
    targetType: "architecture",
    disposition: "active",
    confidence: 0.75,
  },
  bugfix: { targetType: "bugfix", disposition: "active", confidence: 0.75 },
  config: { targetType: "config", disposition: "active", confidence: 0.7 },
  decision: { targetType: "decision", disposition: "active", confidence: 0.75 },
  discovery: { targetType: "discovery", disposition: "active", confidence: 0.65 },
  learning: { targetType: "learning", disposition: "active", confidence: 0.65 },
  pattern: { targetType: "pattern", disposition: "active", confidence: 0.75 },
};

const HISTORICAL_TYPE_MAPPINGS: Record<
  keyof EngramHistoricalPolicies,
  Omit<TypeMapping, "disposition">
> = {
  sessionSummary: {
    targetType: "discovery",
    confidence: 0.45,
  },
  passive: {
    targetType: "learning",
    confidence: 0.4,
  },
  preference: {
    targetType: "decision",
    confidence: 0.5,
  },
  feedback: {
    targetType: "discovery",
    confidence: 0.45,
  },
};

const slugify = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

const toIsoDate = (value: string | null | undefined): Date | null => {
  if (!value || value.trim().length === 0) return null;
  const normalized = value.includes("T")
    ? value
    : `${value.replace(" ", "T")}Z`;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const sha256Hex = async (value: string) => {
  const buffer = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const resolveHistoricalDisposition = (
  sourceType: keyof EngramHistoricalPolicies,
  policies?: Partial<EngramHistoricalPolicies>
): ImportDisposition => policies?.[sourceType] ?? DEFAULT_HISTORICAL_POLICIES[sourceType];

export const classifyEngramObservationType = (
  sourceType: EngramSourceType,
  policies?: Partial<EngramHistoricalPolicies>
): TypeMapping => {
  const active = ACTIVE_TYPE_MAPPINGS[sourceType];
  if (active) return active;

  switch (sourceType) {
    case "session_summary": {
      const disposition = resolveHistoricalDisposition("sessionSummary", policies);
      return { ...HISTORICAL_TYPE_MAPPINGS.sessionSummary, disposition };
    }
    case "passive": {
      const disposition = resolveHistoricalDisposition("passive", policies);
      return { ...HISTORICAL_TYPE_MAPPINGS.passive, disposition };
    }
    case "preference": {
      const disposition = resolveHistoricalDisposition("preference", policies);
      return { ...HISTORICAL_TYPE_MAPPINGS.preference, disposition };
    }
    case "feedback": {
      const disposition = resolveHistoricalDisposition("feedback", policies);
      return { ...HISTORICAL_TYPE_MAPPINGS.feedback, disposition };
    }
    default:
      return {
        targetType: "discovery",
        disposition: "skip",
        confidence: 0.4,
      };
  }
};

export const resolveVisibilityFromScope = (
  sourceScope: string,
  ownerUserId?: string
): { visibility: "project" | "personal" | "org"; ownerUserId: string | null } | null => {
  switch (sourceScope) {
    case "project":
      return { visibility: "project", ownerUserId: null };
    case "personal":
      return ownerUserId
        ? { visibility: "personal", ownerUserId }
        : null;
    case "global":
    case "org":
      return { visibility: "org", ownerUserId: null };
    default:
      return null;
  }
};

export const buildImportTopicKey = (
  targetType: TargetObservationType,
  observation: Pick<EngramObservationRow, "id" | "type" | "title" | "topicKey">
): string => {
  const candidate = observation.topicKey?.trim();
  if (candidate) {
    try {
      return validateTopicKeyForType(targetType, candidate);
    } catch {
      // Fall through to generated key.
    }
  }

  const sourceTypeSlug = slugify(String(observation.type)) || "engram";
  const titleSlug = slugify(observation.title).slice(0, 48) || "observation";
  return validateTopicKeyForType(
    targetType,
    `engram/${sourceTypeSlug}-${observation.id}-${titleSlug}`
  );
};

const buildImportMetadata = (observation: EngramObservationRow) => ({
  sourceSystem: "engram",
  engramImport: {
    sourceObservationId: String(observation.id),
    sourceSessionId: observation.sessionId,
    sourceType: observation.type,
    sourceScope: observation.scope,
    sourceProject: observation.project,
    sourceDirectory: observation.sourceDirectory,
    sourceTopicKey: observation.topicKey,
    sourceToolName: observation.toolName,
    sourceNormalizedHash: observation.normalizedHash,
    sourceRevisionCount: observation.revisionCount,
    sourceDuplicateCount: observation.duplicateCount,
    sourceLastSeenAt: observation.lastSeenAt,
    sourceCreatedAt: observation.createdAt,
    sourceUpdatedAt: observation.updatedAt,
    sessionStartedAt: observation.sessionStartedAt,
    sessionEndedAt: observation.sessionEndedAt,
    importedAt: new Date().toISOString(),
  },
});

const getExistingImportedObservationRefs = async (
  organizationId: string,
  sourceProject: string,
  sourceDirectory?: string,
  filters?: {
    includeProjectVisibility?: boolean;
    includePersonalVisibility?: boolean;
    includeOrgVisibility?: boolean;
    projectId?: string;
    ownerUserId?: string;
  }
) => {
  const visibilityFilters = [];
  if (filters?.includeProjectVisibility && filters.projectId) {
    visibilityFilters.push(
      and(
        eq(agentObservations.visibility, "project"),
        eq(agentObservations.projectId, filters.projectId)
      )
    );
  }
  if (filters?.includePersonalVisibility && filters.ownerUserId) {
    visibilityFilters.push(
      and(
        eq(agentObservations.visibility, "personal"),
        eq(agentObservations.ownerUserId, filters.ownerUserId)
      )
    );
  }
  if (filters?.includeOrgVisibility) {
    visibilityFilters.push(eq(agentObservations.visibility, "org"));
  }

  const rows = await db
    .select({
      id: agentObservations.id,
      sourceObservationId: sql<string>`(${agentObservations.metadata}->'engramImport'->>'sourceObservationId')`,
    })
    .from(agentObservations)
    .where(
      and(
        eq(agentObservations.organizationId, organizationId),
        sql`${agentObservations.metadata}->>'sourceSystem' = 'engram'`,
        sql`${agentObservations.metadata}->'engramImport'->>'sourceProject' = ${sourceProject}`,
        visibilityFilters.length > 0 ? or(...visibilityFilters) : undefined,
        sourceDirectory
          ? sql`${agentObservations.metadata}->'engramImport'->>'sourceDirectory' = ${sourceDirectory}`
          : undefined
      )
    );

  return new Map(rows.map((row) => [row.sourceObservationId, row.id]));
};

const buildScopedContentKey = ({
  visibility,
  projectId,
  ownerUserId,
  contentHash,
}: {
  visibility: "project" | "personal" | "org";
  projectId?: string | null;
  ownerUserId?: string | null;
  contentHash: string;
}) =>
  [
    visibility,
    visibility === "project" ? projectId ?? "" : "",
    visibility === "personal" ? ownerUserId ?? "" : "",
    contentHash,
  ].join("::");

const getExistingActiveContentKeys = async ({
  organizationId,
  projectId,
  ownerUserId,
  includeProjectVisibility,
  includePersonalVisibility,
  includeOrgVisibility,
}: {
  organizationId: string;
  projectId: string;
  ownerUserId?: string;
  includeProjectVisibility: boolean;
  includePersonalVisibility: boolean;
  includeOrgVisibility: boolean;
}) => {
  const visibilityFilters = [];
  if (includeProjectVisibility) {
    visibilityFilters.push(
      and(
        eq(agentObservations.visibility, "project"),
        eq(agentObservations.projectId, projectId)
      )
    );
  }
  if (includePersonalVisibility && ownerUserId) {
    visibilityFilters.push(
      and(
        eq(agentObservations.visibility, "personal"),
        eq(agentObservations.ownerUserId, ownerUserId)
      )
    );
  }
  if (includeOrgVisibility) {
    visibilityFilters.push(eq(agentObservations.visibility, "org"));
  }

  const rows = await db
    .select({
      visibility: agentObservations.visibility,
      projectId: agentObservations.projectId,
      ownerUserId: agentObservations.ownerUserId,
      contentHash: agentObservations.contentHash,
    })
    .from(agentObservations)
    .where(
      and(
        eq(agentObservations.organizationId, organizationId),
        isNull(agentObservations.archivedAt),
        sql`(${agentObservations.expiresAt} IS NULL OR ${agentObservations.expiresAt} > now())`,
        visibilityFilters.length > 0 ? or(...visibilityFilters) : undefined
      )
    );

  return new Set(
    rows.map((row) =>
      buildScopedContentKey({
        visibility: row.visibility,
        projectId: row.projectId,
        ownerUserId: row.ownerUserId,
        contentHash: row.contentHash,
      })
    )
  );
};

const loadEngramObservations = (options: EngramImportOptions) => {
  const sqlite = new SqliteDatabase(options.engramDbPath, { readonly: true });
  try {
    const limitClause = options.limit ? `LIMIT ${Number(options.limit)}` : "";
    const rows = sqlite
      .query(
        `
          SELECT
            o.id,
            o.session_id AS sessionId,
            o.type,
            o.title,
            o.content,
            o.tool_name AS toolName,
            o.project,
            o.scope,
            o.topic_key AS topicKey,
            o.normalized_hash AS normalizedHash,
            o.revision_count AS revisionCount,
            o.duplicate_count AS duplicateCount,
            o.last_seen_at AS lastSeenAt,
            o.created_at AS createdAt,
            o.updated_at AS updatedAt,
            s.started_at AS sessionStartedAt,
            s.ended_at AS sessionEndedAt,
            s.directory AS sourceDirectory
          FROM observations o
          INNER JOIN sessions s ON s.id = o.session_id
          WHERE o.deleted_at IS NULL
            AND o.project = ?
            AND (? IS NULL OR s.directory = ?)
          ORDER BY o.created_at ASC
          ${limitClause}
        `
      )
      .all(
        options.sourceProject,
        options.sourceDirectory ?? null,
        options.sourceDirectory ?? null
      ) as EngramObservationRow[];

    return rows;
  } finally {
    sqlite.close(false);
  }
};

const assertTargetProjectOwnership = async (
  organizationId: string,
  projectId: string
) => {
  const [project] = await db
    .select({ id: projects.id, name: projects.name, organizationId: projects.organizationId })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId)))
    .limit(1);

  if (!project) {
    throw new Error(
      `Project ${projectId} does not exist or does not belong to organization ${organizationId}`
    );
  }

  return project;
};

export const importEngramProjectMemory = async (
  options: EngramImportOptions
): Promise<EngramImportReport> => {
  await assertTargetProjectOwnership(options.organizationId, options.projectId);

  const rows = loadEngramObservations(options);
  const scopes = new Set(rows.map((row) => row.scope));

  const existingImportedRefs = await getExistingImportedObservationRefs(
    options.organizationId,
    options.sourceProject,
    options.sourceDirectory,
    {
      includeProjectVisibility: scopes.has("project"),
      includePersonalVisibility: scopes.has("personal"),
      includeOrgVisibility: scopes.has("org") || scopes.has("global"),
      projectId: options.projectId,
      ownerUserId: options.ownerUserId,
    }
  );
  const existingActiveContentKeys = await getExistingActiveContentKeys(
    {
      organizationId: options.organizationId,
      projectId: options.projectId,
      ownerUserId: options.ownerUserId,
      includeProjectVisibility: scopes.has("project"),
      includePersonalVisibility: scopes.has("personal"),
      includeOrgVisibility: scopes.has("org") || scopes.has("global"),
    }
  );

  const report: EngramImportReport = {
    sourceProject: options.sourceProject,
    sourceDirectory: options.sourceDirectory,
    organizationId: options.organizationId,
    projectId: options.projectId,
    apply: options.apply === true,
    scanned: 0,
    imported: 0,
    importedActive: 0,
    importedArchived: 0,
    skipped: 0,
    skippedAlreadyImported: 0,
    skippedDuplicateContent: 0,
    skippedByPolicy: 0,
    failed: 0,
    bySourceType: {},
    failures: [],
  };

  for (const row of rows) {
    report.scanned += 1;
    const sourceBucket = (report.bySourceType[row.type] ??= {
      scanned: 0,
      plannedActive: 0,
      plannedArchived: 0,
      plannedSkip: 0,
      imported: 0,
      skipped: 0,
      failed: 0,
    });
    sourceBucket.scanned += 1;

    try {
      const mapping = classifyEngramObservationType(
        row.type,
        options.historicalPolicies
      );
      const visibility = resolveVisibilityFromScope(
        row.scope,
        options.ownerUserId
      );

      if (!visibility) {
        sourceBucket.plannedSkip += 1;
        sourceBucket.skipped += 1;
        report.skipped += 1;
        report.skippedByPolicy += 1;
        continue;
      }

      if (mapping.disposition === "skip") {
        sourceBucket.plannedSkip += 1;
        sourceBucket.skipped += 1;
        report.skipped += 1;
        report.skippedByPolicy += 1;
        continue;
      }

      if (mapping.disposition === "active") {
        sourceBucket.plannedActive += 1;
      } else {
        sourceBucket.plannedArchived += 1;
      }

      const existingImportId = existingImportedRefs.get(String(row.id));
      if (existingImportId) {
        sourceBucket.skipped += 1;
        report.skipped += 1;
        report.skippedAlreadyImported += 1;
        continue;
      }

      const topicKey = buildImportTopicKey(mapping.targetType, row);
      const createdAt = toIsoDate(row.createdAt) ?? new Date();
      const updatedAt = toIsoDate(row.updatedAt) ?? createdAt;
      const archivedAt =
        mapping.disposition === "archived" ? new Date() : null;
      const contentHash = await sha256Hex(row.title + row.content);
      const scopedContentKey = buildScopedContentKey({
        visibility: visibility.visibility,
        projectId:
          visibility.visibility === "project" ? options.projectId : null,
        ownerUserId: visibility.ownerUserId,
        contentHash,
      });

      if (existingActiveContentKeys.has(scopedContentKey)) {
        sourceBucket.skipped += 1;
        report.skipped += 1;
        report.skippedDuplicateContent += 1;
        continue;
      }

      if (!options.apply) {
        existingActiveContentKeys.add(scopedContentKey);
        if (mapping.disposition === "active") report.importedActive += 1;
        else report.importedArchived += 1;
        report.imported += 1;
        sourceBucket.imported += 1;
        continue;
      }

      const observation = await createObservation(
        {
          organizationId: options.organizationId,
          projectId:
            visibility.visibility === "project" ? options.projectId : null,
          ownerUserId: visibility.ownerUserId,
          visibility: visibility.visibility,
          createdByKind: "agent",
          type: mapping.targetType,
          topicKey,
          title: row.title,
          content: row.content,
          scope: row.scope,
          confidence: mapping.confidence.toFixed(2),
          contentHash,
          metadata: buildImportMetadata(row),
          createdAt,
          updatedAt,
          archivedAt,
        },
        { onDuplicate: "skip" }
      );

      const importedFromEngram =
        observation?.metadata &&
        typeof observation.metadata === "object" &&
        (observation.metadata as Record<string, unknown>).sourceSystem ===
          "engram";

      if (importedFromEngram) {
        existingImportedRefs.set(String(row.id), observation.id);
        existingActiveContentKeys.add(scopedContentKey);
        report.imported += 1;
        sourceBucket.imported += 1;
        if (mapping.disposition === "active") report.importedActive += 1;
        else report.importedArchived += 1;
      } else {
        report.skipped += 1;
        report.skippedDuplicateContent += 1;
        sourceBucket.skipped += 1;
      }
    } catch (error) {
      report.failed += 1;
      sourceBucket.failed += 1;
      report.failures.push({
        observationId: row.id,
        title: row.title,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return report;
};
