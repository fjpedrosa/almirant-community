import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface PendingMigrationHash {
  tag: string;
  hash: string;
}

type MigrationFileReader = (path: string, encoding: "utf8") => string;

export function readMigrationFileHash(
  migrationsFolder: string,
  migrationTag: string,
  readFile: MigrationFileReader = readFileSync,
): string {
  const sqlPath = resolve(migrationsFolder, `${migrationTag}.sql`);

  try {
    return createHash("sha256")
      .update(readFile(sqlPath, "utf8"))
      .digest("hex");
  } catch (cause) {
    throw new Error(
      `Migration journal entry '${migrationTag}' requires a readable SQL file at ${sqlPath}`,
      { cause },
    );
  }
}

export function assertPendingMigrationsApplied(
  initiallyPending: readonly PendingMigrationHash[],
  appliedHashes: ReadonlySet<string>,
): PendingMigrationHash[] {
  const missing = initiallyPending.filter(
    (migration) => !appliedHashes.has(migration.hash),
  );

  if (missing.length > 0) {
    throw new Error(
      "Migration verification failed: initially pending migrations remain " +
        `unapplied: ${missing.map((migration) => migration.tag).join(", ")}`,
    );
  }

  return [...initiallyPending];
}
