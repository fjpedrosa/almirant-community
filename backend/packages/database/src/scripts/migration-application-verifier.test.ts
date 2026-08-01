import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertPendingMigrationsApplied,
  readMigrationFileHash,
} from "./migration-application-verifier";

const pending = [
  { tag: "0217_first", hash: "hash-0217" },
  { tag: "0218_second", hash: "hash-0218" },
];

describe("assertPendingMigrationsApplied", () => {
  test("fails closed when migrate applies none of the initially pending migrations", () => {
    expect(() => assertPendingMigrationsApplied(pending, new Set())).toThrow(
      "0217_first, 0218_second",
    );
  });

  test("fails closed when migrate applies only part of the initially pending migrations", () => {
    expect(() =>
      assertPendingMigrationsApplied(pending, new Set(["hash-0217"])),
    ).toThrow("0218_second");
  });

  test("returns all applied migrations only when every pending hash exists", () => {
    expect(
      assertPendingMigrationsApplied(
        pending,
        new Set(["hash-0217", "hash-0218"]),
      ),
    ).toEqual(pending);
  });
});

describe("readMigrationFileHash", () => {
  test("fails closed when a journal SQL file is missing or unreadable", async () => {
    const migrationsFolder = await mkdtemp(
      join(tmpdir(), "almirant-migration-hash-"),
    );

    try {
      expect(() =>
        readMigrationFileHash(migrationsFolder, "0219_missing"),
      ).toThrow("0219_missing");

      expect(() =>
        readMigrationFileHash(
          migrationsFolder,
          "0220_unreadable",
          () => {
            throw new Error("EACCES");
          },
        ),
      ).toThrow("0220_unreadable");
    } finally {
      await rm(migrationsFolder, { recursive: true, force: true });
    }
  });
});
