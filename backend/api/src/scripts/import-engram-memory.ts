/**
 * One-shot script: import Engram project memory into Almirant DB.
 *
 * Defaults to a SAFE migration strategy:
 * - reusable technical memory stays active
 * - session summaries / passive / preference / feedback are imported archived
 * - target organization/project ownership is verified before any write
 * - source records are filtered by BOTH Engram project name and source directory
 * - dry-run by default; use --apply to persist
 *
 * Usage:
 *   cd backend/api
 *   bun run --env-file .env.local src/scripts/import-engram-memory.ts \
 *     --source-project almirant \
 *     --organization-id <orgId> \
 *     --project-id <projectId>
 *
 *   # Apply the import
 *   bun run --env-file .env.local src/scripts/import-engram-memory.ts \
 *     --source-project almirant \
 *     --organization-id <orgId> \
 *     --project-id <projectId> \
 *     --apply
 */

import { closeConnections } from "@almirant/database";
import { homedir } from "node:os";
import { resolve } from "node:path";
import {
  importEngramProjectMemory,
  type EngramHistoricalPolicies,
  type ImportDisposition,
} from "../lib/memory/engram-import";

const REPO_ROOT = resolve(import.meta.dir, "../../../..");

interface CliOptions {
  sourceProject: string;
  organizationId: string;
  projectId: string;
  engramDbPath: string;
  sourceDirectory?: string;
  ownerUserId?: string;
  apply: boolean;
  limit?: number;
  historicalPolicies: Partial<EngramHistoricalPolicies>;
}

const printUsage = () => {
  console.log(`
Usage:
  bun run --env-file .env.local src/scripts/import-engram-memory.ts \
    --source-project <engramProject> \
    --organization-id <orgId> \
    --project-id <projectId> \
    [--source-directory <repoPath>] \
    [--owner-user-id <userId>] \
    [--engram-db <path>] \
    [--limit <n>] \
    [--session-summaries archived|skip|active] \
    [--passive archived|skip|active] \
    [--preference archived|skip|active] \
    [--feedback archived|skip|active] \
    [--apply]

Notes:
  - Dry-run by default.
  - Default source directory: ${REPO_ROOT}
  - Default Engram DB: ${resolve(homedir(), ".engram/engram.db")}
`);
};

const parseDisposition = (
  flagName: string,
  value: string | undefined
): ImportDisposition | undefined => {
  if (!value) return undefined;
  if (value === "active" || value === "archived" || value === "skip") {
    return value;
  }
  throw new Error(
    `Invalid value for ${flagName}: ${value}. Expected active|archived|skip`
  );
};

const parseArgs = (argv: string[]): CliOptions => {
  const values = new Map<string, string>();
  const booleans = new Set<string>();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg?.startsWith("--")) continue;

    const [rawKey, rawInlineValue] = arg.slice(2).split("=", 2);
    if (!rawKey) continue;
    const key = rawKey.trim();
    if (!key) continue;

    if (rawInlineValue != null) {
      values.set(key, rawInlineValue);
      continue;
    }

    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      values.set(key, next);
      index += 1;
      continue;
    }

    booleans.add(key);
  }

  const sourceProject = values.get("source-project");
  const organizationId = values.get("organization-id");
  const projectId = values.get("project-id");

  if (!sourceProject || !organizationId || !projectId) {
    printUsage();
    throw new Error(
      "Missing required arguments: --source-project, --organization-id, and --project-id are mandatory"
    );
  }

  const limitRaw = values.get("limit");
  const limit = limitRaw ? Number(limitRaw) : undefined;
  if (limitRaw && (!Number.isInteger(limit) || Number(limit) <= 0)) {
    throw new Error(`Invalid --limit value: ${limitRaw}`);
  }

  return {
    sourceProject,
    organizationId,
    projectId,
    engramDbPath: values.get("engram-db") ?? resolve(homedir(), ".engram/engram.db"),
    sourceDirectory: values.get("source-directory") ?? REPO_ROOT,
    ownerUserId: values.get("owner-user-id") ?? undefined,
    apply: booleans.has("apply"),
    limit,
    historicalPolicies: {
      sessionSummary: parseDisposition(
        "--session-summaries",
        values.get("session-summaries")
      ),
      passive: parseDisposition("--passive", values.get("passive")),
      preference: parseDisposition("--preference", values.get("preference")),
      feedback: parseDisposition("--feedback", values.get("feedback")),
    },
  };
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));

  console.log("=== Engram → Almirant Memory Import ===\n");
  console.log(`Mode: ${options.apply ? "APPLY" : "DRY-RUN"}`);
  console.log(`Source project: ${options.sourceProject}`);
  console.log(`Source directory: ${options.sourceDirectory ?? "(not filtered)"}`);
  console.log(`Engram DB: ${options.engramDbPath}`);
  console.log(`Target org: ${options.organizationId}`);
  console.log(`Target project: ${options.projectId}`);
  if (options.ownerUserId) {
    console.log(`Owner user for personal scope: ${options.ownerUserId}`);
  }
  console.log("");

  const report = await importEngramProjectMemory(options);

  console.log("Summary:");
  console.table({
    scanned: report.scanned,
    imported: report.imported,
    importedActive: report.importedActive,
    importedArchived: report.importedArchived,
    skipped: report.skipped,
    skippedAlreadyImported: report.skippedAlreadyImported,
    skippedDuplicateContent: report.skippedDuplicateContent,
    skippedByPolicy: report.skippedByPolicy,
    failed: report.failed,
  });

  console.log("By source type:");
  console.table(report.bySourceType);

  if (report.failures.length > 0) {
    console.log("Failures:");
    for (const failure of report.failures) {
      console.log(
        `- [${failure.observationId}] ${failure.title}: ${failure.reason}`
      );
    }
  }

  console.log(
    `\nDone. ${options.apply ? "Import applied" : "Dry-run complete — no rows were written."}`
  );
};

main()
  .catch((error) => {
    console.error("Fatal error:", error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(() => closeConnections());
