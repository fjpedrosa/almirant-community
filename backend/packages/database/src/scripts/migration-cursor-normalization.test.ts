import { describe, expect, test } from "bun:test";
import {
  executeObsoleteCursorNormalizations,
  planObsoleteCursorNormalizations,
  toMigrationLedgerRecord,
} from "./migration-cursor-normalization";

const entries = [
  { tag: "0256_orange_sentinels", when: 1785831919000 },
  { tag: "0257_scheduled_tasks_follow_up", when: 1785831919001 },
  { tag: "0258_done_retention", when: 1785841794693 },
];

const migrationHashes = new Map([
  ["0256_orange_sentinels", "hash-0256"],
  ["0257_scheduled_tasks_follow_up", "hash-0257"],
  ["0258_done_retention", "hash-0258"],
]);

const appliedCurrentMigrations = [
  { id: 1, hash: "hash-0256", createdAt: 1785831919000 },
  { id: 2, hash: "hash-0257", createdAt: 1785831919001 },
];

describe("planObsoleteCursorNormalizations", () => {
  test("converts raw PostgreSQL string identifiers and timestamps to numbers", () => {
    expect(
      toMigrationLedgerRecord({
        id: "3",
        hash: "unknown-hash",
        created_at: "1785841794700",
      }),
    ).toEqual({
      id: 3,
      hash: "unknown-hash",
      createdAt: 1785841794700,
    });
  });

  test("selects only obsolete rows that block the sole latest pending migration", () => {
    expect(
      planObsoleteCursorNormalizations({
        entries,
        migrationHashes,
        appliedMigrations: [
          ...appliedCurrentMigrations,
          { id: 3, hash: "obsolete-main-0250", createdAt: 1785841794693 },
          { id: 4, hash: "unknown-hash", createdAt: 1785841794700 },
          { id: 5, hash: "unrelated-old-hash", createdAt: 1785841794692 },
        ],
      }),
    ).toEqual([
      {
        id: 3,
        hash: "obsolete-main-0250",
        expectedCreatedAt: 1785841794693,
        createdAt: 1785841794692,
      },
      {
        id: 4,
        hash: "unknown-hash",
        expectedCreatedAt: 1785841794700,
        createdAt: 1785841794692,
      },
    ]);
  });

  test("is idempotent after selected blockers are retimestamped", () => {
    const appliedMigrations = [
      ...appliedCurrentMigrations,
      { id: 3, hash: "obsolete-main-0250", createdAt: 1785841794693 },
    ];
    const repairs = planObsoleteCursorNormalizations({
      entries,
      migrationHashes,
      appliedMigrations,
    });

    expect(
      planObsoleteCursorNormalizations({
        entries,
        migrationHashes,
        appliedMigrations: appliedMigrations.map((migration) => {
          const repair = repairs.find(({ id }) => id === migration.id);
          return repair
            ? { ...migration, createdAt: repair.createdAt }
            : migration;
        }),
      }),
    ).toEqual([]);
  });

  test("returns no repairs when more than one current migration is pending (regression: self-hosted instances many migrations behind must not abort)", () => {
    expect(
      planObsoleteCursorNormalizations({
        entries,
        migrationHashes,
        appliedMigrations: [
          { id: 1, hash: "hash-0256", createdAt: 1785831919000 },
          { id: 3, hash: "unknown-hash", createdAt: 1785841794700 },
        ],
      }),
    ).toEqual([]);
  });

  test("returns no repairs when every current migration is pending", () => {
    expect(
      planObsoleteCursorNormalizations({
        entries,
        migrationHashes,
        appliedMigrations: [
          { id: 1, hash: "hash-0256", createdAt: 1785831919000 },
        ],
      }),
    ).toEqual([]);
  });

  test("returns no repairs when the sole pending migration is not the latest journal entry", () => {
    expect(
      planObsoleteCursorNormalizations({
        entries,
        migrationHashes,
        appliedMigrations: [
          { id: 1, hash: "hash-0256", createdAt: 1785831919000 },
          { id: 2, hash: "hash-0258", createdAt: 1785841794693 },
        ],
      }),
    ).toEqual([]);
  });

  test("throws when a journal entry has no validated SQL hash", () => {
    expect(() =>
      planObsoleteCursorNormalizations({
        entries,
        migrationHashes: new Map([
          ["0256_orange_sentinels", "hash-0256"],
          ["0257_scheduled_tasks_follow_up", "hash-0257"],
        ]),
        appliedMigrations: appliedCurrentMigrations,
      }),
    ).toThrow("No validated SQL hash exists for migration 0258_done_retention");
  });

  test("refuses a current journal hash whose ledger timestamp reaches the pending target", () => {
    expect(() =>
      planObsoleteCursorNormalizations({
        entries: [
          { tag: "current-before-target", when: 1785841794692 },
          { tag: "0258_done_retention", when: 1785841794693 },
        ],
        migrationHashes: new Map([
          ["current-before-target", "current-hash"],
          ["0258_done_retention", "hash-0258"],
        ]),
        appliedMigrations: [
          { id: 1, hash: "current-hash", createdAt: 1785841794693 },
          { id: 2, hash: "unknown-hash", createdAt: 1785841794700 },
        ],
      }),
    ).toThrow("current migration hash");
  });

  test("fails closed when an exact planned ledger update no longer matches", async () => {
    await expect(
      executeObsoleteCursorNormalizations(
        [
          {
            id: 3,
            hash: "unknown-hash",
            expectedCreatedAt: 1785841794700,
            createdAt: 1785841794692,
          },
        ],
        async () => [],
      ),
    ).rejects.toThrow("exactly once");
  });
});
