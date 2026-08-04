export interface MigrationJournalEntry {
  tag: string;
  when: number;
}

export interface AppliedMigrationRecord {
  hash: string;
  createdAt: number;
}

export interface CompatibleMigrationLedgerRepair {
  action: "insert" | "retimestamp";
  tag: string;
  hash: string;
  legacyHash: string;
  createdAt: number;
}

export const COMPATIBLE_MIGRATION_HASHES = {
  "0046_happy_junta": [
    "fc0c02c60e024a6af78f03b8ba31db4c1d829aa84113e9d40a26ab157228f3ca",
  ],
  "0069_many_thor_girl": [
    "41c375aac8e4109d8241d2ae7ab79fc2f8cce837c1ee59daf9f2d0a0ac438430",
  ],
  "0070_add_check_constraint": [
    "4166fa19039c93df60d0fb15223f62c5e926f2e76dd2bba987c2ed8acaa16592",
  ],
  "0071_data_migrate_todos": [
    "29bfc2da1b09418ebf87f8d3ff624818f36de26995bb22396071aa2b591d7047",
  ],
  "0075_wet_lilith": [
    "6e017de3ef2bdf24963ba30479b45b4e80ac8633476a3b48e346ce592c13a8fe",
  ],
  "0080_wet_doctor_strange": [
    "d23564a678a687efce3ac89823a14f3d4484f2f48aae5e497fc8e9cf490c7d4d",
  ],
  "0085_data_migrate_seeds": [
    "2a8e554fa08dee11bd3c4dda5214e9dfd528808627ce3c450a4bfbfc1de6b30d",
  ],
  "0119_overconfident_warhawk": [
    "f0ff4f550c3ccc88da5aaa213986061b2adfd11bbf929a8f776fc8c26b7f224d",
  ],
  "0121_faithful_gideon": [
    "18dcd9ab58d5dd59ca7bc3e5d962c9fe19f3f2c9eb4a8e8238c3ee26a616a59a",
  ],
  // #73: 0147 guards the FK that legacy 0046 already created.
  "0147_recreate_oauth_states": [
    "87de2d6c15c40cbbfea5108ad53e66f83c702c1cb17baf4409a3b119e61f2930",
  ],
  // #88: 0191 only rewords a comment that confused Drizzle's SQL splitter.
  "0191_rename_bug_job_types": [
    "95135b4ad3676835168d34c483d7882a4880da198c3af44651594217f0a615c4",
  ],
} as const satisfies Record<string, readonly string[]>;

interface PlanCompatibleMigrationLedgerRepairsInput {
  entries: readonly MigrationJournalEntry[];
  migrationHashes: ReadonlyMap<string, string>;
  compatibleHashes: Readonly<Record<string, readonly string[]>>;
  appliedMigrations: readonly AppliedMigrationRecord[];
}

export function planCompatibleMigrationLedgerRepairs({
  entries,
  migrationHashes,
  compatibleHashes,
  appliedMigrations,
}: PlanCompatibleMigrationLedgerRepairsInput): CompatibleMigrationLedgerRepair[] {
  const appliedByHash = new Map<string, AppliedMigrationRecord[]>();
  for (const migration of appliedMigrations) {
    const records = appliedByHash.get(migration.hash) ?? [];
    records.push(migration);
    appliedByHash.set(migration.hash, records);
  }

  const repairs: CompatibleMigrationLedgerRepair[] = [];
  for (const entry of entries) {
    const legacyHashes = compatibleHashes[entry.tag];
    if (!legacyHashes) {
      continue;
    }

    const legacyHash = legacyHashes.find((hash) => appliedByHash.has(hash));
    if (!legacyHash) {
      continue;
    }

    const hash = migrationHashes.get(entry.tag);
    if (!hash) {
      throw new Error(`No validated SQL hash exists for migration ${entry.tag}`);
    }

    const replacementRows = appliedByHash.get(hash) ?? [];
    if (replacementRows.length === 0) {
      repairs.push({
        action: "insert",
        tag: entry.tag,
        hash,
        legacyHash,
        createdAt: entry.when,
      });
      continue;
    }

    if (replacementRows.some((row) => row.createdAt !== entry.when)) {
      repairs.push({
        action: "retimestamp",
        tag: entry.tag,
        hash,
        legacyHash,
        createdAt: entry.when,
      });
    }
  }

  return repairs;
}
