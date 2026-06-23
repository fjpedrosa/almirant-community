# Service Accounts: Data Model & API Design

> Organization-scoped service accounts for machine-to-machine authentication, replacing the current pattern of using human user API keys for runners and integrations.

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Data Model](#data-model)
3. [API Design](#api-design)
4. [Auth Flow](#auth-flow)
5. [Auto-creation Flow](#auto-creation-flow)
6. [Security Considerations](#security-considerations)
7. [Migration Strategy](#migration-strategy)

---

## Executive Summary

### Problem

Today, runners and integrations authenticate to the Almirant API using API keys tied to human user accounts. This creates several issues:

- **Accountability gap**: Actions performed by automated systems are attributed to a specific human user, making audit trails misleading.
- **Fragile coupling**: If the human user who created the API key is removed from the organization, the runner loses access — breaking all automated workflows.
- **No separation of concerns**: There is no way to distinguish between a human-initiated API call and a machine-initiated one.
- **Security risk**: Human user API keys carry implicit permissions of that user, which may be broader than what a runner needs.

### Solution

Introduce **service accounts** as first-class entities scoped to an organization. A service account:

- Has its own identity, independent of any human user
- Owns API keys with a distinct prefix (`alm_sa_`) for easy identification
- Has a `type` field to distinguish runners from integrations
- Is automatically created when a new organization is provisioned

This gives organizations proper machine identity management while keeping the existing human API key flow unchanged.

---

## Data Model

### New Table: `service_accounts`

| Column           | Type                        | Constraints                          | Description                        |
|------------------|-----------------------------|--------------------------------------|------------------------------------|
| `id`             | `uuid`                      | PK, default `gen_random_uuid()`      | Unique identifier                  |
| `organization_id`| `text`                      | NOT NULL, FK → `organization.id` ON DELETE CASCADE | Owning organization |
| `name`           | `varchar(255)`              | NOT NULL                             | Display name (e.g., "Default Runner") |
| `type`           | `service_account_type` enum | NOT NULL                             | `runner` or `integration`          |
| `is_active`      | `boolean`                   | NOT NULL, default `true`             | Soft-delete flag                   |
| `created_at`     | `timestamptz`               | NOT NULL, default `now()`            | Creation timestamp                 |
| `updated_at`     | `timestamptz`               | NOT NULL, default `now()`            | Last modification timestamp        |

### New Enum: `service_account_type`

```sql
CREATE TYPE service_account_type AS ENUM ('runner', 'integration');
```

Drizzle definition:

```typescript
export const serviceAccountTypeEnum = pgEnum("service_account_type", [
  "runner",
  "integration",
]);
```

### Drizzle Schema: `service_accounts`

```typescript
export const serviceAccounts = pgTable("service_accounts", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  type: serviceAccountTypeEnum("type").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("service_accounts_organization_id_idx").on(table.organizationId),
  index("service_accounts_org_type_idx").on(table.organizationId, table.type),
]);
```

### Modifications to `api_keys` Table

Add a new nullable column `service_account_id` and a CHECK constraint ensuring mutual exclusivity with `user_id`:

```typescript
export const apiKeys = pgTable("api_keys", {
  // ... existing columns ...
  serviceAccountId: uuid("service_account_id")
    .references(() => serviceAccounts.id, { onDelete: "cascade" }),
  // ... existing columns ...
}, (table) => [
  // ... existing indexes ...
  index("api_keys_service_account_id_idx").on(table.serviceAccountId),
  check("api_keys_owner_check",
    sql`(user_id IS NOT NULL AND service_account_id IS NULL)
     OR (user_id IS NULL AND service_account_id IS NOT NULL)
     OR (user_id IS NULL AND service_account_id IS NULL)`
  ),
]);
```

**Note on the CHECK constraint**: The third clause `(user_id IS NULL AND service_account_id IS NULL)` preserves backward compatibility for any existing keys that have neither a user nor a service account. In steady state, new keys should always have exactly one owner.

### New Key Prefix

Service account API keys use the prefix `alm_sa_` to distinguish them from human user keys (`alm_k1_`). This allows quick visual identification in logs, configs, and error messages.

| Prefix      | Owner Type       | Example                              |
|-------------|------------------|--------------------------------------|
| `alm_k1_`   | Human user       | `alm_k1_a1b2c3d4...`               |
| `alm_sa_`   | Service account  | `alm_sa_e5f6g7h8...`               |
| `crm_k1_`   | Legacy (human)   | `crm_k1_i9j0k1l2...`               |

### Entity Relationship Diagram

```
┌──────────────────────┐
│    organization      │
│──────────────────────│
│  id (text, PK)       │
│  name                │
│  slug                │
│  ...                 │
└──────────┬───────────┘
           │
           │ 1:N
           ▼
┌──────────────────────────┐
│    service_accounts      │
│──────────────────────────│
│  id (uuid, PK)           │
│  organization_id (FK)    │──────────┐
│  name                    │          │
│  type (runner|integration)│         │
│  is_active               │          │
│  created_at              │          │
│  updated_at              │          │
└──────────┬───────────────┘          │
           │                          │
           │ 1:N                      │
           ▼                          │
┌──────────────────────────┐          │
│       api_keys           │          │
│──────────────────────────│          │
│  id (uuid, PK)           │          │
│  name                    │          │
│  key_hash                │          │
│  key_prefix              │          │
│  is_active               │          │
│  user_id (FK, nullable)  │          │
│  service_account_id (FK) │◄─────────┘ (mutual exclusion
│  organization_id (FK)    │             with user_id)
│  last_used_at            │
│  created_at              │
└──────────────────────────┘

CHECK: exactly one of (user_id, service_account_id) is set,
       or both are NULL (legacy keys only)
```

### Relations

```typescript
export const serviceAccountsRelations = relations(serviceAccounts, ({ one, many }) => ({
  organization: one(organization, {
    fields: [serviceAccounts.organizationId],
    references: [organization.id],
  }),
  apiKeys: many(apiKeys),
}));

// Update existing apiKeys relations to include:
export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  // ... existing relations ...
  serviceAccount: one(serviceAccounts, {
    fields: [apiKeys.serviceAccountId],
    references: [serviceAccounts.id],
  }),
}));
```

---

## API Design

All endpoints are scoped under `/api/organizations/:orgId/service-accounts` and require admin or owner role on the organization.

### POST `/api/organizations/:orgId/service-accounts`

Creates a new service account and its initial API key atomically in a single transaction. Returns the plaintext API key (shown only once).

**Request Body:**

```typescript
{
  name: string;       // required, max 255 chars
  type: "runner" | "integration";  // required
}
```

**Response (201):**

```typescript
{
  success: true,
  data: {
    serviceAccount: {
      id: string;           // uuid
      name: string;
      type: "runner" | "integration";
      isActive: true;
      organizationId: string;
      createdAt: string;    // ISO 8601
      updatedAt: string;
    },
    apiKey: {
      id: string;           // uuid
      name: string;         // auto-generated: "{serviceAccount.name} Key"
      keyPrefix: string;    // e.g., "alm_sa_a1b2c3d4"
      key: string;          // full plaintext key (shown ONCE)
      createdAt: string;
    }
  }
}
```

**Error Responses:**

| Status | Condition                                |
|--------|------------------------------------------|
| 400    | Invalid body (missing name/type)         |
| 403    | User is not admin/owner of organization  |
| 409    | Service account with same name exists    |
| 429    | Organization has reached max service accounts limit |

**Elysia Route Definition:**

```typescript
.post("/:orgId/service-accounts", async ({ params, body, user }) => {
  // 1. Verify user is admin/owner of orgId
  // 2. Check org service account limit
  // 3. In transaction:
  //    a. Insert service_accounts row
  //    b. Generate API key with alm_sa_ prefix
  //    c. Insert api_keys row with serviceAccountId
  // 4. Return service account + plaintext key
}, {
  params: t.Object({ orgId: t.String() }),
  body: t.Object({
    name: t.String({ maxLength: 255 }),
    type: t.Union([t.Literal("runner"), t.Literal("integration")]),
  }),
})
```

---

### GET `/api/organizations/:orgId/service-accounts`

Lists all service accounts for the organization, including key metadata (but never key hashes).

**Query Parameters:**

| Param      | Type    | Default | Description                    |
|------------|---------|---------|--------------------------------|
| `type`     | string  | —       | Filter by type                 |
| `isActive` | boolean | —       | Filter by active status        |

**Response (200):**

```typescript
{
  success: true,
  data: Array<{
    id: string;
    name: string;
    type: "runner" | "integration";
    isActive: boolean;
    organizationId: string;
    createdAt: string;
    updatedAt: string;
    apiKeys: Array<{
      id: string;
      name: string;
      keyPrefix: string;
      isActive: boolean;
      lastUsedAt: string | null;
      createdAt: string;
    }>;
  }>
}
```

---

### DELETE `/api/organizations/:orgId/service-accounts/:id`

Soft-deactivates a service account and revokes all its API keys. Does not hard-delete to preserve audit trail.

**Response (200):**

```typescript
{
  success: true,
  data: {
    id: string;
    isActive: false;
    revokedKeys: number;  // count of keys that were revoked
  }
}
```

**Error Responses:**

| Status | Condition                             |
|--------|---------------------------------------|
| 403    | Not admin/owner                       |
| 404    | Service account not found in this org |

**Implementation Notes:**

- Set `service_accounts.is_active = false`
- Set `api_keys.is_active = false` for all keys where `service_account_id` matches
- Both updates in a single transaction

---

### POST `/api/organizations/:orgId/service-accounts/:id/rotate-key`

Revokes all existing keys for the service account and creates a new one. Returns the new plaintext key (shown only once).

**Response (200):**

```typescript
{
  success: true,
  data: {
    revokedKeys: number;  // count of old keys revoked
    apiKey: {
      id: string;
      name: string;
      keyPrefix: string;
      key: string;          // new plaintext key (shown ONCE)
      createdAt: string;
    }
  }
}
```

**Error Responses:**

| Status | Condition                                       |
|--------|-------------------------------------------------|
| 403    | Not admin/owner                                 |
| 404    | Service account not found or inactive            |

**Implementation Notes:**

- In a single transaction:
  1. Verify service account exists and is active
  2. Set `is_active = false` on all existing api_keys for this service account
  3. Generate a new API key with `alm_sa_` prefix
  4. Return new key

---

## Auth Flow

### Current Flow (Human User API Keys)

```
Runner → x-api-key header → validateApiKey() → returns ApiKey row
       → extract organizationId from ApiKey
       → no user context (userId may or may not be set)
```

### Updated Flow (Supporting Service Accounts)

The `validateApiKey` function needs to return additional context when the key belongs to a service account:

```typescript
// Updated return type
type ValidatedKey = {
  apiKey: ApiKey;
  owner:
    | { type: "user"; userId: string }
    | { type: "service_account"; serviceAccountId: string; serviceAccountType: "runner" | "integration" }
    | { type: "anonymous" };  // legacy keys with neither
};
```

**Changes to `validateApiKey()`:**

```typescript
export const validateApiKey = async (rawKey: string): Promise<ValidatedKey | null> => {
  // 1. Strip prefix (alm_k1_, alm_sa_, or crm_k1_)
  // 2. Hash and look up key (existing logic)
  // 3. If key has serviceAccountId:
  //    a. JOIN service_accounts to get type
  //    b. Verify service account is active
  //    c. Return { type: "service_account", ... }
  // 4. If key has userId: return { type: "user", ... }
  // 5. Otherwise: return { type: "anonymous" }
};
```

**Prefix handling update:**

```typescript
const SA_KEY_PREFIX = "alm_sa_";

const stripped = rawKey.startsWith(KEY_PREFIX)
  ? rawKey.slice(KEY_PREFIX.length)
  : rawKey.startsWith(SA_KEY_PREFIX)
    ? rawKey.slice(SA_KEY_PREFIX.length)
    : rawKey.startsWith(LEGACY_KEY_PREFIX)
      ? rawKey.slice(LEGACY_KEY_PREFIX.length)
      : rawKey;
```

**Worker routes impact**: The worker routes (`workers.routes.ts`) currently validate API keys and extract `organizationId` from the result. With service accounts, the worker should:

1. Accept both `alm_k1_` and `alm_sa_` keys
2. When a service account key is used, derive `organizationId` from the key as before
3. Log the `serviceAccountId` in audit/event records instead of a `userId`
4. The `eventTriggeredByEnum` already has a `"worker"` value, which maps naturally to service account actions

---

## Auto-creation Flow

When a new organization is created, the system should automatically provision a default runner service account. This ensures that every organization has a ready-to-use runner key without manual setup.

### Trigger Point

The auto-creation hooks into the organization creation flow. In Better-Auth's organization plugin, this happens after the organization row is committed.

### Implementation

```typescript
// Called after organization creation
async function provisionDefaultServiceAccount(organizationId: string): Promise<void> {
  await db.transaction(async (tx) => {
    // 1. Create service account
    const [sa] = await tx.insert(serviceAccounts).values({
      organizationId,
      name: "Default Runner",
      type: "runner",
    }).returning();

    // 2. Create API key for the service account
    const rawHex = randomBytes(32).toString("hex");
    const plaintextKey = `${SA_KEY_PREFIX}${rawHex}`;
    const keyHash = hashKey(rawHex);
    const keyPrefix = `${SA_KEY_PREFIX}${rawHex.slice(0, 8)}`;

    await tx.insert(apiKeys).values({
      name: "Default Runner Key",
      keyHash,
      keyPrefix,
      organizationId,
      serviceAccountId: sa.id,
    });

    // 3. Store the plaintext key in organization metadata or
    //    surface it in the onboarding UI (implementation detail)
    //    NOTE: The key can only be shown once. Consider:
    //    - Displaying it on the org creation success page
    //    - Sending it via a secure channel
    //    - Requiring the admin to explicitly reveal/copy it
  });
}
```

### Key Delivery

The auto-created API key needs to be surfaced to the organization admin. Options:

1. **Onboarding UI**: Show the key on the post-organization-creation page with a copy button and a warning that it won't be shown again.
2. **Settings page**: Allow admins to rotate the default runner key from the organization settings, which reveals a new key.
3. **CLI setup flow**: When configuring the runner CLI, prompt for key rotation if no key is stored locally.

**Recommended approach**: Option 1 (onboarding UI) for initial setup, with Option 2 as the ongoing management path.

---

## Security Considerations

### Key Rotation

- **Mandatory rotation**: Service account keys should support rotation via the `/rotate-key` endpoint. This revokes all old keys and issues a new one atomically.
- **Grace period**: Consider a future enhancement where rotated keys remain valid for a short grace period (e.g., 5 minutes) to allow in-flight requests to complete. For v1, immediate revocation is acceptable.
- **Rotation audit**: Every rotation event should be logged (leveraging the existing `work_item_event` or a new `audit_log` table in the future).

### Revocation

- **Cascade deactivation**: When a service account is deactivated, all its API keys are immediately revoked.
- **Organization deletion**: FK ON DELETE CASCADE ensures cleanup when the organization is deleted.
- **No undelete**: Once a service account is deactivated, it cannot be reactivated. A new one must be created. This prevents stale keys from being accidentally re-enabled.

### Rate Limits and Quotas

| Limit                          | Value | Rationale                          |
|--------------------------------|-------|------------------------------------|
| Max service accounts per org   | 10    | Prevents abuse, most orgs need 1-2 |
| Max API keys per service acct  | 5     | Supports rotation overlap          |
| Max API requests per minute    | 600   | Per service account, 10 req/s      |

These limits should be configurable per organization tier (future enhancement).

### Audit Logging

All service account operations should generate audit events:

- Service account created/deactivated
- API key created/rotated/revoked
- API key used (already tracked via `lastUsedAt`)

For v1, the `lastUsedAt` tracking on `api_keys` is sufficient. A dedicated `audit_log` table is a future enhancement.

### Permissions

Service accounts do **not** have granular permissions in v1. A service account key grants the same access as a human user API key within the organization. Future versions may introduce scoped permissions (e.g., read-only, specific project access).

### Key Storage

- API keys are **never stored in plaintext** in the database. Only the SHA-256 hash is persisted.
- The plaintext key is returned exactly once at creation/rotation time.
- Key prefixes (`alm_sa_`) allow identifying key type without database lookup.

---

## Migration Strategy

### Phase 1: Schema Changes (Non-Breaking)

All changes are additive and do not modify existing data or behavior.

**Step 1: Add enum and table**

```sql
-- New enum
CREATE TYPE service_account_type AS ENUM ('runner', 'integration');

-- New table
CREATE TABLE service_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  type service_account_type NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX service_accounts_organization_id_idx ON service_accounts(organization_id);
CREATE INDEX service_accounts_org_type_idx ON service_accounts(organization_id, type);
```

**Step 2: Alter `api_keys` table**

```sql
-- Add nullable FK column
ALTER TABLE api_keys
  ADD COLUMN service_account_id UUID REFERENCES service_accounts(id) ON DELETE CASCADE;

-- Add index
CREATE INDEX api_keys_service_account_id_idx ON api_keys(service_account_id);

-- Add CHECK constraint
ALTER TABLE api_keys
  ADD CONSTRAINT api_keys_owner_check CHECK (
    (user_id IS NOT NULL AND service_account_id IS NULL)
    OR (user_id IS NULL AND service_account_id IS NOT NULL)
    OR (user_id IS NULL AND service_account_id IS NULL)
  );
```

**Impact**: Zero downtime. The new column is nullable, so existing rows are unaffected. The CHECK constraint permits the existing state (both NULL).

### Phase 2: Code Changes

1. Update `api-key-repository.ts`:
   - Add `SA_KEY_PREFIX = "alm_sa_"` constant
   - Add `createServiceAccountApiKey()` function
   - Update `validateApiKey()` to handle `alm_sa_` prefix and return owner context
   - Update `listApiKeys()` to include `serviceAccountId` in response

2. Add `service-account-repository.ts`:
   - `createServiceAccount(orgId, name, type)` — with API key generation in transaction
   - `listServiceAccounts(orgId, filters?)` — with API key metadata
   - `deactivateServiceAccount(orgId, id)` — soft-delete + revoke keys
   - `rotateServiceAccountKey(orgId, id)` — revoke old + generate new

3. Add `service-accounts.routes.ts`:
   - Mount under `/api/organizations/:orgId/service-accounts`
   - Four endpoints as described in API Design section

4. Update worker routes to accept service account keys seamlessly (no changes needed if `validateApiKey()` returns `organizationId` as before).

### Phase 3: Auto-Provisioning

1. Hook into organization creation to call `provisionDefaultServiceAccount()`
2. Add migration script to create default runner service accounts for existing organizations:

```sql
-- Backfill: create a default runner service account for each existing org
INSERT INTO service_accounts (organization_id, name, type)
SELECT id, 'Default Runner', 'runner'
FROM organization
WHERE id NOT IN (
  SELECT organization_id FROM service_accounts WHERE type = 'runner'
);
```

**Note**: The backfill creates service accounts but does NOT auto-generate API keys for existing orgs. Admins must explicitly create/rotate keys via the UI or API, ensuring no secrets are generated without someone to receive them.

### Rollback Plan

Since all changes are additive:

1. Remove the CHECK constraint from `api_keys`
2. Drop the `service_account_id` column from `api_keys`
3. Drop the `service_accounts` table
4. Drop the `service_account_type` enum

No data loss occurs for existing keys or users.
