export interface CursorNormalizationJournalEntry {
  tag: string;
  when: number;
}

export interface MigrationLedgerRecord {
  id: number;
  hash: string;
  createdAt: number;
}

export interface RawMigrationLedgerRecord {
  id: string | number;
  hash: string;
  created_at: string | number;
}

export interface ObsoleteCursorNormalization {
  id: number;
  hash: string;
  expectedCreatedAt: number;
  createdAt: number;
}

type ObsoleteCursorNormalizationUpdate = (
  repair: ObsoleteCursorNormalization,
) => Promise<readonly { id: number }[]>;

export function toMigrationLedgerRecord(
  row: RawMigrationLedgerRecord,
): MigrationLedgerRecord {
  return {
    id: Number(row.id),
    hash: row.hash,
    createdAt: Number(row.created_at),
  };
}

interface PlanObsoleteCursorNormalizationsInput {
  entries: readonly CursorNormalizationJournalEntry[];
  migrationHashes: ReadonlyMap<string, string>;
  appliedMigrations: readonly MigrationLedgerRecord[];
}

export function planObsoleteCursorNormalizations({
  entries,
  migrationHashes,
  appliedMigrations,
}: PlanObsoleteCursorNormalizationsInput): ObsoleteCursorNormalization[] {
  const currentHashByTag = new Map<string, string>();
  const currentJournalByHash = new Map<string, CursorNormalizationJournalEntry>();
  for (const entry of entries) {
    const hash = migrationHashes.get(entry.tag);
    if (!hash) {
      throw new Error(`No validated SQL hash exists for migration ${entry.tag}`);
    }

    currentHashByTag.set(entry.tag, hash);
    currentJournalByHash.set(hash, entry);
  }

  const appliedHashes = new Set(appliedMigrations.map((migration) => migration.hash));
  const latest = entries.at(-1);
  if (!latest) {
    return [];
  }

  // A no-op outside the single-pending-latest case: this is an optional repair,
  // never a migration precondition.
  const pendingEntries = entries.filter(
    (entry) => !appliedHashes.has(currentHashByTag.get(entry.tag)!),
  );
  if (pendingEntries.length !== 1) {
    return [];
  }

  const pending = pendingEntries[0];
  if (pending !== latest) {
    return [];
  }

  for (const migration of appliedMigrations) {
    const currentEntry = currentJournalByHash.get(migration.hash);
    if (currentEntry && migration.createdAt >= pending.when) {
      throw new Error(
        `Obsolete cursor normalization refuses current migration hash ${migration.hash} at or after pending migration ${pending.tag}`,
      );
    }
  }

  return appliedMigrations
    .filter(
      (migration) =>
        !currentJournalByHash.has(migration.hash) &&
        migration.createdAt >= pending.when,
    )
    .map((migration) => ({
      id: migration.id,
      hash: migration.hash,
      expectedCreatedAt: migration.createdAt,
      createdAt: pending.when - 1,
    }));
}

export async function executeObsoleteCursorNormalizations(
  repairs: readonly ObsoleteCursorNormalization[],
  update: ObsoleteCursorNormalizationUpdate,
): Promise<void> {
  for (const repair of repairs) {
    const updated = await update(repair);
    if (updated.length !== 1 || updated[0]?.id !== repair.id) {
      throw new Error(
        `Obsolete cursor normalization could not update ledger row ${repair.id} exactly once`,
      );
    }
  }
}
