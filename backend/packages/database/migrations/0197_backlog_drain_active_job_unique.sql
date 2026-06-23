CREATE UNIQUE INDEX IF NOT EXISTS "agent_jobs_backlog_drain_active_work_item_unique_idx"
ON "agent_jobs" ("work_item_id")
WHERE "work_item_id" IS NOT NULL
  AND "status" IN ('queued', 'running', 'finalizing', 'waiting_for_input')
  AND "config"->>'source' = 'backlog-drain';
