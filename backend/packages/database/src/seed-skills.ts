/**
 * Seed script for official Almirant platform skills.
 *
 * - Reads SKILL.md files from .claude/skills/<slug>/SKILL.md
 * - Upserts into the `skills` table with source='official', organizationId=NULL, projectId=NULL
 * - Backfills scheduled_agent_configs.skillId from skillName -> skills.slug
 * - Idempotent: safe to re-run. Updates content/hash/version on change.
 *
 * Usage:
 *   cd backend/packages/database && bun run db:seed-skills
 */

import { createHash } from "crypto";
import { readFileSync } from "fs";
import { resolve } from "path";
import postgres from "postgres";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const connectionString = process.env.DATABASE_URL!;
const sql = postgres(connectionString);

/** Repo root relative to this file: src/ -> database/ -> packages/ -> backend/ -> repo root */
const REPO_ROOT = resolve(__dirname, "../../../..");

/** Official skill slugs to seed (order does not matter). */
const OFFICIAL_SKILL_SLUGS = [
  "validate",
  "nightly-fix",
  "implement",
  "review",
  "document",
  "fix",
  "ideate",
  "create-tasks",
  "pr",
  "runner-implement",
  "runner-document",
  "auto-debug-failed",
  "feedback-triage",
  "feedback-bug-analyze",
  "feedback-bug-fix",
  "feedback-bug-triage",
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse YAML-like frontmatter from a SKILL.md file. */
function parseFrontmatter(content: string): {
  name?: string;
  description?: string;
  body: string;
} {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { body: content };

  const frontmatter = match[1];
  const body = match[2];

  const name = frontmatter.match(/^name:\s*(.+)$/m)?.[1]?.trim();
  const description = frontmatter.match(/^description:\s*(.+)$/m)?.[1]?.trim();

  return { name, description, body };
}

/** Convert a slug to a human-readable name: "nightly-fix" -> "Nightly Fix". */
function slugToName(slug: string): string {
  return slug
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** SHA-256 hex hash of a string. */
function sha256(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function seedSkills() {
  console.log("Seeding official platform skills (idempotent)...\n");

  let insertedCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  let missingCount = 0;

  for (const slug of OFFICIAL_SKILL_SLUGS) {
    const skillPath = resolve(REPO_ROOT, ".claude", "skills", slug, "SKILL.md");

    // Try to read the file; skip if it does not exist
    let rawContent: string;
    try {
      rawContent = readFileSync(skillPath, "utf-8");
    } catch {
      console.log(`  SKIP: "${slug}" — SKILL.md not found at ${skillPath}`);
      missingCount++;
      continue;
    }

    const { name: fmName, description } = parseFrontmatter(rawContent);
    const name = fmName ?? slugToName(slug);
    const contentHash = sha256(rawContent);
    const sizeBytes = Buffer.byteLength(rawContent, "utf-8");

    // Upsert using raw SQL to handle the NULL-aware unique index correctly.
    // PostgreSQL's ON CONFLICT does not match NULLs via the standard clause,
    // so we use a CTE-based conditional insert/update pattern.
    const result = await sql`
      WITH existing AS (
        SELECT id, content_hash, version
        FROM skills
        WHERE slug = ${slug}
          AND organization_id IS NULL
          AND project_id IS NULL
        LIMIT 1
      ),
      do_insert AS (
        INSERT INTO skills (
          name, slug, description, content, content_hash, size_bytes,
          source, source_path, version, organization_id, project_id
        )
        SELECT
          ${name},
          ${slug},
          ${description ?? null},
          ${rawContent},
          ${contentHash},
          ${sizeBytes},
          'official',
          ${`.claude/skills/${slug}/SKILL.md`},
          1,
          NULL,
          NULL
        WHERE NOT EXISTS (SELECT 1 FROM existing)
        RETURNING id, 'inserted' AS action
      ),
      do_update AS (
        UPDATE skills
        SET
          name = ${name},
          description = ${description ?? null},
          content = ${rawContent},
          content_hash = ${contentHash},
          size_bytes = ${sizeBytes},
          source_path = ${`.claude/skills/${slug}/SKILL.md`},
          version = existing.version + 1,
          updated_at = NOW()
        FROM existing
        WHERE skills.id = existing.id
          AND existing.content_hash != ${contentHash}
        RETURNING skills.id, 'updated' AS action
      )
      SELECT * FROM do_insert
      UNION ALL
      SELECT * FROM do_update
      UNION ALL
      SELECT existing.id, 'unchanged' AS action FROM existing
        WHERE existing.content_hash = ${contentHash}
    `;

    const action = result[0]?.action;
    const id = result[0]?.id;

    if (action === "inserted") {
      console.log(`  INSERTED: "${name}" (slug: ${slug}, id: ${id})`);
      insertedCount++;
    } else if (action === "updated") {
      console.log(`  UPDATED:  "${name}" (slug: ${slug}, id: ${id}) — content changed, version bumped`);
      updatedCount++;
    } else if (action === "unchanged") {
      console.log(`  SKIP:     "${name}" (slug: ${slug}, id: ${id}) — content unchanged`);
      skippedCount++;
    }
  }

  console.log(
    `\nSkills seed complete. Inserted: ${insertedCount}, Updated: ${updatedCount}, Unchanged: ${skippedCount}, Missing files: ${missingCount}`
  );

  // --------------------------------------------------------------------------
  // Done
  // --------------------------------------------------------------------------
  await sql.end();
  console.log("\nDone.");
  process.exit(0);
}

seedSkills().catch((error) => {
  console.error("Seed skills failed:", error);
  process.exit(1);
});
