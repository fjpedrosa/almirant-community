/**
 * Backfill content_type for legacy agent_job_logs transcript entries.
 *
 * Detects tool_use JSON patterns in the `message` field and updates:
 * - content_type: 'text' → 'tool_use'
 * - payload: extracted { toolName, toolCallId, inputPreview }
 *
 * Run: DATABASE_URL=... bun run src/scripts/backfill-content-type.ts
 */

import { db } from "../client";
import { agentJobLogs } from "../schema";
import { eq, and, sql } from "drizzle-orm";

const BATCH_SIZE = 500;

const parseToolUsePayload = (
  message: string,
): { toolName: string; toolCallId: string; inputPreview?: string } | null => {
  try {
    const parsed = JSON.parse(message);
    if (parsed.name && parsed.id) {
      return {
        toolName: parsed.name,
        toolCallId: parsed.id,
        inputPreview: parsed.input
          ? JSON.stringify(parsed.input).slice(0, 120)
          : undefined,
      };
    }
  } catch {
    // Not valid JSON — skip
  }
  return null;
};

const backfill = async () => {
  console.log("Starting content_type backfill...");

  // Count total candidates
  const [{ count: totalStr }] = await db
    .select({ count: sql<string>`count(*)` })
    .from(agentJobLogs)
    .where(
      and(
        eq(agentJobLogs.phase, "transcript"),
        eq(agentJobLogs.contentType, "text"),
        sql`message ~ '^\s*\{"name":'`,
      ),
    );
  const total = parseInt(totalStr, 10);
  console.log(`Found ${total} tool_use candidates to backfill`);

  if (total === 0) {
    console.log("Nothing to do.");
    return;
  }

  let updated = 0;
  let offset = 0;

  while (offset < total) {
    // Fetch a batch of candidates
    const rows = await db
      .select({ id: agentJobLogs.id, message: agentJobLogs.message })
      .from(agentJobLogs)
      .where(
        and(
          eq(agentJobLogs.phase, "transcript"),
          eq(agentJobLogs.contentType, "text"),
          sql`message ~ '^\s*\{"name":'`,
        ),
      )
      .limit(BATCH_SIZE);

    if (rows.length === 0) break;

    for (const row of rows) {
      const payload = parseToolUsePayload(row.message);
      if (payload) {
        await db
          .update(agentJobLogs)
          .set({
            contentType: "tool_use",
            payload: payload as Record<string, unknown>,
          })
          .where(eq(agentJobLogs.id, row.id));
        updated++;
      }
    }

    offset += rows.length;
    console.log(`  Processed ${offset}/${total} (updated ${updated})`);
  }

  console.log(`\nBackfill complete: ${updated} rows updated`);
};

backfill()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exit(1);
  });
