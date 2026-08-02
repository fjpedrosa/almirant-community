import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

const migrationsDir = new URL("../../../migrations/", import.meta.url);
const migrationFiles = Array.from(
  new Bun.Glob("0226_*.sql").scanSync({ cwd: migrationsDir.pathname }),
);

describe("migration 0226 claim sequence receipts", () => {
  test("adds the receipt ledger without modifying rehearsed migration 0225", async () => {
    expect(migrationFiles).toHaveLength(1);
    const sql = await Bun.file(
      new URL(migrationFiles[0]!, migrationsDir),
    ).text();

    expect(sql).toContain('CREATE TABLE "agent_job_claim_sequence_receipts"');
    expect(sql).toContain('PRIMARY KEY("job_id","claim_attempt_id")');
    expect(sql).toContain('"job_log_sequence_end" integer NOT NULL');
    expect(sql).toContain('"session_event_inserted_count" integer DEFAULT 0 NOT NULL');
    expect(sql).toContain('"native_event_emitted_through" integer');
    expect(sql).not.toMatch(/DELETE\s+FROM\s+"?session_events"?/i);

    const migration0225 = await Bun.file(
      new URL("0225_unique_session_event_sequence.sql", migrationsDir),
    ).arrayBuffer();
    expect(createHash("sha256").update(Buffer.from(migration0225)).digest("hex")).toBe(
      "b7ef4e99991268b9258529732849a8374119946c0052abed047dfcc09a191731",
    );
  });

  test("enforces immutable claim identity and bounded receipt ranges", async () => {
    const db = new PGlite();
    await db.waitReady;
    try {
      await db.query('CREATE TABLE "agent_jobs" ("id" uuid PRIMARY KEY);');
      const sql = await Bun.file(new URL(migrationFiles[0]!, migrationsDir)).text();
      for (const statement of sql
        .split("--> statement-breakpoint")
        .map((value) => value.trim())
        .filter(Boolean)) {
        await db.query(statement);
      }
      await db.query(`
        INSERT INTO agent_jobs (id)
        VALUES ('11111111-1111-4111-8111-111111111111');
      `);
      await db.query(`
        INSERT INTO agent_job_claim_sequence_receipts (
          job_id, claim_attempt_id, worker_id,
          job_log_sequence_start, job_log_sequence_end,
          session_event_sequence_start, session_event_sequence_end,
          native_event_sequence_start, native_event_sequence_end
        ) VALUES (
          '11111111-1111-4111-8111-111111111111', 'attempt-1', 'worker-1',
          1, 4096, 1, 4096, 1, 4096
        );
      `);

      await expect(db.query(`
        INSERT INTO agent_job_claim_sequence_receipts (
          job_id, claim_attempt_id, worker_id,
          job_log_sequence_start, job_log_sequence_end,
          session_event_sequence_start, session_event_sequence_end,
          native_event_sequence_start, native_event_sequence_end
        ) VALUES (
          '11111111-1111-4111-8111-111111111111', 'attempt-1', 'worker-2',
          4097, 8192, 4097, 8192, 4097, 8192
        );
      `)).rejects.toThrow();
      await expect(db.query(`
        INSERT INTO agent_job_claim_sequence_receipts (
          job_id, claim_attempt_id, worker_id,
          job_log_sequence_start, job_log_sequence_end,
          session_event_sequence_start, session_event_sequence_end,
          native_event_sequence_start, native_event_sequence_end
        ) VALUES (
          '11111111-1111-4111-8111-111111111111', 'attempt-invalid', 'worker-1',
          0, 0, 1, 4096, 1, 4096
        );
      `)).rejects.toThrow();
    } finally {
      await db.close();
    }
  });
});
