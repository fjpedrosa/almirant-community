import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock, setSystemTime } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { providerConnections, piOpenaiConnectionLeases } from "../../schema";

type ConnectionRepository = typeof import("./connection-repository");

const realClient = { ...(await import("../../client")) };

let client: PGlite;
let repository: ConnectionRepository;
let deriveConnectionAuthClass: ConnectionRepository["deriveConnectionAuthClass"];
let getConnectionMetadataById: ConnectionRepository["getConnectionMetadataById"];

beforeAll(async () => {
  client = new PGlite();
  await client.exec(`
    CREATE TABLE provider_connections (
      id uuid PRIMARY KEY,
      provider varchar(50) NOT NULL,
      category varchar(50) NOT NULL,
      scope varchar(50) NOT NULL,
      scope_id text NOT NULL,
      created_by_user_id text,
      name varchar(255) NOT NULL,
      account_identifier varchar(255),
      is_active boolean NOT NULL DEFAULT true,
      is_default boolean NOT NULL DEFAULT false,
      orchestration_enabled boolean NOT NULL DEFAULT false,
      priority integer NOT NULL DEFAULT 0,
      last_used_at timestamptz,
      suspended_at timestamptz,
      token_expires_at timestamptz,
      last_validated_at timestamptz,
      last_validation_status text,
      last_validation_error text,
      encrypted_credentials text,
      credentials_iv text,
      credentials_auth_tag text,
      config jsonb DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  // Only the FK identity is needed here; this fixture does not model job admission.
  await client.exec("CREATE TABLE agent_jobs (id uuid PRIMARY KEY)");
  await client.exec(await Bun.file(new URL(
    "../../../migrations/0237_past_harpoon.sql", import.meta.url,
  )).text());

  mock.module("../../client", () => ({ db: drizzle(client) }));
  repository = await import("./connection-repository");
  ({ deriveConnectionAuthClass, getConnectionMetadataById } = repository);
});

afterAll(async () => {
  mock.module("../../client", () => realClient);
  await client.close();
});

beforeEach(async () => {
  await client.exec("TRUNCATE TABLE pi_openai_connection_leases, provider_connections, agent_jobs");
});

describe("generic credential reader lease fence", () => {
  const now = Date.parse("2026-05-01T12:00:00.000Z");
  const id = "aaaaaaaa-1111-4111-8111-111111111111";
  const fallbackId = "bbbbbbbb-1111-4111-8111-111111111111";
  const lastId = "cccccccc-1111-4111-8111-111111111111";
  const jobId = "dddddddd-1111-4111-8111-111111111111";
  const otherJobId = "eeeeeeee-1111-4111-8111-111111111111";
  const scope = { scope: "user", scopeId: "user-1" } as const;
  const version = new Date(now - 1000);
  const encryptionKey = "ab".repeat(32);
  const credentials = { apiKey: "test-only-credential" };
  type Connection = typeof providerConnections.$inferSelect;
  const ids = (row: Connection | null) => row ? [row.id] : [];
  const readers = [
    {
      name: "findActiveConnection",
      read: async (provider = "openai") => ids(await repository.findActiveConnection(
        provider as Connection["provider"], scope.scope, scope.scopeId,
      )),
    },
    {
      name: "findActiveConnections",
      read: async (provider = "openai") => (await repository.findActiveConnections(
        provider as Connection["provider"], scope.scope, scope.scopeId,
      )).map((row) => row.id),
    },
    {
      name: "getAiProviderKeyById",
      read: async () => ids(await repository.getAiProviderKeyById(id, scope)),
    },
    {
      name: "getOAuthAiKeyByUserAndProvider",
      read: async (provider = "openai") => ids(await repository.getOAuthAiKeyByUserAndProvider(
        scope.scopeId, provider,
      )),
    },
    {
      name: "getLatestActiveAiKeyByProvider",
      read: async (provider = "openai") => ids(await repository.getLatestActiveAiKeyByProvider(provider)),
    },
  ];
  const seedConnection = (overrides: Partial<typeof providerConnections.$inferInsert> = {}) =>
    drizzle(client).insert(providerConnections).values({
      id, provider: "openai", category: "ai", ...scope,
      createdByUserId: scope.scopeId, name: "Eligible connection",
      config: { authMethod: "oauth" }, updatedAt: version, createdAt: version,
      ...repository.encryptCredentials(credentials, encryptionKey), ...overrides,
    });
  const seedLease = (offset: number, overrides: Partial<typeof piOpenaiConnectionLeases.$inferInsert> = {}) =>
    drizzle(client).insert(piOpenaiConnectionLeases).values({
      connectionId: id, jobId, workerId: "worker-1", claimAttemptId: "claim-1",
      credentialVersion: version, expiresAt: new Date(now + offset),
      createdAt: version, updatedAt: version, ...overrides,
    });

  beforeEach(async () => {
    setSystemTime(new Date(now));
    await client.query("INSERT INTO agent_jobs (id) VALUES ($1), ($2)", [jobId, otherJobId]);
  });
  afterEach(() => setSystemTime());

  for (const reader of readers) {
    describe(reader.name, () => {
      it.each([null, -1, 0, 1])("uses application-time expiry boundary: %p ms", async (offset) => {
        await seedConnection();
        if (offset !== null) await seedLease(offset);
        expect(await reader.read()).toEqual(offset === 1 ? [] : [id]);
      });

      it.each([
        { jobId: otherJobId, workerId: "other-worker", claimAttemptId: "other-claim" },
        { credentialVersion: new Date(now - 2000) },
      ])("does not bypass an active lease for ownership/version mismatch: %p", async (overrides) => {
        await seedConnection();
        await seedLease(1, overrides);
        expect(await reader.read()).toEqual([]);
      });

      it("correlates by connection ID, not by presence of any active lease", async () => {
        await seedConnection();
        await seedConnection({ id: fallbackId, provider: "anthropic" });
        await seedLease(1, { connectionId: fallbackId });
        expect(await reader.read()).toEqual([id]);
      });

      it("keeps suspension excluded after the lease expires and is removed", async () => {
        await seedConnection({ suspendedAt: version });
        await seedLease(-1);
        expect(await reader.read()).toEqual([]);
        await drizzle(client).delete(piOpenaiConnectionLeases).where(eq(piOpenaiConnectionLeases.connectionId, id));
        expect(await reader.read()).toEqual([]);
      });

      it("keeps inactive connections excluded without a lease", async () => {
        await seedConnection({ isActive: false });
        expect(await reader.read()).toEqual([]);
      });

      it.each([
        ["openai", "api_key"], ["anthropic", "api_key"], ["anthropic", "oauth"],
      ] as const)("preserves non-leased %s/%s behavior", async (provider, authMethod) => {
        await seedConnection({ provider, config: { authMethod } });
        const oauthOnly = reader.name === "getOAuthAiKeyByUserAndProvider";
        expect(await reader.read(provider)).toEqual(oauthOnly && authMethod !== "oauth" ? [] : [id]);
      });
    });
  }

  for (const reader of readers.filter((entry) => entry.name !== "getAiProviderKeyById")) {
    it(`${reader.name} filters before ordering/limit and falls back to the next eligible row`, async () => {
      await seedConnection({ priority: 0, isDefault: true });
      await seedConnection({ id: fallbackId, priority: 1, updatedAt: new Date(now - 2000) });
      await seedConnection({ id: lastId, priority: 2, updatedAt: new Date(now - 3000) });
      await seedLease(1);
      expect(await reader.read()).toEqual(
        reader.name === "findActiveConnections" ? [fallbackId, lastId] : [fallbackId],
      );
    });
  }

  it("preserves priority, default and updatedAt list tie-breaks after exclusion", async () => {
    const newestId = "ffffffff-1111-4111-8111-111111111111";
    await seedConnection({ priority: 0 });
    await seedConnection({ id: fallbackId, priority: 1, isDefault: true, updatedAt: new Date(now - 3000) });
    await seedConnection({ id: lastId, priority: 1, updatedAt: new Date(now - 2000) });
    await seedConnection({ id: newestId, priority: 1 });
    await seedLease(1);
    expect((await repository.findActiveConnections("openai", "user", "user-1")).map((row) => row.id))
      .toEqual([fallbackId, newestId, lastId]);
    expect((await repository.findActiveConnection("openai", "user", "user-1"))?.id).toBe(fallbackId);
  });

  it("retains user/provider/category/auth filters for OAuth and latest readers", async () => {
    await seedConnection();
    await seedConnection({ id: fallbackId, provider: "anthropic", updatedAt: new Date(now) });
    await seedConnection({ id: lastId, category: "code", updatedAt: new Date(now) });
    expect((await repository.getOAuthAiKeyByUserAndProvider("user-1", "openai"))?.id).toBe(id);
    expect((await repository.getLatestActiveAiKeyByProvider("openai"))?.id).toBe(id);
    await drizzle(client).update(providerConnections).set({ config: { authMethod: "api_key" } })
      .where(eq(providerConnections.id, id));
    expect(await repository.getOAuthAiKeyByUserAndProvider("user-1", "openai")).toBeNull();
    await drizzle(client).update(providerConnections).set({ config: { authMethod: "oauth" }, scopeId: "other-user" })
      .where(eq(providerConnections.id, id));
    expect(await repository.getOAuthAiKeyByUserAndProvider("user-1", "openai")).toBeNull();
    // The deprecated global fallback intentionally remains cross-user.
    expect((await repository.getLatestActiveAiKeyByProvider("openai"))?.id).toBe(id);
  });

  it.each(["openai-compatible", "openai_compatible"])("retains the %s provider alias", async (alias) => {
    await seedConnection({ provider: "zai" });
    expect((await repository.getOAuthAiKeyByUserAndProvider("user-1", alias))?.id).toBe(id);
    expect((await repository.getLatestActiveAiKeyByProvider(alias))?.id).toBe(id);
  });

  it.each([
    { scope: "organization", scopeId: "user-1" },
    { scope: "user", scopeId: "other-user" },
  ] as const)("retains exact scope filtering: %p", async (wrongScope) => {
    await seedConnection();
    expect(await repository.getAiProviderKeyById(id, wrongScope)).toBeNull();
    expect(await repository.findActiveConnection("openai", wrongScope.scope, wrongScope.scopeId)).toBeNull();
    expect(await repository.findActiveConnections("openai", wrongScope.scope, wrongScope.scopeId)).toEqual([]);
  });

  it("fences the unscoped AI ID lookup without changing its scope-free contract", async () => {
    await seedConnection();
    expect((await repository.getAiProviderKeyById(id))?.id).toBe(id);
    await seedLease(1);
    expect(await repository.getAiProviderKeyById(id)).toBeNull();
  });

  it("keeps keyed getConnectionById as an explicit administrative read, even while leased", async () => {
    await seedConnection();
    await seedLease(1);
    const row = await repository.getConnectionById(id, encryptionKey, scope);
    expect(row).toMatchObject({ id, credentials });
    expect(row?.encryptedCredentials).toBeString();
    expect(await repository.getConnectionById(id, encryptionKey, { ...scope, scopeId: "other-user" })).toBeNull();
    const metadata = await repository.getConnectionMetadataById(id, scope);
    expect(metadata?.id).toBe(id);
    expect(metadata).not.toHaveProperty("encryptedCredentials");
  });
});

describe("deriveConnectionAuthClass", () => {
  it.each([
    ["api_key", "api_key"],
    ["setup_token", "setup_token"],
    ["oauth", "provider_oauth"],
    ["provider_oauth", "provider_oauth"],
    ["subscription", "subscription"],
  ] as const)("maps %s to %s", (authMethod, expected) => {
    expect(deriveConnectionAuthClass({ authMethod })).toBe(expected);
  });

  it.each([
    [undefined],
    [null],
    ["api_key"],
    [{}],
    [{ authMethod: "" }],
    [{ authMethod: "API_KEY" }],
    [{ authMethod: "access_token" }],
    [{ authMethod: 123 }],
    [[]],
  ] as const)("classifies non-canonical config as unknown: %p", (config) => {
    expect(deriveConnectionAuthClass(config)).toBe("unknown");
  });
});

describe("getConnectionMetadataById", () => {
  it("returns only metadata when the ID belongs to the exact scope", async () => {
    await client.exec(`
      INSERT INTO provider_connections (
        id,
        provider,
        category,
        scope,
        scope_id,
        name,
        encrypted_credentials,
        credentials_iv,
        credentials_auth_tag,
        config
      ) VALUES (
        '11111111-1111-4111-8111-111111111111',
        'openai',
        'ai',
        'organization',
        'org-1',
        'Scoped connection',
        'ciphertext',
        'iv',
        'auth-tag',
        '{"authMethod":"api_key"}'::jsonb
      );
    `);

    const metadata = await getConnectionMetadataById(
      "11111111-1111-4111-8111-111111111111",
      { scope: "organization", scopeId: "org-1" },
    );

    expect(metadata).toMatchObject({
      id: "11111111-1111-4111-8111-111111111111",
      scope: "organization",
      scopeId: "org-1",
      config: { authMethod: "api_key" },
    });
    expect(metadata).not.toHaveProperty("encryptedCredentials");
    expect(metadata).not.toHaveProperty("credentialsIv");
    expect(metadata).not.toHaveProperty("credentialsAuthTag");
  });

  it.each([
    { scope: "organization", scopeId: "org-other" },
    { scope: "user", scopeId: "org-1" },
  ] as const)("returns null outside the exact scope: %p", async (scopeFilter) => {
    await client.exec(`
      INSERT INTO provider_connections (
        id,
        provider,
        category,
        scope,
        scope_id,
        name
      ) VALUES (
        '22222222-2222-4222-8222-222222222222',
        'openai',
        'ai',
        'organization',
        'org-1',
        'Other scoped connection'
      );
    `);

    const metadata = await getConnectionMetadataById(
      "22222222-2222-4222-8222-222222222222",
      scopeFilter,
    );

    expect(metadata).toBeNull();
  });
});
