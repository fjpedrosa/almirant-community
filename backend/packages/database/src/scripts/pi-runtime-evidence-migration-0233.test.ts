import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const databaseRoot = resolve(import.meta.dir, "../..");
const read = (path: string): string => readFileSync(resolve(databaseRoot, path), "utf8");

const expectedSql = [
  'ALTER TABLE "agent_jobs" ADD COLUMN "runtime_evidence" jsonb;--> statement-breakpoint',
  'ALTER TABLE "agent_native_events" ADD COLUMN "ai_provider" "ai_provider";--> statement-breakpoint',
  'ALTER TABLE "agent_native_events" ADD COLUMN "model" varchar(256);--> statement-breakpoint',
  'ALTER TABLE "usage_records" ADD COLUMN "idempotency_key" varchar(255);--> statement-breakpoint',
  'ALTER TABLE "usage_records" ADD COLUMN "runtime_evidence" jsonb;--> statement-breakpoint',
  'ALTER TABLE "usage_records" ADD COLUMN "provider_cost_usd" numeric(20, 9);--> statement-breakpoint',
  'CREATE UNIQUE INDEX "usage_records_idempotency_key_unique_idx" ON "usage_records" USING btree ("idempotency_key");',
].join("\n");

const readJournalTail = (): Array<{
  idx: number;
  tag: string;
  when: number;
}> => {
  const journal = JSON.parse(read("migrations/meta/_journal.json")) as {
    entries: Array<{ idx: number; tag: string; when: number }>;
  };
  return journal.entries.slice(-2);
};

describe("Pi runtime-evidence migration 0233", () => {
  test("is the generated expand-only persistence migration", () => {
    expect(read("migrations/0233_simple_terror.sql")).toBe(expectedSql);
  });

  test("contains no row rewrite, enum replacement, destructive statement, or unrelated table", () => {
    const sql = read("migrations/0233_simple_terror.sql");
    expect(sql).not.toMatch(/\b(?:UPDATE|DELETE|DROP|TRUNCATE)\b/i);
    expect(sql).not.toMatch(/ALTER\s+TYPE|CREATE\s+TYPE|ALTER\s+COLUMN/i);
    expect(
      [...sql.matchAll(/ALTER TABLE "([^"]+)"/g)].map((match) => match[1]),
    ).toEqual([
      "agent_jobs",
      "agent_native_events",
      "agent_native_events",
      "usage_records",
      "usage_records",
      "usage_records",
    ]);
  });

  test("keeps every new column nullable and the usage key uniquely indexed", () => {
    const sql = read("migrations/0233_simple_terror.sql");
    expect(sql).not.toMatch(/ADD COLUMN[^;]+NOT NULL/i);
    expect(sql).not.toMatch(/ADD COLUMN[^;]+DEFAULT/i);
    expect(sql.match(/CREATE UNIQUE INDEX/g)).toHaveLength(1);
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "usage_records_idempotency_key_unique_idx" ON "usage_records" USING btree ("idempotency_key")',
    );
  });

  test("records 0233 after 0232 with a strictly greater generator timestamp", () => {
    const tail = readJournalTail();
    expect(tail.map(({ idx, tag }) => ({ idx, tag }))).toEqual([
      { idx: 232, tag: "0232_oval_marvex" },
      { idx: 233, tag: "0233_simple_terror" },
    ]);
    expect(tail[1]!.when).toBeGreaterThan(tail[0]!.when);
  });
});
