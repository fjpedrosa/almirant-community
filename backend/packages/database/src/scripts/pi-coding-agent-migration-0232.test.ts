import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const databaseRoot = resolve(import.meta.dir, "../..");
const read = (path: string): string => readFileSync(resolve(databaseRoot, path), "utf8");

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

describe("Pi coding-agent migration 0232", () => {
  test("is expand-only and adds the immutable runtime selection column", () => {
    expect(read("migrations/0232_oval_marvex.sql")).toBe(
      'ALTER TYPE "public"."coding_agent" ADD VALUE \'pi\';--> statement-breakpoint\n' +
        'ALTER TABLE "agent_jobs" ADD COLUMN "resolved_runtime_selection" jsonb;',
    );
  });

  test("contains no enum replacement, row rewrite, destructive statement, or unrelated table", () => {
    const sql = read("migrations/0232_oval_marvex.sql");
    expect(sql).not.toMatch(/DROP\s|DELETE\s|UPDATE\s|CREATE\s+TYPE|ALTER\s+COLUMN/i);
    expect(sql.match(/ALTER TYPE/g)).toHaveLength(1);
    expect(sql.match(/ALTER TABLE/g)).toHaveLength(1);
    expect(sql).not.toContain("claude-code");
    expect(sql).not.toContain("codex-cli");
    expect(sql).not.toContain("runtime_evidence");
  });

  test("preserves existing schema defaults and enum order while admitting Pi", () => {
    const enums = read("src/schema/enums.ts");
    const jobs = read("src/schema/agent-jobs.ts");

    expect(enums).toContain('"opencode",\n  "pi",');
    expect(jobs).toContain(
      'codingAgent: codingAgentEnum("coding_agent").notNull().default("claude-code")',
    );
    expect(jobs).toContain(
      'aiProvider: aiProviderEnum("ai_provider").notNull().default("anthropic")',
    );
    expect(jobs).toContain(
      'model: varchar("model", { length: 100 }).notNull().default("claude-opus-4-8")',
    );
    expect(jobs).toContain(
      'resolvedRuntimeSelection: jsonb("resolved_runtime_selection").$type<ResolvedRuntimeSelection>()',
    );
    expect(jobs).not.toContain("runtimeEvidence");
  });

  test("is the generated successor to 0231", () => {
    const journal = JSON.parse(read("migrations/meta/_journal.json")) as {
      entries: JournalEntry[];
    };
    const previous = journal.entries.find((entry) => entry.tag === "0231_sturdy_kang");
    const current = journal.entries.find((entry) => entry.tag === "0232_oval_marvex");

    expect(previous).toBeDefined();
    expect(current).toEqual(journal.entries.at(-1));
    expect(current?.idx).toBe(232);
    expect(current?.when).toBeGreaterThan(previous?.when ?? Number.MAX_SAFE_INTEGER);
  });
});
