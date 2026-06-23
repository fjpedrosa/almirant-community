# Migrations chain audit — 2026-04-25

This document records the state of `backend/packages/database/migrations/`
on the day the chain was first formally audited, the issues found, the
ones repaired in this PR, and the ones deferred to a follow-up.

## State before cleanup

| Metric | Value |
|--------|-------|
| `.sql` files in `migrations/` | **199** |
| Entries in `_journal.json` | **190** |
| Orphans (`.sql` without journal entry) | **9** |
| Out-of-order `when` timestamps | **19** |
| Duplicate `idx` in journal | 0 |
| Missing files (journal entry without `.sql`) | 0 |

`bootstrap-self-hosted.ts` was already aware of this and chose
`drizzle-kit push --force` over `drizzle-kit migrate` to sidestep it
(see comment in `backend/packages/database/src/preview/bootstrap-self-hosted.ts:15-19`).

## Repaired in this PR

### Removed 9 orphan `.sql` files

Each of these was on disk but had no entry in `_journal.json`. Drizzle
ignored them in every code path. Removal is safe because:

- `drizzle-kit migrate` reads the journal, not the directory.
- `drizzle-kit push --force` reads the TypeScript schema, not the directory.
- `drizzle-kit generate` reads the latest journal-referenced snapshot.

| File | Why it was orphaned |
|------|---------------------|
| `0058_massive_cable.sql` | Lost the merge race against `0058_graceful_blazing_skull` (same idx) |
| `0059_watery_misty_knight.sql` | Part of the 0059–0064 sequence reverted from journal |
| `0060_lethal_justice.sql` | "" |
| `0061_careful_the_initiative.sql` | "" |
| `0062_tan_captain_cross.sql` | "" |
| `0063_oval_solo.sql` | "" |
| `0064_soft_dorian_gray.sql` | "" |
| `0120_peaceful_stone_men.sql` | Lost the merge race against `0120_worker_hostname_unique` (same idx) |
| `0139_fresh_black_tarantula.sql` | Lost the merge race against `0139_wooden_nightcrawler` (same idx) |

### Removed 6 orphan snapshots

`meta/0059_snapshot.json` through `meta/0064_snapshot.json` — these had
no journal entry referencing their idx, so they were purely dead files.

The snapshots for idx 58 / 120 / 139 were **kept** because they belong
to the journal-winning version (different `.sql` file, same idx).

## Repaired by tooling, not by edits

- `scripts/audit-migrations.sh` — runs the same checks performed for
  this audit. Two severity levels:
  - **Blocking** (exit 1): orphans, missing files, duplicate idx.
  - **Warning** (exit 0): out-of-order `when` timestamps. Pass `--strict`
    to escalate.
- `.github/workflows/migrations-audit.yml` — fails any PR that
  reintroduces a blocking issue.

## Deferred (NOT repaired in this PR)

### 19 out-of-order `when` timestamps

Drizzle uses `when` (not `idx`) to decide which migrations to apply on a
given DB. When `when[N+1] < when[N]`, drizzle-kit migrate may skip the
later entry on a fresh DB or re-apply it on an existing one — neither
is what we want.

Example:

```
0017_work_item_events_schema_update  when=1770710400000
0018_silky_nightshade                when=1770669284345  ← in the past relative to 0017
```

Repairing this requires rewriting `_journal.json` with monotonic `when`
values. That change is **not safe to ship unilaterally** because:

1. Live instances persist their migration cursor in
   `drizzle.__drizzle_migrations.created_at`. Rewriting `when` in the
   repo journal can cause migrate to either re-apply or skip rows that
   were already settled.
2. There is no dry-run mode for "what would migrate do if I rewrote
   journal X to Y on instance Z".

### Plan for the follow-up PR

1. Build a `scripts/repair-journal-when.ts` that:
   - Reads `_journal.json`
   - Re-emits a copy with monotonic `when` derived from the original
     ordering (preserve relative position, just bump timestamps).
   - Outputs both files for diffing.
2. Build `scripts/baseline-instance.ts` that connects to a live DB and
   inserts a `__drizzle_migrations` row marking everything currently
   committed in the journal as already-applied (so `drizzle-kit migrate`
   would do nothing on first run after the cutover).
3. Change `bootstrap-self-hosted.ts` to:
   - Detect whether `__drizzle_migrations` is empty.
     - Empty → run `push --force` once, then call the baseline script.
     - Non-empty → run `drizzle-kit migrate` normally.
4. Smoke-test against a snapshot of every known live instance before
   merging.

Tracked separately so the env-sync work and the orphan cleanup ship
without dragging the journal repair with them.

## Follow-up checklist

- [ ] Decide whether to ship the `when`-repair PR or accept that
  self-hosted stays on `push --force` permanently.
- [ ] If shipping: dump every known live instance's
  `drizzle.__drizzle_migrations` table for diff against the rewritten
  journal.
- [ ] Document the migration policy for stack contributors (no merging
  parallel branches that introduce migrations with the same idx — generate
  the migration after rebasing).
