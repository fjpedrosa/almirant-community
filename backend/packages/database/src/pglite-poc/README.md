# PGlite + Drizzle ORM - Spike Findings

**Task**: A-338 - Spike PGlite: viabilidad y POC con Drizzle
**Date**: 2026-02-27
**PGlite version**: 0.3.15 (`@electric-sql/pglite`)
**Embedded PostgreSQL**: 17.5 (compiled to WASM via Emscripten)
**Drizzle ORM version**: 0.45.1 (built-in `drizzle-orm/pglite` adapter)

---

## 1. What is PGlite?

PGlite is PostgreSQL compiled to WebAssembly, packaged as a TypeScript/JavaScript library. It runs a full Postgres instance **in-process** -- no server, no Docker, no external binaries. Under 3MB gzipped.

- **Runtimes**: Browser (IndexedDB), Node.js, Bun, Deno
- **Storage**: In-memory (ephemeral) or filesystem-persisted
- **Maintainer**: ElectricSQL (electric-sql.com)
- **Adoption**: Used by Prisma (default dev DB), Google (Firebase Data Connect emulator)

## 2. POC Summary

The POC (`poc.ts`) tests Almirant's real schema patterns against PGlite + Drizzle ORM.

### Tested features (all PASS)

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

### What works perfectly

- **`drizzle-orm/pglite` adapter**: First-class support. Import `drizzle` from `drizzle-orm/pglite` and pass the PGlite instance.
- **pgEnum**: Custom PostgreSQL enums work with Drizzle's query builder (insert, select, filter, update).
- **JSONB columns**: Full support for typed JSONB with `.$type<T>()`.
- **Array columns**: `text("col").array()` works for arrays like `techStack`.
- **Foreign keys + CASCADE**: `ON DELETE CASCADE`, `ON DELETE SET NULL`, `ON DELETE RESTRICT` all work.
- **Indexes**: Regular and composite indexes.
- **UUID with gen_random_uuid()**: Works out of the box (PG 17 built-in).
- **Timestamps with timezone**: `timestamp("col", { withTimezone: true })` works.
- **Transactions**: Both commit and rollback work correctly.
- **Raw SQL**: CTEs, window functions, JSON aggregation -- all standard PG features.
- **Migrator**: `drizzle-orm/pglite/migrator` supports running migration files outside the browser.

### What requires attention

- **Single statement per execute()**: PGlite does NOT support multiple SQL statements in a single call (e.g., `CREATE TYPE ...; CREATE TYPE ...;` must be split). This affects migration files that bundle multiple statements.
- **Single connection**: PGlite is a single-connection database. Inside a transaction callback, you MUST use the `tx` object for ALL queries. Using the outer `db` object will deadlock.
- **No concurrent connections**: No connection pooling. This is fine for sandboxes/tests but rules out multi-user server scenarios.
- **Schema push**: `drizzle-kit push` supports PGlite via `driver: "pglite"` in drizzle.config.ts. For programmatic use, you can use `drizzle-kit/api` to generate migration SQL and execute it.

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

**Verdict**: Sub-3ms for most CRUD operations. The only significant cost is cold start (~750ms), which is a one-time cost per instance. For sandbox/test environments, this is excellent.

## 5. Limitations

### Hard limitations (cannot work around)

1. **Single-threaded**: WASM runs synchronously. No parallel query execution.
2. **No concurrent connections**: One connection per PGlite instance.
3. **No extensions ecosystem**: Limited to what ships with PGlite (pgvector is supported, but most PG extensions are not).
4. **Memory-bound**: In-memory mode is limited by available RAM. Browser mode limited to ~50MB-1GB.
5. **No LISTEN/NOTIFY** in the traditional sense (PGlite has its own live query system).

### Soft limitations (workarounds exist)

1. **Multi-statement execute**: Split into individual calls.
2. **Migration files**: Use the PGlite migrator or push schema programmatically.
3. **No `psql` access**: Use PGlite's `.query()` or Drizzle's query builder instead.

### Not tested (out of scope for this spike)

- pgvector extension
- Large datasets (10k+ rows)
- Complex stored procedures/triggers
- Browser-based persistence (IndexedDB)
- ElectricSQL sync integration

## 6. Viability Assessment

### Use case: Sandbox environments for Almirant

**Verdict: VIABLE**

PGlite is an excellent fit for lightweight sandbox environments where:

- Each user/session gets an isolated database instance
- No Docker or external PostgreSQL server is needed
- Schemas must match the real production database
- CRUD operations and standard SQL are the primary workload

### Use case: Automated testing

**Verdict: HIGHLY RECOMMENDED**

PGlite eliminates the need for a running PostgreSQL Docker container during tests. Each test can spin up an isolated in-memory database in ~750ms, run the full schema, and tear down instantly.

### Use case: Replace production PostgreSQL

**Verdict: NOT VIABLE**

PGlite is single-connection and memory-bound. It cannot handle concurrent requests from multiple users.

### Use case: MCP tool sandboxing

**Verdict: VIABLE**

AI agents (via MCP) could get isolated PGlite instances to safely experiment with data without affecting the real database.

## 7. Recommended Next Steps

1. **Testing integration**: Create a `createTestDatabase()` utility that:
   - Spins up PGlite in-memory
   - Pushes the full Almirant schema
   - Returns a Drizzle instance ready for repository tests
   - Eliminates Docker dependency for `bun test`

2. **Schema push utility**: Build a script that uses `drizzle-kit/api` to programmatically push the full Almirant schema to PGlite, avoiding the need for migration files.

3. **Sandbox API**: Consider an API endpoint that creates per-session PGlite instances for demo/sandbox mode.

4. **Browser prototype**: Evaluate PGlite in the browser for offline-first features (IndexedDB persistence + ElectricSQL sync).

## 8. How to Run the POC

```bash
cd backend/packages/database
bun run src/pglite-poc/poc.ts
```

Expected output: 25 passing tests in ~2 seconds.

## 9. References

- [PGlite Official Site](https://pglite.dev/)
- [PGlite GitHub Repository](https://github.com/electric-sql/pglite)
- [Drizzle ORM PGlite Adapter Docs](https://orm.drizzle.team/docs/connect-pglite)
- [Drizzle ORM Get Started with PGlite](https://orm.drizzle.team/docs/get-started/pglite-new)
- [PGlite ORM Support](https://pglite.dev/docs/orm-support)
- [PGlite Benchmarks](https://pglite.dev/benchmarks)
- [@electric-sql/pglite on npm](https://www.npmjs.com/package/@electric-sql/pglite)
