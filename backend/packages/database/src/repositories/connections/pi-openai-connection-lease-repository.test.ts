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
    CREATE TABLE provider_connections (
      id uuid PRIMARY KEY, updated_at timestamptz DEFAULT now(),
      provider text, category text, is_active boolean, suspended_at timestamptz,
      scope text, scope_id text, config jsonb
    );
    CREATE TABLE agent_jobs (
      id uuid PRIMARY KEY, status text, workspace_id text,
      created_by_user_id text, resolved_runtime_selection jsonb
    );
  `);
  await client.exec(await Bun.file(new URL("../../../migrations/0237_past_harpoon.sql", import.meta.url)).text());
  for (const input of [owner, other]) {
    await client.query("INSERT INTO provider_connections (id) VALUES ($1)", [input.connectionId]);
    await client.query("INSERT INTO agent_jobs (id) VALUES ($1)", [input.jobId]);
  }
  helpers = await import("./pi-openai-connection-lease-repository");
});
afterAll(() => client.close());
beforeEach(async () => {
  await database.delete(piOpenaiConnectionLeases);
  await client.query(`UPDATE provider_connections SET provider = 'openai', category = 'ai',
    is_active = true, suspended_at = NULL, scope = 'organization', scope_id = 'org-1',
    config = '{"authMethod":"subscription"}', updated_at = $1`, [owner.credentialVersion]);
  await client.exec(`UPDATE agent_jobs SET status = 'queued', workspace_id = 'org-1',
    created_by_user_id = 'user-1', resolved_runtime_selection = NULL`);
});
const seed = (input = owner, expiresAt = now + 1) => database.insert(piOpenaiConnectionLeases).values({
  ...input, credentialVersion: new Date(input.credentialVersion), expiresAt: new Date(expiresAt),
  createdAt: new Date(now - 1000), updatedAt: new Date(now - 1000),
});
const rows = () => database.select().from(piOpenaiConnectionLeases).orderBy(piOpenaiConnectionLeases.connectionId);

// PGlite and postgres-js have distinct driver result types, but execute the same
// Drizzle PostgreSQL builders. The production callback type is checked separately.
const transaction = <T>(run: (tx: LiveAgentJobClaimTransaction) => Promise<T>) =>
  database.transaction((tx) => run(tx as unknown as LiveAgentJobClaimTransaction));

const acquire = (input = owner, at = now) =>
  transaction((tx) => helpers.acquirePiOpenAiConnectionLeaseWith(tx, { ...input, now: at }));
const acquiredRow = (input = owner, at = now) => ({
  ...input, credentialVersion: new Date(input.credentialVersion),
  createdAt: new Date(at), updatedAt: new Date(at), expiresAt: new Date(at + 21_600_000),
});
test("acquire creates an exact owner with a six-hour TTL and caller timestamps", async () => {
  expect(await acquire()).toEqual({ outcome: "acquired" });
  expect(helpers.PI_OPENAI_CONNECTION_LEASE_TTL_MS).toBe(21_600_000);
  expect(await rows()).toEqual([acquiredRow()]);
});

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
        expect(await helpers.acquirePiOpenAiConnectionLeaseWith(tx, { ...input, now })).toEqual({ outcome: "invalid" });
        expect(await helpers.renewPiOpenAiConnectionLeaseWith(tx, { ...input, now })).toEqual({ outcome: "invalid" });
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
      expect(await helpers.acquirePiOpenAiConnectionLeaseWith(tx, input as typeof owner & { now: number }))
        .toEqual({ outcome: "invalid" });
      expect(await helpers.renewPiOpenAiConnectionLeaseWith(tx, input as typeof owner & { now: number }))
        .toEqual({ outcome: "invalid" });
    }
    expect(queries).toEqual([]);
  });
});
const maxNow = 8_640_000_000_000_000 - 6 * 60 * 60 * 1000;
for (const value of [NaN, Infinity, -Infinity, 0, -1, 1.5, Number.MAX_SAFE_INTEGER, maxNow + 1, "1", null, undefined]) {
  test(`invalid now=${String(value)} executes no SQL even for missing ownership`, async () => {
    await transaction(async (tx) => {
      queries.length = 0;
      expect(await helpers.requirePiOpenAiConnectionLeaseWith(tx, owner, value as number)).toEqual({ outcome: "invalid" });
      expect(await helpers.acquirePiOpenAiConnectionLeaseWith(tx, { ...owner, now: value as number }))
        .toEqual({ outcome: "invalid" });
      expect(await helpers.renewPiOpenAiConnectionLeaseWith(tx, { ...owner, now: value as number }))
        .toEqual({ outcome: "invalid" });
      expect(queries).toEqual([]);
    });
  });
}
for (const at of [1, Date.parse("9999-12-31T23:00:00.000Z"), maxNow]) {
  test(`acquire succeeds at valid now boundary ${at} with exact timestamps`, async () => {
    expect(await acquire(owner, at)).toEqual({ outcome: "acquired" });
    expect(await rows()).toEqual([acquiredRow(owner, at)]);
    expect(await acquire(owner, at)).toEqual({ outcome: "idempotent" });
    expect(await rows()).toEqual([acquiredRow(owner, at)]);
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

for (const offset of [-1, 0, 1]) {
  test(`acquire refreshes exact owner even at expired boundary ${offset}`, async () => {
    await seed(owner, now + offset);
    const [before] = await rows();
    expect(await acquire()).toEqual({ outcome: "idempotent" });
    expect(await rows()).toEqual([{ ...acquiredRow(), createdAt: before!.createdAt }]);
  });
  for (const [key, value] of Object.entries(mismatches).filter(([key]) => key !== "connectionId")) {
    test(`acquire fences/replaces ${key} at expiry ${offset}`, async () => {
      await seed({ ...owner, [key]: value }, now + offset);
      const before = await rows();
      expect(await acquire()).toEqual({ outcome: offset > 0 ? "conflict" : "acquired" });
      expect(await rows()).toEqual(offset > 0 ? before : [acquiredRow()]);
    });
  }
}
const missingId = "eeeeeeee-1111-4111-8111-111111111111";
for (const [key, outcome, count] of [
  ["jobId", "invalid", 1], ["connectionId", "connection_ineligible", 2],
] as const) {
  test(`acquire stops after missing ${key}`, async () => {
    await transaction(async (tx) => {
      queries.length = 0;
      expect(await helpers.acquirePiOpenAiConnectionLeaseWith(tx, { ...owner, [key]: missingId, now }))
        .toEqual({ outcome });
      expect(queries).toHaveLength(count);
    });
    expect(await rows()).toEqual([]);
  });
}
const eligibility: [string, unknown, "connection_ineligible" | "credential_version_conflict"][] = [
  ["provider", "anthropic", "connection_ineligible"], ["provider", "OpenAI", "connection_ineligible"],
  ["category", "storage", "connection_ineligible"], ["category", "AI", "connection_ineligible"],
  ["is_active", false, "connection_ineligible"], ["suspended_at", new Date(now), "connection_ineligible"],
  ["scope", "project", "connection_ineligible"], ["scope", "Organization", "connection_ineligible"],
  ["updated_at", "2026-05-01T11:59:00.124Z", "credential_version_conflict"],
  ...[null, [], "subscription", {}, { authMethod: "api_key" }, { authMethod: "OAuth" },
    { authMethod: true }].map((config): [string, unknown, "connection_ineligible"] =>
      ["config", JSON.stringify(config), "connection_ineligible"]),
];
for (const [column, value, outcome] of eligibility) {
  test(`acquire rejects ${column}=${JSON.stringify(value)} without touching the lease`, async () => {
    await seed();
    const before = await rows();
    await client.query(`UPDATE provider_connections SET ${column} = $1 WHERE id = $2`, [value, owner.connectionId]);
    await transaction(async (tx) => {
      queries.length = 0;
      expect(await helpers.acquirePiOpenAiConnectionLeaseWith(tx, { ...owner, now })).toEqual({ outcome });
      expect(queries).toHaveLength(2);
    });
    expect(await rows()).toEqual(before);
  });
}
test("credential version conflict precedes invalid scope without touching the lease", async () => {
  await seed();
  const before = await rows();
  await client.query("UPDATE provider_connections SET scope = 'project', updated_at = $1 WHERE id = $2",
    ["2026-05-01T11:59:00.124Z", owner.connectionId]);
  await transaction(async (tx) => {
    queries.length = 0;
    expect(await helpers.acquirePiOpenAiConnectionLeaseWith(tx, { ...owner, now }))
      .toEqual({ outcome: "credential_version_conflict" });
    expect(queries).toHaveLength(2);
  });
  expect(await rows()).toEqual(before);
});
const generic = { codingAgent: "codex", aiProvider: "openai", authClass: "subscription" };
const selections: [unknown, boolean][] = [
  [generic, true], [{ ...generic, codingAgent: "claude-code" }, true],
  [{ ...generic, codingAgent: "opencode" }, true], [{ ...generic, codingAgent: "pi" }, false],
  ...[null, {}, [], [generic], "openai", 1, true].map((value): [unknown, boolean] => [value, false]),
  ...[undefined, null, "", "other", "Pi", " pi", 1, true, [], ["pi"], {}, { agent: "pi" }]
    .map((codingAgent): [unknown, boolean] => [{ ...generic, codingAgent }, true]),
  ...["aiProvider", "authClass"].flatMap((key) =>
    [undefined, null, {}, [], 1, "other"].map((value): [unknown, boolean] => [{ ...generic, [key]: value }, false])),
  [{ ...generic, aiProvider: "anthropic" }, false], [{ ...generic, authClass: "api_key" }, false],
];
for (const scope of ["organization", "user"]) {
  for (const status of ["running", "finalizing", "waiting_for_input", "queued", "paused", "completed", "failed", "cancelled"]) {
    test(`acquire generic-job scope/status exclusion: ${scope}/${status}`, async () => {
      await client.query("UPDATE provider_connections SET scope = $1, scope_id = $2, config = $3", [
        scope, scope === "organization" ? "org-1" : "user-1", '{"authMethod":"oauth"}',
      ]);
      await client.query("UPDATE agent_jobs SET status = $1, resolved_runtime_selection = $2", [status, JSON.stringify(generic)]);
      expect(await acquire()).toEqual({
        outcome: ["running", "finalizing", "waiting_for_input"].includes(status) ? "conflict" : "acquired",
      });
    });
  }
  for (const [selection, conflict] of selections) {
    test(`acquire runtime exclusion: ${scope}/${JSON.stringify(selection)}`, async () => {
      await client.query("UPDATE provider_connections SET scope = $1, scope_id = $2", [scope, scope === "organization" ? "org-1" : "user-1"]);
      await client.query("UPDATE agent_jobs SET status = 'running', resolved_runtime_selection = $1 WHERE id = $2",
        [JSON.stringify(selection), other.jobId]);
      if (conflict) await seed(owner, now - 1);
      const before = await rows();
      await transaction(async (tx) => {
        queries.length = 0;
        expect(await helpers.acquirePiOpenAiConnectionLeaseWith(tx, { ...owner, now }))
          .toEqual({ outcome: conflict ? "conflict" : "acquired" });
        expect(queries[2]!.params).toEqual([
          owner.jobId, "running", "finalizing", "waiting_for_input", scope === "organization" ? "org-1" : "user-1", 1,
        ]);
      });
      expect(await rows()).toEqual(conflict ? before : [acquiredRow()]);
    });
  }
  for (const column of ["workspace_id", "created_by_user_id"]) {
    test(`acquire uses only ${scope}'s relevant scope column: ${column}`, async () => {
      await client.query("UPDATE provider_connections SET scope = $1, scope_id = $2", [scope, scope === "organization" ? "org-1" : "user-1"]);
      await client.query(`UPDATE agent_jobs SET status = 'running', ${column} = 'unrelated', resolved_runtime_selection = $1`, [JSON.stringify(generic)]);
      const relevant = scope === "organization" ? "workspace_id" : "created_by_user_id";
      expect(await acquire()).toEqual({ outcome: column === relevant ? "acquired" : "conflict" });
    });
  }
}
test("acquire excludes itself even with a generic subscription selection", async () => {
  await client.query("UPDATE agent_jobs SET status = 'running', resolved_runtime_selection = $1 WHERE id = $2", [JSON.stringify(generic), owner.jobId]);
  expect(await acquire()).toEqual({ outcome: "acquired" });
});
test("acquire reports job uniqueness categorically and caller can roll back replacement", async () => {
  await seed(owner);
  await seed(other, now);
  const before = await rows();
  const sentinel = new Error("caller rollback after conflict");
  await expect(transaction(async (tx) => {
    expect(await helpers.acquirePiOpenAiConnectionLeaseWith(tx, { ...owner, connectionId: other.connectionId, now }))
      .toEqual({ outcome: "conflict" });
    expect(await tx.select().from(piOpenaiConnectionLeases)).toEqual([before[0]!]);
    throw sentinel;
  })).rejects.toBe(sentinel);
  expect(await rows()).toEqual(before);
  expect(await acquire({ ...other, connectionId: owner.connectionId })).toEqual({ outcome: "conflict" });
});
test("acquire locks job -> connection -> lease, projects no credentials, and fences updates", async () => {
  await transaction(async (tx) => {
    queries.length = 0;
    await helpers.acquirePiOpenAiConnectionLeaseWith(tx, { ...owner, now });
    expect(queries).toHaveLength(5);
    for (const [index, table, id] of [[0, "agent_jobs", owner.jobId], [1, "provider_connections", owner.connectionId], [3, "pi_openai_connection_leases", owner.connectionId]] as const) {
      expect(queries[index]!.sql).toContain(`from "${table}" where "${table}".`);
      expect(queries[index]!.sql).toMatch(/= \$1 limit \$2 for update$/);
      expect(queries[index]!.params).toEqual([id, 1]);
    }
    expect(queries[1]!.sql).not.toMatch(/credential|token|account_identifier|select \*/i);
    expect(queries[2]!.sql).toContain('"agent_jobs"."id" <>');
    expect(queries[2]!.sql).toContain("->> 'codingAgent' IS DISTINCT FROM 'pi'");
    expect(queries[2]!.params).toEqual([owner.jobId, "running", "finalizing", "waiting_for_input", "org-1", 1]);
    expect(queries[4]!.sql).toContain("on conflict do nothing returning");
    queries.length = 0;
    await helpers.acquirePiOpenAiConnectionLeaseWith(tx, { ...owner, now: now + 1 });
    const update = queries[4]!;
    expect(update.sql.split(" where ")[1]).toBe('(\"pi_openai_connection_leases\".\"connection_id\" = $3 and \"pi_openai_connection_leases\".\"job_id\" = $4 and \"pi_openai_connection_leases\".\"worker_id\" = $5 and \"pi_openai_connection_leases\".\"claim_attempt_id\" = $6 and \"pi_openai_connection_leases\".\"credential_version\" = $7)');
    expect(update.params).toEqual([new Date(now + 21_600_001).toISOString(), new Date(now + 1).toISOString(), ...Object.values(owner)]);
  });
});
for (const [operation, workerId] of [["INSERT", null], ["INSERT", "old"], ["UPDATE", owner.workerId], ["DELETE", "old"]] as const) {
  test(`acquire propagates ${operation} errors with caller rollback (previous worker: ${workerId})`, async () => {
    if (workerId) await seed({ ...owner, workerId }, now);
    const before = await rows();
    await expect(transaction(async (tx) => {
      await tx.execute(sql`CREATE FUNCTION pg_temp.reject_acquire() RETURNS trigger LANGUAGE plpgsql AS
        $$ BEGIN RAISE EXCEPTION 'acquire sentinel'; END $$`);
      await tx.execute(sql.raw(`CREATE TRIGGER reject_acquire BEFORE ${operation} ON pi_openai_connection_leases
        FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_acquire()`));
      return helpers.acquirePiOpenAiConnectionLeaseWith(tx, { ...owner, now });
    })).rejects.toMatchObject({ cause: { message: "acquire sentinel" } });
    expect(await rows()).toEqual(before);
  });
}
test("acquire propagates lookup errors and caller sentinel rolls back successful insertion", async () => {
  await expect(transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL search_path TO pg_catalog`);
    return helpers.acquirePiOpenAiConnectionLeaseWith(tx, { ...owner, now });
  })).rejects.toMatchObject({ cause: { code: "42P01" } });
  const sentinel = new Error("caller rollback");
  await expect(transaction(async (tx) => {
    expect(await helpers.acquirePiOpenAiConnectionLeaseWith(tx, { ...owner, now })).toEqual({ outcome: "acquired" });
    throw sentinel;
  })).rejects.toBe(sentinel);
  expect(await rows()).toEqual([]);
});

test("acquire cannot insert the same job on a second empty connection", async () => {
  await seed(owner);
  const before = await rows();
  expect(await acquire({ ...owner, connectionId: other.connectionId })).toEqual({ outcome: "conflict" });
  expect(await rows()).toEqual(before);
});
for (const workerId of [owner.workerId, "replacement"]) {
  test(`caller rollback restores ${workerId} refresh/replacement and preserves unrelated lease`, async () => {
    await seed(owner, now);
    await seed(other);
    const before = await rows();
    const sentinel = new Error("caller rollback");
    await expect(transaction(async (tx) => {
      queries.length = 0;
      const input = { ...owner, workerId, now };
      const exact = workerId === owner.workerId;
      expect(await helpers.acquirePiOpenAiConnectionLeaseWith(tx, input)).toEqual({ outcome: exact ? "idempotent" : "acquired" });
      if (!exact) {
        expect(queries[4]!.sql).toBe('delete from "pi_openai_connection_leases" where "pi_openai_connection_leases"."connection_id" = $1');
        expect(queries[4]!.params).toEqual([owner.connectionId]);
        expect(queries[5]!.sql).toStartWith('insert into "pi_openai_connection_leases"');
      }
      expect(await tx.select().from(piOpenaiConnectionLeases).orderBy(piOpenaiConnectionLeases.connectionId)).toEqual([
        { ...acquiredRow({ ...owner, workerId }), createdAt: exact ? before[0]!.createdAt : new Date(now) }, before[1]!,
      ]);
      throw sentinel;
    })).rejects.toBe(sentinel);
    expect(await rows()).toEqual(before);
  });
}
test("acquire handles a connection-unique insert collision without aborting the caller", async () => {
  const sentinel = new Error("rollback collision fixture");
  await expect(transaction(async (tx) => {
    // Insert a competing connection owner at the SQL insertion boundary, not a mocked result.
    await tx.execute(sql.raw(`CREATE FUNCTION pg_temp.collide_connection() RETURNS trigger LANGUAGE plpgsql AS
      $$ BEGIN
        IF pg_trigger_depth() = 1 THEN
          INSERT INTO pi_openai_connection_leases VALUES
            (NEW.connection_id, '${other.jobId}', NEW.worker_id, NEW.claim_attempt_id,
             NEW.credential_version, NEW.expires_at, NEW.created_at, NEW.updated_at);
        END IF;
        RETURN NEW;
      END $$`));
    await tx.execute(sql`CREATE TRIGGER collide_connection BEFORE INSERT ON pi_openai_connection_leases
      FOR EACH ROW EXECUTE FUNCTION pg_temp.collide_connection()`);
    expect(await helpers.acquirePiOpenAiConnectionLeaseWith(tx, { ...owner, now })).toEqual({ outcome: "conflict" });
    expect(await tx.select().from(piOpenaiConnectionLeases)).toEqual([acquiredRow({ ...owner, jobId: other.jobId })]);
    throw sentinel;
  })).rejects.toBe(sentinel);
  expect(await rows()).toEqual([]);
});
test("acquire uses normalized millisecond authority and accepts maximal exact identifiers", async () => {
  await client.query("UPDATE provider_connections SET updated_at = $1", ["2026-05-01T11:59:00.123789Z"]);
  expect(await acquire()).toEqual({ outcome: "credential_version_conflict" });
  const input = { ...owner, credentialVersion: "2026-05-01T11:59:00.124Z", workerId: "w".repeat(255), claimAttemptId: "c".repeat(100) };
  expect(await acquire(input)).toEqual({ outcome: "acquired" });
  expect(await acquire(input, now + 1)).toEqual({ outcome: "idempotent" });
  const equality = await client.query<{ exact: boolean }>(`SELECT p.updated_at = l.credential_version AS exact
    FROM provider_connections p JOIN pi_openai_connection_leases l ON p.id = l.connection_id`);
  expect(equality.rows).toEqual([{ exact: true }]);
  expect(await rows()).toEqual([{ ...acquiredRow(input, now + 1), createdAt: new Date(now) }]);
});

const renew = (input = owner, at = now) =>
  transaction((tx) => helpers.renewPiOpenAiConnectionLeaseWith(tx, { ...input, now: at }));
test("renew extends the exact active owner, preserving createdAt and unrelated leases", async () => {
  await seed();
  await seed(other);
  const before = await rows();
  expect(await renew()).toEqual({ outcome: "renewed" });
  expect(await rows()).toEqual([
    { ...acquiredRow(), createdAt: before[0]!.createdAt }, before[1]!,
  ]);
});

for (const offset of [-1, 0, 1]) {
  test(`renew exact expiry boundary ${offset} never revives an expired lease`, async () => {
    await seed(owner, now + offset);
    const before = await rows();
    expect(await renew()).toEqual({ outcome: offset > 0 ? "renewed" : "expired" });
    expect(await rows()).toEqual(offset > 0 ? [{ ...acquiredRow(), createdAt: before[0]!.createdAt }] : before);
  });
  for (const [key, value] of Object.entries(mismatches)) {
    test(`renew ${key} mismatch precedes expiry ${offset}`, async () => {
      await seed(owner, now + offset);
      await seed(other, now + offset);
      const input = { ...owner, [key]: value };
      // Match connection authority so a lease-version mismatch reaches the lease fence.
      await client.query("UPDATE provider_connections SET updated_at = $1", [input.credentialVersion]);
      const before = await rows();
      expect(await renew(input)).toEqual({ outcome: "conflict" });
      expect(await rows()).toEqual(before);
    });
  }
}
for (const [input, outcome, count] of [
  [{ ...owner, jobId: missingId, connectionId: missingId }, "invalid", 1],
  [{ ...owner, connectionId: missingId }, "connection_ineligible", 2],
  [owner, "missing", 3],
] as const) {
  test(`renew stops at ${outcome} with ${count} locks and no mutation`, async () => {
    await transaction(async (tx) => {
      queries.length = 0;
      expect(await helpers.renewPiOpenAiConnectionLeaseWith(tx, { ...input, now })).toEqual({ outcome });
      expect(queries).toHaveLength(count);
      expect(queries.every((query) => query.sql.endsWith("for update"))).toBe(true);
    });
    expect(await rows()).toEqual([]);
  });
}
const renewEligibility = eligibility.filter(([column]) => column !== "scope").concat([
  ["is_active", null, "connection_ineligible"], ["config", null, "connection_ineligible"],
]);
for (const [column, value, outcome] of renewEligibility) {
  for (const state of ["missing", "expired", "mismatch"] as const) {
    test(`renew ${column}=${JSON.stringify(value)} precedes ${state} lease and version conflict`, async () => {
      if (state !== "missing") await seed(state === "mismatch" ? { ...owner, workerId: "other" } : owner, now);
      const before = await rows();
      await client.query(`UPDATE provider_connections SET ${column} = $1 WHERE id = $2`, [value, owner.connectionId]);
      // Every ineligibility must win even when the credential version is also stale.
      await client.query("UPDATE provider_connections SET updated_at = $1", [mismatches.credentialVersion]);
      await transaction(async (tx) => {
        queries.length = 0;
        expect(await helpers.renewPiOpenAiConnectionLeaseWith(tx, { ...owner, now })).toEqual({ outcome });
        expect(queries).toHaveLength(2);
      });
      expect(await rows()).toEqual(before);
    });
  }
}
for (const authMethod of ["subscription", "oauth"]) {
  for (const scope of ["organization", "user", "project", null]) {
    test(`renew accepts ${authMethod}/${scope} without scope checks or generic-job queries`, async () => {
      await seed();
      await client.query("UPDATE provider_connections SET scope = $1, config = $2", [scope, JSON.stringify({ authMethod })]);
      await client.query("UPDATE agent_jobs SET status = 'running', resolved_runtime_selection = $1", [JSON.stringify(generic)]);
      await transaction(async (tx) => {
        queries.length = 0;
        expect(await helpers.renewPiOpenAiConnectionLeaseWith(tx, { ...owner, now })).toEqual({ outcome: "renewed" });
        expect(queries).toHaveLength(4);
        for (const [index, table, column, id] of [
          [0, "agent_jobs", "id", owner.jobId], [1, "provider_connections", "id", owner.connectionId],
          [2, "pi_openai_connection_leases", "connection_id", owner.connectionId],
        ] as const) {
          expect(queries[index]!.sql).toContain(`from "${table}" where "${table}"."${column}" = $1 limit $2 for update`);
          expect(queries[index]!.params).toEqual([id, 1]);
        }
        expect(queries.filter((query) => query.sql.includes('from "agent_jobs"'))).toHaveLength(1);
        expect(queries[1]!.sql).not.toMatch(/scope|credential|token|account_identifier|select \*/i);
        expect(queries.map((query) => query.sql).join("\n")).not.toMatch(/resolved_runtime_selection|status|workspace_id|created_by_user_id/);
        expect(queries[3]!.sql).toBe('update "pi_openai_connection_leases" set "expires_at" = $1, "updated_at" = $2 where ("pi_openai_connection_leases"."connection_id" = $3 and "pi_openai_connection_leases"."job_id" = $4 and "pi_openai_connection_leases"."worker_id" = $5 and "pi_openai_connection_leases"."claim_attempt_id" = $6 and "pi_openai_connection_leases"."credential_version" = $7)');
        expect(queries[3]!.params).toEqual([new Date(now + 21_600_000).toISOString(), new Date(now).toISOString(), ...Object.values(owner)]);
      });
    });
  }
}
for (const at of [1, Date.parse("9999-12-31T23:00:00.000Z"), Date.parse("+010000-01-01T00:00:00.000Z"), maxNow]) {
  test(`renew supports now=${at} with parameterized extended years and exact timestamps`, async () => {
    const input = { ...owner, workerId: "w".repeat(255), claimAttemptId: "c".repeat(100) };
    await seed(input);
    // Seed independently of acquire/renew's timestamp normalization.
    await client.query("UPDATE pi_openai_connection_leases SET expires_at = $1", [new Date(at + 1).toISOString().replace(/^\+/, "")]);
    const [before] = await rows();
    await transaction(async (tx) => {
      queries.length = 0;
      expect(await helpers.renewPiOpenAiConnectionLeaseWith(tx, { ...input, now: at })).toEqual({ outcome: "renewed" });
      const update = queries[3]!;
      expect(update.params).toEqual([
        new Date(at + 21_600_000).toISOString().replace(/^\+/, ""), new Date(at).toISOString().replace(/^\+/, ""), ...Object.values(input),
      ]);
      for (const [index, time] of [at + 21_600_000, at].entries()) {
        const extended = new Date(time).getUTCFullYear() > 9999;
        expect(update.sql.includes(`$${index + 1}::timestamptz`)).toBe(extended);
        expect(update.sql).not.toContain(String(update.params[index]));
      }
    });
    expect(await rows()).toEqual([{ ...acquiredRow(input, at), createdAt: before!.createdAt }]);
  });
}
test("renew propagates lookup and update failures; caller rollback restores successful renewal", async () => {
  await seed();
  await seed(other);
  const before = await rows();
  await expect(transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL search_path TO pg_catalog`);
    return helpers.renewPiOpenAiConnectionLeaseWith(tx, { ...owner, now });
  })).rejects.toMatchObject({ cause: { code: "42P01" } });
  await expect(transaction(async (tx) => {
    await tx.execute(sql`CREATE FUNCTION pg_temp.reject_renew() RETURNS trigger LANGUAGE plpgsql AS
      $$ BEGIN RAISE EXCEPTION 'renew sentinel'; END $$`);
    await tx.execute(sql`CREATE TRIGGER reject_renew BEFORE UPDATE ON pi_openai_connection_leases
      FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_renew()`);
    return helpers.renewPiOpenAiConnectionLeaseWith(tx, { ...owner, now });
  })).rejects.toMatchObject({ cause: { message: "renew sentinel" } });
  expect(await rows()).toEqual(before);
  const sentinel = new Error("caller rollback renewal");
  await expect(transaction(async (tx) => {
    queries.length = 0;
    expect(await helpers.renewPiOpenAiConnectionLeaseWith(tx, { ...owner, now })).toEqual({ outcome: "renewed" });
    expect(queries.some((query) => /begin|commit|rollback|savepoint/i.test(query.sql))).toBe(false);
    expect(await tx.select().from(piOpenaiConnectionLeases).orderBy(piOpenaiConnectionLeases.connectionId))
      .toEqual([{ ...acquiredRow(), createdAt: before[0]!.createdAt }, before[1]!]);
    throw sentinel;
  })).rejects.toBe(sentinel);
  expect(await rows()).toEqual(before);
});

type RenewTx = Parameters<typeof helpers.renewPiOpenAiConnectionLeaseWith>[0];
const preciseRenew: Equal<RenewTx, LiveAgentJobClaimTransaction> = true;
const renewNotAny: 0 extends (1 & RenewTx) ? false : true = true;
const preciseRenewResult: Equal<Awaited<ReturnType<typeof helpers.renewPiOpenAiConnectionLeaseWith>>,
  import("./pi-openai-connection-lease-repository").PiOpenAiConnectionLeaseRenewResult> = true;
type AcquireTx = Parameters<typeof helpers.acquirePiOpenAiConnectionLeaseWith>[0];
const preciseAcquire: Equal<AcquireTx, LiveAgentJobClaimTransaction> = true;
type RequireTx = Parameters<typeof helpers.requirePiOpenAiConnectionLeaseWith>[0];
type ReleaseTx = Parameters<typeof helpers.releasePiOpenAiConnectionLeaseWith>[0];
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2) ? true : false;
const preciseRequire: Equal<RequireTx, LiveAgentJobClaimTransaction> = true;
const preciseRelease: Equal<ReleaseTx, LiveAgentJobClaimTransaction> = true;
const notAny: 0 extends (1 & RequireTx) ? false : true = true;
test("TypeScript checks helper callback precision and this focused source pair", () => {
  expect([preciseAcquire, preciseRequire, preciseRelease, notAny]).toEqual([true, true, true, true]);
  expect([preciseRenew, renewNotAny, preciseRenewResult]).toEqual([true, true, true]);
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
