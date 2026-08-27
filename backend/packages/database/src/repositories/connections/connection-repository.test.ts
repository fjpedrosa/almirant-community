import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";

type ConnectionRepository = typeof import("./connection-repository");

const realClient = { ...(await import("../../client")) };

let client: PGlite;
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

  mock.module("../../client", () => ({ db: drizzle(client) }));
  ({ deriveConnectionAuthClass, getConnectionMetadataById } = await import(
    "./connection-repository"
  ));
});

afterAll(async () => {
  mock.module("../../client", () => realClient);
  await client.close();
});

beforeEach(async () => {
  await client.exec("TRUNCATE TABLE provider_connections");
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
