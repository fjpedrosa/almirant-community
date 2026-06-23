/**
 * One-shot migration: parse docs/debugging/error-log.md and insert each
 * error entry into the `agent_observations` table with type "error_diagnosis".
 *
 * Idempotent — re-running updates existing entries via contentHash upsert.
 *
 * Usage:
 *   cd backend/packages/database
 *   bun run db:migrate-error-log -- <organizationId> [projectId]
 *
 * Or directly:
 *   bun run --env-file .env.local src/scripts/migrate-error-log.ts <organizationId> [projectId]
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { createHash } from "crypto";
import { closeConnections } from "../client";
import { createObservation } from "../repositories/agents/agent-observation-repository";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ErrorDiagnosisMetadata {
  area: string;
  symptom: string;
  rootCause: string;
  secondaryCauses: string[];
  fix: string;
  fixSteps: string[];
  pendingFix: string | null;
  diagnosticKeys: string[];
  affectedFiles: string[];
  learnings: string[];
  month: string | null;
}

interface ParsedEntry {
  area: string;
  title: string;
  topicKey: string;
  content: string;
  scope: string;
  contentHash: string;
  metadata: ErrorDiagnosisMetadata;
}

// ---------------------------------------------------------------------------
// Area mapping
// ---------------------------------------------------------------------------

const AREA_MAP: Record<string, string> = {
  runner: "runner",
  "claude shim": "shim",
  "claude code shim": "shim",
  frontend: "frontend",
  "frontend/runner": "frontend",
  backend: "backend",
  auth: "backend",
  scaler: "scaler",
  ws: "websocket",
  preview: "backend",
};

const normalizeArea = (tag: string): string => {
  const lower = tag.toLowerCase().trim();
  return AREA_MAP[lower] ?? lower;
};

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

const slugify = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 200);

const sha256 = (text: string): string =>
  createHash("sha256").update(text, "utf8").digest("hex");

/**
 * Extract the value after a bold prefix like `- **Sintoma**: ...`
 * Handles multi-line values that continue as indented text or numbered items.
 */
const extractField = (
  lines: string[],
  startIdx: number
): { value: string; endIdx: number } => {
  // Get the text after the `**: ` marker on the first line
  const firstLine = lines[startIdx];
  const markerMatch = firstLine.match(/\*\*:\s*(.*)/);
  if (!markerMatch) return { value: "", endIdx: startIdx };

  const parts = [markerMatch[1].trim()];
  let idx = startIdx + 1;

  // Collect continuation lines: indented text that doesn't start a new field
  while (idx < lines.length) {
    const line = lines[idx];
    // Stop at new field, new entry header, section divider, or empty line followed by non-continuation
    if (/^\s*-\s+\*\*/.test(line)) break;
    if (/^###\s/.test(line)) break;
    if (/^---/.test(line)) break;
    if (line.trim() === "") break;

    // Continuation line (indented or numbered sub-items)
    parts.push(line.trim());
    idx++;
  }

  return { value: parts.join(" "), endIdx: idx - 1 };
};

/**
 * Extract list items under a field like **Aprendizajes**:
 *   - Item 1
 *   - Item 2
 */
const extractListField = (
  lines: string[],
  startIdx: number
): { items: string[]; endIdx: number } => {
  const items: string[] = [];
  let idx = startIdx + 1; // skip the header line

  while (idx < lines.length) {
    const line = lines[idx];
    if (/^\s*-\s+\*\*/.test(line) && !/^\s+-\s+[^*]/.test(line)) break;
    if (/^###\s/.test(line)) break;
    if (/^---/.test(line)) break;
    if (line.trim() === "") {
      idx++;
      continue;
    }

    const listMatch = line.match(/^\s+-\s+(.*)/);
    if (listMatch) {
      items.push(listMatch[1].trim());
    } else {
      // Not a list item — stop
      break;
    }
    idx++;
  }

  return { items, endIdx: idx - 1 };
};

/**
 * Extract backtick-delimited file paths from a line.
 */
const extractFiles = (text: string): string[] => {
  const matches = text.match(/`([^`]+)`/g);
  if (!matches) return [];
  return matches.map((m) => m.replace(/`/g, "").trim());
};

/**
 * Extract numbered steps from a fix description like:
 *   (1) Do X, (2) Do Y, (3) Do Z
 * or:
 *   1. Do X 2. Do Y
 */
const extractFixSteps = (text: string): string[] => {
  // Try (N) pattern
  const parenSteps = text.match(/\(\d+\)\s*[^(]+/g);
  if (parenSteps && parenSteps.length > 1) {
    return parenSteps.map((s) => s.replace(/^\(\d+\)\s*/, "").trim());
  }
  // Try N. pattern (but only if there are multiple)
  const dotSteps = text.match(/\d+\.\s+[^0-9]+/g);
  if (dotSteps && dotSteps.length > 1) {
    return dotSteps.map((s) => s.replace(/^\d+\.\s+/, "").trim());
  }
  return [];
};

/**
 * Extract month from title suffix like "(Mar 2026)" or "(Abr 2026)"
 */
const extractMonth = (title: string): string | null => {
  const match = title.match(/\(([A-Za-z]+\s+\d{4})\)\s*$/);
  return match ? match[1] : null;
};

// ---------------------------------------------------------------------------
// Entry parser
// ---------------------------------------------------------------------------

const parseEntry = (block: string): ParsedEntry | null => {
  const lines = block.split("\n");

  // First line should be the header: [Tag] Title (Month Year)
  const headerLine = lines[0]?.trim();
  if (!headerLine) return null;

  const headerMatch = headerLine.match(/^\[([^\]]+)\]\s+(.+)$/);
  if (!headerMatch) return null;

  const rawTag = headerMatch[1];
  const fullTitle = headerMatch[2].trim();
  const area = normalizeArea(rawTag);
  const month = extractMonth(fullTitle);

  // Parse fields by iterating lines
  let symptom = "";
  let rootCause = "";
  const secondaryCauses: string[] = [];
  let fix = "";
  let pendingFix: string | null = null;
  const diagnosticKeys: string[] = [];
  let affectedFilesRaw = "";
  let learnings: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const lower = line.toLowerCase().trim();

    if (lower.startsWith("- **sintoma**:")) {
      const result = extractField(lines, i);
      symptom = result.value;
      i = result.endIdx;
    } else if (
      lower.startsWith("- **causa raiz**:") ||
      lower.startsWith("- **root cause**:")
    ) {
      const result = extractField(lines, i);
      rootCause = result.value;
      i = result.endIdx;
    } else if (
      lower.startsWith("- **causa secundaria**:") ||
      lower.startsWith("- **causa terciaria**:")
    ) {
      const result = extractField(lines, i);
      secondaryCauses.push(result.value);
      i = result.endIdx;
    } else if (
      lower.startsWith("- **fix**:") ||
      lower.startsWith("- **fix aplicado**:")
    ) {
      const result = extractField(lines, i);
      fix = result.value;
      i = result.endIdx;
    } else if (lower.startsWith("- **fix pendiente**:")) {
      const result = extractField(lines, i);
      pendingFix = result.value;
      i = result.endIdx;
    } else if (lower.startsWith("- **diagnostico clave**:")) {
      const result = extractField(lines, i);
      diagnosticKeys.push(result.value);
      i = result.endIdx;
    } else if (lower.startsWith("- **archivos afectados**:")) {
      const result = extractField(lines, i);
      affectedFilesRaw = result.value;
      i = result.endIdx;
    } else if (lower.startsWith("- **aprendizajes**:")) {
      const result = extractListField(lines, i);
      learnings = result.items;
      i = result.endIdx;
    }
  }

  const affectedFiles = extractFiles(affectedFilesRaw);
  const fixSteps = extractFixSteps(fix);
  const topicKey = `${area}--${slugify(fullTitle)}`;

  // Build content string for full-text search (concatenate all text fields)
  const contentParts = [
    `Area: ${area}`,
    `Symptom: ${symptom}`,
    `Root cause: ${rootCause}`,
    ...secondaryCauses.map((c, i) => `Secondary cause ${i + 1}: ${c}`),
    `Fix: ${fix}`,
    ...(pendingFix ? [`Pending fix: ${pendingFix}`] : []),
    ...diagnosticKeys.map((d) => `Diagnostic key: ${d}`),
    `Affected files: ${affectedFiles.join(", ")}`,
    ...learnings.map((l) => `Learning: ${l}`),
  ];
  const content = contentParts.filter(Boolean).join("\n");
  const contentHash = sha256(fullTitle + content);

  return {
    area,
    title: fullTitle,
    topicKey,
    content,
    scope: `area:${area}`,
    contentHash,
    metadata: {
      area,
      symptom,
      rootCause,
      secondaryCauses,
      fix,
      fixSteps,
      pendingFix,
      diagnosticKeys,
      affectedFiles,
      learnings,
      month,
    },
  };
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const main = async () => {
  const organizationId = process.argv[2];
  const projectId = process.argv[3] || null;

  if (!organizationId) {
    console.error(
      "Usage: bun run src/scripts/migrate-error-log.ts <organizationId> [projectId]"
    );
    process.exit(1);
  }

  console.log("=== Migrate Error Log to agent_observations ===\n");
  console.log(`Organization: ${organizationId}`);
  console.log(`Project:      ${projectId ?? "(none)"}`);
  console.log();

  // Resolve error-log.md from repo root (4 levels up from this script)
  const errorLogPath = resolve(
    __dirname,
    "../../../../..",
    "docs/debugging/error-log.md"
  );

  let raw: string;
  try {
    raw = readFileSync(errorLogPath, "utf-8");
  } catch (err) {
    console.error(`Failed to read error-log.md at: ${errorLogPath}`);
    console.error(err);
    await closeConnections();
    process.exit(1);
  }

  // Split by ### headers (each entry starts with ###)
  const blocks = raw.split(/^###\s+/m).filter((b) => b.trim().length > 0);

  // Skip the first block if it's the document header (starts with #, not [Tag])
  const entryBlocks = blocks.filter((b) => /^\[/.test(b.trim()));

  console.log(`Found ${entryBlocks.length} entries in error-log.md\n`);

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const block of entryBlocks) {
    const entry = parseEntry(block);
    if (!entry) {
      skipped++;
      continue;
    }

    try {
      const result = await createObservation({
        organizationId,
        projectId,
        type: "error_diagnosis",
        topicKey: entry.topicKey,
        title: entry.title,
        content: entry.content,
        scope: entry.scope,
        contentHash: entry.contentHash,
        metadata: entry.metadata as unknown as Record<string, unknown>,
      });

      if (result.revision === 1) {
        created++;
        console.log(`  [NEW] ${entry.title}`);
      } else {
        updated++;
        console.log(`  [UPD] ${entry.title} (rev ${result.revision})`);
      }
    } catch (err) {
      skipped++;
      console.error(`  [ERR] ${entry.title}:`, err);
    }
  }

  console.log(
    `\nMigrated ${created + updated} entries: ${created} new, ${updated} updated, ${skipped} skipped`
  );

  await closeConnections();
  process.exit(0);
};

main().catch(async (err) => {
  console.error("\nMigration failed:", err);
  await closeConnections();
  process.exit(1);
});
