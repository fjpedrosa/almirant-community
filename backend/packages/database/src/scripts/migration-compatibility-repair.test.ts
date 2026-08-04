import { describe, expect, test } from "bun:test";
import {
  COMPATIBLE_MIGRATION_HASHES,
  planCompatibleMigrationLedgerRepairs,
} from "./migration-compatibility-repair";

const entries = [
  { idx: 257, tag: "0257_scheduled_tasks_follow_up", when: 1785831919001 },
  { idx: 258, tag: "0258_done_retention", when: 1785841794693 },
];

const migrationHashes = new Map([
  ["0257_scheduled_tasks_follow_up", "hash-0257"],
  ["0258_done_retention", "replacement-hash-0258"],
]);

const compatibleHashes = {
  "0258_done_retention": ["legacy-hash-0258"],
};

describe("planCompatibleMigrationLedgerRepairs", () => {
  test("does not declare 0258 as a compatibility rewrite", () => {
    expect(COMPATIBLE_MIGRATION_HASHES).not.toHaveProperty(
      "0258_done_retention",
    );
  });

  test("inserts a missing replacement hash at its canonical journal timestamp", () => {
    expect(
      planCompatibleMigrationLedgerRepairs({
        entries,
        migrationHashes,
        compatibleHashes,
        appliedMigrations: [
          { hash: "hash-0257", createdAt: 1785831919001 },
          { hash: "legacy-hash-0258", createdAt: 1785000000000 },
        ],
      }),
    ).toEqual([
      {
        action: "insert",
        tag: "0258_done_retention",
        hash: "replacement-hash-0258",
        legacyHash: "legacy-hash-0258",
        createdAt: 1785841794693,
      },
    ]);
  });

  test("retimestamps a poisoned replacement hash only when its declared legacy hash is applied", () => {
    expect(
      planCompatibleMigrationLedgerRepairs({
        entries,
        migrationHashes,
        compatibleHashes,
        appliedMigrations: [
          { hash: "hash-0257", createdAt: 1785831919001 },
          { hash: "legacy-hash-0258", createdAt: 1785000000000 },
          { hash: "replacement-hash-0258", createdAt: 1786000000000 },
          { hash: "unrelated-hash", createdAt: 1786000000000 },
        ],
      }),
    ).toEqual([
      {
        action: "retimestamp",
        tag: "0258_done_retention",
        hash: "replacement-hash-0258",
        legacyHash: "legacy-hash-0258",
        createdAt: 1785841794693,
      },
    ]);
  });

  test("is idempotent and leaves rows outside declared compatibility pairs untouched", () => {
    expect(
      planCompatibleMigrationLedgerRepairs({
        entries,
        migrationHashes,
        compatibleHashes,
        appliedMigrations: [
          { hash: "hash-0257", createdAt: 1785831919001 },
          { hash: "legacy-hash-0258", createdAt: 1785000000000 },
          { hash: "replacement-hash-0258", createdAt: 1785841794693 },
          { hash: "unrelated-hash", createdAt: 1786000000000 },
        ],
      }),
    ).toEqual([]);
  });

  test("does not repair a replacement hash without its declared legacy hash", () => {
    expect(
      planCompatibleMigrationLedgerRepairs({
        entries,
        migrationHashes,
        compatibleHashes,
        appliedMigrations: [
          { hash: "replacement-hash-0258", createdAt: 1786000000000 },
        ],
      }),
    ).toEqual([]);
  });
});
