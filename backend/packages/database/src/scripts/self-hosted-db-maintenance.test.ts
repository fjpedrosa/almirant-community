import { describe, expect, test } from "bun:test";
import {
  SELF_HOSTED_LEGACY_BASELINE_TAG,
  findMissingExpectedColumns,
  getLatestJournalEntry,
  getMigrationRecordsThrough,
  getSnapshotPathForEntry,
  loadExpectedSchemaColumns,
  loadJournalEntries,
} from "./self-hosted-db-maintenance";

describe("self-hosted-db-maintenance utilities", () => {
  test("legacy baseline tag exists in the migration journal", () => {
    const entries = loadJournalEntries();
    const baselineRecords = getMigrationRecordsThrough(
      entries,
      SELF_HOSTED_LEGACY_BASELINE_TAG,
    );

    expect(baselineRecords.length).toBeGreaterThan(0);
    expect(baselineRecords.at(-1)?.entry.tag).toBe(SELF_HOSTED_LEGACY_BASELINE_TAG);
    expect(baselineRecords.every((record) => record.hash.length === 64)).toBe(true);
  });

  test("latest snapshot declares the expected public schema columns", () => {
    const latest = getLatestJournalEntry(loadJournalEntries());
    const columns = loadExpectedSchemaColumns(getSnapshotPathForEntry(latest));

    expect(columns.length).toBeGreaterThan(0);
    expect(columns).toContainEqual({
      schema: "public",
      table: "worker_registrations",
      column: "ram_available_mb",
    });
  });

  test("missing-column detection compares schema, table, and column", () => {
    const expected = [
      { schema: "public", table: "projects", column: "id" },
      { schema: "public", table: "projects", column: "name" },
    ];
    const actual = [{ schema: "public", table: "projects", column: "id" }];

    expect(findMissingExpectedColumns(expected, actual)).toEqual([
      { schema: "public", table: "projects", column: "name" },
    ]);
  });
});
