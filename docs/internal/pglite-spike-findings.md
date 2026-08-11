# PGlite + Drizzle ORM - Spike Findings

> **Archived historical record:** These findings preserve the A-338 spike run on
> 2026-02-27. The executable POC was removed in August 2026. Measurements,
> limitations, and conclusions below describe that original run; they are not a
> current compatibility guarantee.

**Task**: A-338 - Spike PGlite: viabilidad y POC con Drizzle
**Date**: 2026-02-27
**PGlite version**: 0.3.15 (`@electric-sql/pglite`)
**Embedded PostgreSQL**: 17.5 (compiled to WASM via Emscripten)
**Drizzle ORM version**: 0.45.1 (built-in `drizzle-orm/pglite` adapter)

---

## 1. PGlite Context Recorded by the Spike

At the time of the spike, PGlite was PostgreSQL compiled to WebAssembly and packaged as a TypeScript/JavaScript library. The spike recorded a full PostgreSQL instance running **in-process**, without a server, Docker, or external binaries, in a package under 3MB gzipped.

- **Recorded runtimes**: Browser (IndexedDB), Node.js, Bun, Deno
- **Recorded storage modes**: In-memory (ephemeral) or filesystem-persisted
- **Recorded maintainer**: ElectricSQL (electric-sql.com)
- **Recorded adoption**: Prisma (default dev DB), Google (Firebase Data Connect emulator)

## 2. POC Summary

The spike found that the removed POC exercised Almirant's real schema patterns against PGlite + Drizzle ORM.

### Features tested in the recorded run (all passed)

| # | Feature | Result | Time |
|---|---------|--------|------|
| 1 | In-memory PGlite instantiation | PASS | ~750ms |
| 2 | Drizzle ORM adapter connection | PASS | <1ms |
| 3 | pgEnum (5 custom enum types) | PASS | ~4ms |
| 4 | 6 tables with FK, indexes, defaults, arrays, JSONB | PASS | ~16ms |
| 5-9 | INSERT (organization, user, project, board, columns, 10 work items) | PASS | 1-7ms each |
| 10-13 | SELECT with enum filtering, JSONB, JOINs, GROUP BY | PASS | 1-6ms each |
| 14-15 | UPDATE enum columns, JSONB merge | PASS | ~3ms each |
| 16-17 | DELETE single + CASCADE | PASS | 1-3ms |
| 18 | Transaction (atomic multi-table insert) | PASS | ~3ms |
| 19 | Transaction rollback | PASS | ~4ms |
| 20 | Bulk insert 100 work items | PASS | ~21ms |
| 21-22 | SELECT 101 items, filtered+ordered | PASS | 1-2ms |
| 23 | File-persisted PGlite (write + close + reopen) | PASS | ~870ms |
| 24 | Raw SQL: CTEs + window functions | PASS | ~3ms |
| 25 | Raw SQL: JSON aggregation (json_agg, json_build_object) | PASS | ~2ms |

**Total: 25/25 tests passed in ~1.7 seconds**

## 3. Drizzle ORM Compatibility

### What the spike found to be compatible

- **`drizzle-orm/pglite` adapter**: The first-class adapter connected successfully when it received the PGlite instance.
- **pgEnum**: Custom PostgreSQL enums worked with Drizzle's query builder for insert, select, filter, and update operations.
- **JSONB columns**: Typed JSONB with `.$type<T>()` worked in the recorded run.
- **Array columns**: `text("col").array()` worked for arrays such as `techStack`.
- **Foreign keys + CASCADE**: `ON DELETE CASCADE`, `ON DELETE SET NULL`, and `ON DELETE RESTRICT` worked.
- **Indexes**: Regular and composite indexes worked.
- **UUID with gen_random_uuid()**: UUID generation worked without additional setup because it was built into PostgreSQL 17.
- **Timestamps with timezone**: `timestamp("col", { withTimezone: true })` worked.
- **Transactions**: Commit and rollback both worked correctly.
- **Raw SQL**: CTEs, window functions, and JSON aggregation worked.
- **Migrator**: `drizzle-orm/pglite/migrator` supported migration files outside the browser.

### What required attention in the recorded run

- **Single statement per execute()**: The spike found no support for multiple SQL statements in one call. Statements such as `CREATE TYPE ...; CREATE TYPE ...;` had to be split, which affected migration files containing multiple statements.
- **Single connection**: The spike found that transaction callbacks had to route every query through the `tx` object. Queries through the outer `db` object deadlocked in the recorded run.
- **No concurrent connections**: The lack of connection pooling was acceptable for the evaluated sandbox and test scenarios, but the spike found that it ruled out multi-user server scenarios.
- **Schema push**: The evaluated versions supported PGlite through `driver: "pglite"` in `drizzle.config.ts`; `drizzle-kit/api` also exposed programmatic migration SQL generation and execution.

## 4. Performance Characteristics

| Operation | Latency |
|-----------|---------|
| Cold start (in-memory) | ~750ms |
| Cold start (file-persisted) | ~870ms |
| Single INSERT | 1-3ms |
| Batch INSERT (100 rows) | ~21ms (~0.2ms/row) |
| Single SELECT | 1-3ms |
| SELECT with JOIN | 1-2ms |
| SELECT with GROUP BY + aggregate | 1-2ms |
| UPDATE | 2-3ms |
| DELETE + CASCADE | 2-3ms |
| Transaction (3 operations) | ~3ms |
| CREATE TABLE (with FK + indexes) | ~2-3ms each |

The spike found that most CRUD operations completed in under 3ms. The only significant measured cost was cold start (~750ms), a one-time cost per instance. The spike concluded that these measurements were excellent for the evaluated sandbox and test environments.

## 5. Limitations Observed by the Spike

### Hard limitations recorded at the time

1. **Single-threaded**: The spike observed synchronous WASM execution and no parallel query execution.
2. **No concurrent connections**: The spike observed one connection per PGlite instance.
3. **No extensions ecosystem**: The evaluated build was limited to bundled extensions. It included pgvector but not most PostgreSQL extensions.
4. **Memory-bound**: In-memory mode was limited by available RAM, and the recorded browser limit ranged from approximately 50MB to 1GB.
5. **No LISTEN/NOTIFY**: The evaluated build did not provide traditional PostgreSQL LISTEN/NOTIFY, although it included PGlite's own live-query system.

### Soft limitations and recorded workarounds

1. **Multi-statement execute**: The spike split multi-statement SQL into individual calls.
2. **Migration files**: The spike recorded the PGlite migrator and programmatic schema push as available workarounds.
3. **No `psql` access**: The spike used PGlite's `.query()` and Drizzle's query builder instead.

### Areas the spike did not test

- pgvector extension
- Large datasets (10k+ rows)
- Complex stored procedures/triggers
- Browser-based persistence (IndexedDB)
- ElectricSQL sync integration

## 6. Historical Viability Assessment

### Use case: Sandbox environments for Almirant

**Spike verdict: VIABLE**

The spike concluded that PGlite was an excellent fit for lightweight sandbox environments where:

- Each user or session received an isolated database instance
- No Docker or external PostgreSQL server was required
- Schemas had to match the real production database
- CRUD operations and standard SQL were the primary workload

### Use case: Automated testing

**Spike verdict: HIGHLY RECOMMENDED**

The spike concluded that PGlite could eliminate the need for a running PostgreSQL Docker container during tests. Each test could start an isolated in-memory database in ~750ms, run the full schema, and tear it down immediately.

### Use case: Replace production PostgreSQL

**Spike verdict: NOT VIABLE**

The spike concluded that PGlite's single-connection, memory-bound design could not handle concurrent requests from multiple users.

### Use case: MCP tool sandboxing

**Spike verdict: VIABLE**

The spike concluded that AI agents using MCP could receive isolated PGlite instances for data experiments without affecting the real database.

## 7. Recommendations Recorded by the Spike

The spike recommended the following follow-up work. These items are preserved as historical proposals, not current instructions.

1. **Testing integration**: The spike recommended creating a `createTestDatabase()` utility that would:
   - Starting PGlite in memory
   - Pushing the full Almirant schema
   - Returning a Drizzle instance ready for repository tests
   - Removing the Docker dependency for `bun test`

2. **Schema push utility**: The spike recommended building a script around `drizzle-kit/api` that would programmatically push the full Almirant schema to PGlite and avoid migration files.

3. **Sandbox API**: The spike recommended considering an API endpoint that would create per-session PGlite instances for demo and sandbox modes.

4. **Browser prototype**: The spike recommended evaluating PGlite in the browser for offline-first features, including IndexedDB persistence and ElectricSQL sync.

## 8. References

- [PGlite Official Site](https://pglite.dev/)
- [PGlite GitHub Repository](https://github.com/electric-sql/pglite)
- [Drizzle ORM PGlite Adapter Docs](https://orm.drizzle.team/docs/connect-pglite)
- [Drizzle ORM Get Started with PGlite](https://orm.drizzle.team/docs/get-started/pglite-new)
- [PGlite ORM Support](https://pglite.dev/docs/orm-support)
- [PGlite Benchmarks](https://pglite.dev/benchmarks)
- [@electric-sql/pglite on npm](https://www.npmjs.com/package/@electric-sql/pglite)
