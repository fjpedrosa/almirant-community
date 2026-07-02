/**
 * Seed script for auto-debug-failed scheduled agent config.
 *
 * Creates (or updates) a scheduled_agent_config that runs the
 * auto-debug-failed skill every 30 minutes via cron.
 *
 * Usage:
 *   cd backend/packages/database && bun run db:seed-auto-debug
 */

import postgres from "postgres";

const connectionString = process.env.DATABASE_URL!;
const sql = postgres(connectionString);

async function main() {
  console.log("Seeding auto-debug-failed scheduled agent config...");

  // Find the skill ID for auto-debug-failed
  const [skill] = await sql`
    SELECT id FROM skills WHERE slug = 'auto-debug-failed' LIMIT 1
  `;

  if (!skill) {
    console.error("ERROR: Skill 'auto-debug-failed' not found. Run db:seed-skills first.");
    process.exit(1);
  }

  // Find the workspace (assumes single-org setup)
  const [org] = await sql`
    SELECT id FROM workspace LIMIT 1
  `;

  if (!org) {
    console.error("ERROR: No workspace found.");
    process.exit(1);
  }

  // Upsert the scheduled agent config
  await sql`
    INSERT INTO scheduled_agent_configs (
      workspace_id,
      name,
      skill_id,
      skill_name,
      job_type,
      provider,
      description,
      coding_agent,
      ai_provider,
      ai_model,
      schedule_type,
      schedule_config,
      timezone,
      enabled,
      target_config,
      max_jobs_per_run
    ) VALUES (
      ${org.id},
      'Auto-Debug Failed Sessions',
      ${skill.id},
      'auto-debug-failed',
      'scheduled',
      'claude-code',
      'Runs every 30 minutes. Finds failed agent jobs, debugs them using error memory, and opens PRs for code fixes.',
      'claude-code',
      'anthropic',
      'claude-sonnet-4-6',
      'cron',
      ${sql.json({ expression: "*/30 * * * *" })},
      'Europe/Madrid',
      false,
      ${sql.json({})},
      1
    )
    ON CONFLICT DO NOTHING
  `;

  console.log("Done. Config created (disabled by default -- enable via UI or API).");
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
