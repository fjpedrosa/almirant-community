import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import type { LiveAgentJobClaimTransaction } from "../agents/agent-job-repository";
import { piOpenaiConnectionLeases } from "../../schema/pi-openai-connection-leases";

const owner = {
  connectionId: "aaaaaaaa-1111-4111-8111-111111111111",
  jobId: "bbbbbbbb-1111-4111-8111-111111111111",
  workerId: "worker-1", claimAttemptId: "claim-1",
  credentialVersion: "2026-05-01T11:59:00.123Z",
};
const other = {
  ...owner, connectionId: "cccccccc-1111-4111-8111-111111111111",
  jobId: "dddddddd-1111-4111-8111-111111111111",
};
const now = Date.parse("2026-05-01T12:00:00.000Z");
const client = new PGlite();
const queries: { sql: string; params: unknown[] }[] = [];
const database = drizzle(client, {
  logger: { logQuery: (sql, params) => { queries.push({ sql, params }); } },
});
let helpers: typeof import("./pi-openai-connection-lease-repository");
beforeAll(async () => {
  await client.exec(`
    CREATE TABLE provider_connections (id uuid PRIMARY KEY, updated_at timestamptz DEFAULT now());
    CREATE TABLE agent_jobs (id uuid PRIMARY KEY);
  `);
  await client.exec(await Bun.file(new URL("../../../migrations/0237_past_harpoon.sql", import.meta.url)).text());
  for (const input of [owner, other]) {
    await client.query("INSERT INTO provider_connections (id) VALUES ($1)", [input.connectionId]);
    await client.query("INSERT INTO agent_jobs (id) VALUES ($1)", [input.jobId]);
  }
  helpers = await import("./pi-openai-connection-lease-repository");
});
afterAll(() => client.close());
beforeEach(async () => { await database.delete(piOpenaiConnectionLeases); });
const seed = (input = owner, expiresAt = now + 1) => database.insert(piOpenaiConnectionLeases).values({
  ...input, credentialVersion: new Date(input.credentialVersion), expiresAt: new Date(expiresAt),
});
const rows = () => database.select().from(piOpenaiConnectionLeases).orderBy(piOpenaiConnectionLeases.connectionId);

// PGlite and postgres-js have distinct driver result types, but execute the same
// Drizzle PostgreSQL builders. The production callback type is checked separately.
const transaction = <T>(run: (tx: LiveAgentJobClaimTransaction) => Promise<T>) =>
  database.transaction((tx) => run(tx as unknown as LiveAgentJobClaimTransaction));

test("missing require and repeated missing release are categorical successes", async () => {
  await transaction(async (tx) => {
    expect(await helpers.requirePiOpenAiConnectionLeaseWith(tx, owner, now)).toEqual({ outcome: "missing" });
    expect(await helpers.releasePiOpenAiConnectionLeaseWith(tx, owner)).toEqual({ outcome: "released" });
    expect(await helpers.releasePiOpenAiConnectionLeaseWith(tx, owner)).toEqual({ outcome: "released" });
  });
});

for (const offset of [-1, 0, 1]) {
  test(`require uses millisecond expiry boundary (${offset}) without mutation`, async () => {
    await seed(owner, now + offset);
    const before = await rows();
    expect(await transaction((tx) => helpers.requirePiOpenAiConnectionLeaseWith(tx, owner, now)))
      .toEqual({ outcome: offset > 0 ? "valid" : "expired" });
    expect(await rows()).toEqual(before);
  });
  test(`exact release ignores expiry (${offset}), preserves unrelated row, and replays`, async () => {
    await seed(owner, now + offset);
    await seed(other);
    const unrelated = (await rows())[1];
    await transaction(async (tx) => {
      expect(await helpers.releasePiOpenAiConnectionLeaseWith(tx, owner)).toEqual({ outcome: "released" });
      expect(await helpers.releasePiOpenAiConnectionLeaseWith(tx, owner)).toEqual({ outcome: "released" });
      expect(await helpers.requirePiOpenAiConnectionLeaseWith(tx, owner, now)).toEqual({ outcome: "missing" });
    });
    expect(await rows()).toEqual([unrelated]);
  });
}

const mismatches = {
  connectionId: other.connectionId, jobId: other.jobId, workerId: "other-worker",
  claimAttemptId: "other-claim", credentialVersion: "2026-05-01T11:59:00.124Z",
};
for (const expiry of [now - 1, now + 1]) {
  for (const [key, value] of Object.entries(mismatches)) {
    test(`${key} mismatch conflicts before expiry (${expiry}) and cannot release`, async () => {
      await seed(owner, expiry);
      await seed(other, expiry);
      const before = await rows();
      const input = { ...owner, [key]: value };
      await transaction(async (tx) => {
        expect(await helpers.requirePiOpenAiConnectionLeaseWith(tx, input, now)).toEqual({ outcome: "conflict" });
        expect(await helpers.releasePiOpenAiConnectionLeaseWith(tx, input)).toEqual({ outcome: "conflict" });
      });
      expect(await rows()).toEqual(before);
    });
  }
}

const invalidFields: [string, unknown[]][] = [
  ["connectionId", ["", owner.connectionId.toUpperCase(), ` ${owner.connectionId}`, "not-uuid", 1, null,
    { toString: () => owner.connectionId }]],
  ["jobId", ["", owner.jobId.toUpperCase(), `${owner.jobId}\n`, "not-uuid", 1, null]],
  ["workerId", ["", " ", " worker", "worker\t", "x".repeat(256), 1, null]],
  ["claimAttemptId", ["", "\n", " claim", "claim ", "x".repeat(101), 1, null]],
  ["credentialVersion", ["", "invalid", "2026-05-01", "2026-05-01T11:59:00Z",
    "2026-05-01T11:59:00.123000Z", "2026-05-01T11:59:00.123+00:00",
    "2026-02-30T11:59:00.123Z", ` ${owner.credentialVersion}`, "x".repeat(65), 1, null]],
];
for (const [key, values] of invalidFields) {
  for (const value of values) {
    test(`invalid ${key}=${JSON.stringify(value)} executes no SQL`, async () => {
      await seed(owner, now - 1);
      const before = await rows();
      const input = { ...owner, [key]: value } as typeof owner;
      await transaction(async (tx) => {
        queries.length = 0;
        expect(await helpers.requirePiOpenAiConnectionLeaseWith(tx, input, now)).toEqual({ outcome: "invalid" });
        expect(await helpers.releasePiOpenAiConnectionLeaseWith(tx, input)).toEqual({ outcome: "invalid" });
        expect(queries).toEqual([]);
      });
      expect(await rows()).toEqual(before);
    });
  }
}
test("malformed ownership is invalid before missing/replay and performs no SQL", async () => {
  await transaction(async (tx) => {
    queries.length = 0;
    for (const input of [undefined, null, [], {}, "owner", 1]) {
      expect(await helpers.requirePiOpenAiConnectionLeaseWith(tx, input as typeof owner, now))
        .toEqual({ outcome: "invalid" });
      expect(await helpers.releasePiOpenAiConnectionLeaseWith(tx, input as typeof owner))
        .toEqual({ outcome: "invalid" });
    }
    expect(queries).toEqual([]);
  });
});
const maxNow = 8_640_000_000_000_000 - 6 * 60 * 60 * 1000;
for (const value of [NaN, Infinity, -Infinity, 0, -1, 1.5, Number.MAX_SAFE_INTEGER, maxNow + 1, "1", null]) {
  test(`invalid now=${String(value)} executes no SQL even for missing ownership`, async () => {
    await transaction(async (tx) => {
      queries.length = 0;
      expect(await helpers.requirePiOpenAiConnectionLeaseWith(tx, owner, value as number)).toEqual({ outcome: "invalid" });
      expect(queries).toEqual([]);
    });
  });
}
test("maximum exact identifiers and representable now boundaries are accepted", async () => {
  const input = { ...owner, workerId: "w".repeat(255), claimAttemptId: "c".repeat(100) };
  await seed(input);
  await transaction(async (tx) => {
    expect(await helpers.requirePiOpenAiConnectionLeaseWith(tx, input, 1)).toEqual({ outcome: "valid" });
    expect(await helpers.requirePiOpenAiConnectionLeaseWith(tx, input, maxNow)).toEqual({ outcome: "expired" });
    expect(await helpers.releasePiOpenAiConnectionLeaseWith(tx, input)).toEqual({ outcome: "released" });
  });
});

test("both lookups lock only the connection; deletion fences all five exact predicates", async () => {
  await seed();
  await transaction(async (tx) => {
    queries.length = 0;
    await helpers.requirePiOpenAiConnectionLeaseWith(tx, owner, now);
    await helpers.releasePiOpenAiConnectionLeaseWith(tx, owner);
    expect(queries).toHaveLength(3);
    for (const query of queries.slice(0, 2)) {
      expect(query.sql).toMatch(/where "pi_openai_connection_leases"\."connection_id" = \$1 limit \$2 for update$/);
      expect(query.params).toEqual([owner.connectionId, 1]);
    }
    expect(queries[2]?.sql).toBe('delete from "pi_openai_connection_leases" where ("pi_openai_connection_leases"."connection_id" = $1 and "pi_openai_connection_leases"."job_id" = $2 and "pi_openai_connection_leases"."worker_id" = $3 and "pi_openai_connection_leases"."claim_attempt_id" = $4 and "pi_openai_connection_leases"."credential_version" = $5)');
    expect(queries[2]?.params).toEqual(Object.values(owner));
  });
});
test("caller sentinel rolls back release and neither helper owns a transaction", async () => {
  await seed();
  const before = await rows();
  const sentinel = new Error("caller rollback");
  await expect(transaction(async (tx) => {
    expect(await helpers.requirePiOpenAiConnectionLeaseWith(tx, owner, now)).toEqual({ outcome: "valid" });
    expect(await helpers.releasePiOpenAiConnectionLeaseWith(tx, owner)).toEqual({ outcome: "released" });
    expect(await tx.select().from(piOpenaiConnectionLeases)).toEqual([]);
    throw sentinel;
  })).rejects.toBe(sentinel);
  expect(await rows()).toEqual(before);
});
for (const helper of ["requirePiOpenAiConnectionLeaseWith", "releasePiOpenAiConnectionLeaseWith"] as const) {
  test(`${helper} propagates a real database lookup failure`, async () => {
    await expect(transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL search_path TO pg_catalog`);
      return helpers[helper](tx, owner, now);
    })).rejects.toMatchObject({ cause: { code: "42P01" } });
  });
}
test("delete failures propagate and roll back without losing the lease", async () => {
  await seed();
  const before = await rows();
  await expect(transaction(async (tx) => {
    await tx.execute(sql`
      CREATE FUNCTION pg_temp.reject_delete() RETURNS trigger LANGUAGE plpgsql AS
        $$ BEGIN RAISE EXCEPTION 'delete sentinel'; END $$
    `);
    await tx.execute(sql`
      CREATE TRIGGER reject_delete BEFORE DELETE ON pi_openai_connection_leases
        FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_delete()
    `);
    return helpers.releasePiOpenAiConnectionLeaseWith(tx, owner);
  })).rejects.toMatchObject({ cause: { message: "delete sentinel" } });
  expect(await rows()).toEqual(before);
});

type RequireTx = Parameters<typeof helpers.requirePiOpenAiConnectionLeaseWith>[0];
type ReleaseTx = Parameters<typeof helpers.releasePiOpenAiConnectionLeaseWith>[0];
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2) ? true : false;
const preciseRequire: Equal<RequireTx, LiveAgentJobClaimTransaction> = true;
const preciseRelease: Equal<ReleaseTx, LiveAgentJobClaimTransaction> = true;
const notAny: 0 extends (1 & RequireTx) ? false : true = true;
test("TypeScript checks helper callback precision and this focused source pair", () => {
  expect([preciseRequire, preciseRelease, notAny]).toEqual([true, true, true]);
  const files = [import.meta.path, new URL("./pi-openai-connection-lease-repository.ts", import.meta.url).pathname];
  const program = ts.createProgram(files, {
    strict: true, noEmit: true, skipLibCheck: true, esModuleInterop: true,
    target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    types: ["bun"],
    typeRoots: [new URL("../", import.meta.resolve("@types/bun/package.json")).pathname],
  });
  const diagnostics = files.flatMap((file) => {
    const source = program.getSourceFile(file)!;
    return [...program.getSyntacticDiagnostics(source), ...program.getSemanticDiagnostics(source)];
  });
  expect(diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"))).toEqual([]);
});
