import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { hashPassword } from "better-auth/crypto";
import { setCookieToHeader } from "better-auth/cookies";

const databaseUrl = process.env.TEST_DATABASE_URL;
const d = databaseUrl ? describe : describe.skip;
let sql = databaseUrl ? postgres(databaseUrl, { max: 4 }) : null;
let activeDatabaseUrl = databaseUrl;
let activeDatabase: ReturnType<typeof drizzle> | null = null;
let adminSql: ReturnType<typeof postgres> | null = null;
let ephemeralDatabaseName: string | null = null;
const suffix = `${process.pid}-${Date.now()}`;
const userId = `notes-auth-user-${suffix}`;
const workspaceId = `notes-auth-workspace-${suffix}`;
const memberId = `notes-auth-member-${suffix}`;
const accountId = `notes-auth-account-${suffix}`;
const email = `notes-auth-${suffix}@example.test`;
const password = "notes-auth-password-123";
const signupEmail = `notes-auth-signup-${suffix}@example.test`;
const signupPassword = "notes-auth-signup-password-123";
setDefaultTimeout(20_000);

d("real Better Auth organization deletion", () => {
  let createAuthInstance: typeof import("./auth").createAuthInstance;
  let auth: ReturnType<typeof import("./auth").createAuthInstance>;

  const expectSourceRowAbsent = async (
    table: "user" | "workspace" | "member" | "boards" | "service_accounts" | "api_keys",
    column: "id" | "email" | "workspace_id",
    value: string,
  ) => {
    if (!adminSql) throw new Error("source database connection is unavailable");
    const [presence] = await adminSql.unsafe(
      `SELECT to_regclass('public."${table}"')::text AS relation`,
    );
    if (!presence?.relation) return;
    const rows = await adminSql.unsafe(
      `SELECT count(*)::int AS count FROM "${table}" WHERE "${column}" = $1`,
      [value],
    );
    expect(Number(rows[0]?.count ?? 0)).toBe(0);
  };

  beforeAll(async () => {
    if (!sql) throw new Error("TEST_DATABASE_URL is required for the Better Auth database suite");
    // Always target a disposable database while leaving DATABASE_URL untouched.
    // The imported production singleton therefore remains connected to the
    // source database and any missed dependency binding is observable.
    ephemeralDatabaseName = `auth_delete_${process.pid}_${Date.now()}`;
    adminSql = postgres(databaseUrl!, { max: 1 });
    await adminSql.unsafe(`CREATE DATABASE "${ephemeralDatabaseName}"`);
    const targetUrl = databaseUrl!.replace(/\/[^/]+$/, `/${ephemeralDatabaseName}`);
    activeDatabaseUrl = targetUrl;
    await sql.end({ timeout: 5 });
    sql = postgres(targetUrl, { max: 4 });
    await sql.begin(async (tx) => { for (const statement of [
      `CREATE TYPE board_area AS ENUM ('desarrollo', 'ventas', 'prospeccion', 'marketing', 'general')`,
      `CREATE TYPE column_role AS ENUM ('backlog', 'todo', 'in_progress', 'review', 'testing', 'needs_fix', 'validating', 'release', 'to_document', 'done', 'other')`,
      `CREATE TYPE service_account_type AS ENUM ('runner', 'integration')`,
      `CREATE TABLE "user" (id text PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE, email_verified boolean NOT NULL DEFAULT false, image text, role text NOT NULL DEFAULT 'user', locale varchar(5) NOT NULL DEFAULT 'en', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`,
      `CREATE TABLE account (id text PRIMARY KEY, account_id text NOT NULL, provider_id text NOT NULL, user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE, password text, access_token text, refresh_token text, id_token text, access_token_expires_at timestamptz, refresh_token_expires_at timestamptz, scope text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`,
      `CREATE TABLE workspace (id text PRIMARY KEY, name text NOT NULL, slug text NOT NULL UNIQUE, logo text, metadata text, created_at timestamptz NOT NULL DEFAULT now())`,
      `CREATE TABLE member (id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspace(id) ON DELETE CASCADE, user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE, role text NOT NULL DEFAULT 'member', created_at timestamptz NOT NULL DEFAULT now())`,
      `CREATE TABLE invitation (id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspace(id) ON DELETE CASCADE, email text NOT NULL, role text, status text NOT NULL DEFAULT 'pending', expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), inviter_id text REFERENCES "user"(id) ON DELETE SET NULL)`,
      `CREATE TABLE session (id text PRIMARY KEY, expires_at timestamptz NOT NULL, token text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), ip_address text, user_agent text, user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE, active_workspace_id text REFERENCES workspace(id) ON DELETE SET NULL)`,
      `CREATE TABLE verification (id text PRIMARY KEY, identifier text NOT NULL, value text NOT NULL, expires_at timestamptz NOT NULL, created_at timestamptz, updated_at timestamptz)`,
      `CREATE TABLE system_settings (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), allow_new_registrations boolean NOT NULL DEFAULT true, updated_by text REFERENCES "user"(id), updated_at timestamptz NOT NULL DEFAULT now())`,
      `CREATE TABLE boards (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id text NOT NULL REFERENCES workspace(id) ON DELETE CASCADE, name varchar(255) NOT NULL, description text, area board_area NOT NULL DEFAULT 'general', is_default boolean DEFAULT false, allowed_types jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`,
      `CREATE TABLE board_columns (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), board_id uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE, name varchar(255) NOT NULL, color varchar(7) NOT NULL DEFAULT '#6366f1', "order" integer NOT NULL DEFAULT 0, role column_role NOT NULL DEFAULT 'other', is_done boolean DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`,
      `CREATE TABLE work_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), board_id uuid REFERENCES boards(id) ON DELETE CASCADE, archived_at timestamptz)`,
      `CREATE TABLE service_accounts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id text NOT NULL REFERENCES workspace(id) ON DELETE CASCADE, name varchar(255) NOT NULL, type service_account_type NOT NULL, is_active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (workspace_id, name))`,
      `CREATE TABLE api_keys (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name varchar(255) NOT NULL, key_hash varchar(128) NOT NULL, key_prefix varchar(20) NOT NULL, is_active boolean NOT NULL DEFAULT true, user_id text REFERENCES "user"(id) ON DELETE CASCADE, service_account_id uuid REFERENCES service_accounts(id) ON DELETE CASCADE, workspace_id text NOT NULL REFERENCES workspace(id) ON DELETE CASCADE, allowed_issued_permissions text[] NOT NULL DEFAULT ARRAY['mcp:read', 'mcp:write']::text[], last_used_at timestamptz, created_at timestamptz NOT NULL DEFAULT now())`,
      `INSERT INTO system_settings (allow_new_registrations) VALUES (true)`,
    ]) await tx.unsafe(statement); });
    activeDatabase = drizzle(sql);
    ({ createAuthInstance } = await import("./auth"));
    const passwordHash = await hashPassword(password);
    await sql!.begin(async (tx) => {
      await tx.unsafe(`INSERT INTO "user" (id, name, email, email_verified, role, created_at, updated_at)
        VALUES ($1, 'Notes Auth Owner', $2, true, 'user', now(), now())`, [userId, email]);
      await tx.unsafe(`INSERT INTO "account" (id, account_id, provider_id, user_id, password, created_at, updated_at)
        VALUES ($1, $2, 'credential', $2, $3, now(), now())`, [accountId, userId, passwordHash]);
      await tx.unsafe(`INSERT INTO "workspace" (id, name, slug, created_at)
        VALUES ($1, 'Notes Auth Workspace', $1, now())`, [workspaceId]);
      await tx.unsafe(`INSERT INTO "member" (id, workspace_id, user_id, role, created_at)
        VALUES ($1, $2, $3, 'owner', now())`, [memberId, workspaceId, userId]);
    });
    auth = createAuthInstance(null, { database: activeDatabase as never });
  });

  afterAll(async () => {
    if (!sql) return;
    try {
      await sql.end({ timeout: 5 });
    } finally {
      if (adminSql && ephemeralDatabaseName) {
        await adminSql.unsafe(`DROP DATABASE IF EXISTS "${ephemeralDatabaseName}" WITH (FORCE)`).catch(() => undefined);
        await adminSql.end({ timeout: 5 });
      }
    }
  });

  it("runs signup/bootstrap and default personal-workspace provisioning only in the injected database", async () => {
    const signup = await auth.handler(new Request("http://localhost:3000/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json", Origin: "http://localhost:3000" },
      body: JSON.stringify({ name: "Injected Signup", email: signupEmail, password: signupPassword }),
    }));
    expect(signup.status).toBe(200);

    const [createdUser] = await sql!<{ id: string }[]>`
      SELECT id FROM "user" WHERE email = ${signupEmail}
    `;
    expect(createdUser?.id).toBeTruthy();
    const [personalWorkspace] = await sql!<{ id: string }[]>`
      SELECT w.id
      FROM workspace w
      JOIN member m ON m.workspace_id = w.id
      WHERE m.user_id = ${createdUser!.id} AND m.role = 'owner'
    `;
    expect(personalWorkspace?.id).toBeTruthy();
    expect(Number((await sql!`SELECT count(*)::int AS count FROM boards WHERE workspace_id = ${personalWorkspace!.id}`)[0]?.count)).toBe(1);
    expect(Number((await sql!`SELECT count(*)::int AS count FROM board_columns bc JOIN boards b ON b.id = bc.board_id WHERE b.workspace_id = ${personalWorkspace!.id}`)[0]?.count)).toBe(7);
    expect(Number((await sql!`SELECT count(*)::int AS count FROM service_accounts WHERE workspace_id = ${personalWorkspace!.id} AND type = 'runner'`)[0]?.count)).toBe(1);
    expect(Number((await sql!`SELECT count(*)::int AS count FROM api_keys WHERE workspace_id = ${personalWorkspace!.id} AND service_account_id IS NOT NULL`)[0]?.count)).toBe(1);
    expect((await sql!`SELECT role FROM "user" WHERE id = ${userId}`)[0]?.role).toBe("admin");
    expect((await sql!`SELECT allow_new_registrations, updated_by FROM system_settings LIMIT 1`)[0]).toEqual({
      allow_new_registrations: false,
      updated_by: userId,
    });

    await expectSourceRowAbsent("user", "email", signupEmail);
    await expectSourceRowAbsent("workspace", "id", personalWorkspace!.id);
    await expectSourceRowAbsent("boards", "workspace_id", personalWorkspace!.id);
    await expectSourceRowAbsent("service_accounts", "workspace_id", personalWorkspace!.id);
    await expectSourceRowAbsent("api_keys", "workspace_id", personalWorkspace!.id);
  });

  it("executes the real signed-cookie handler and real atomic deletion against the injected database", async () => {
    const organizationOptions = auth.options.plugins?.find((plugin) => plugin.id === "organization")?.options as { disableOrganizationDeletion?: boolean } | undefined;
    expect(organizationOptions?.disableOrganizationDeletion).toBe(true);
    const signIn = await auth.handler(new Request("http://localhost:3000/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json", Origin: "http://localhost:3000" },
      body: JSON.stringify({ email, password }),
    }));
    expect(signIn.status).toBe(200);

    const headers = new Headers();
    setCookieToHeader(headers)({ response: signIn });
    expect(headers.get("cookie")).toContain("better-auth.session_token=");

    const deletion = await auth.handler(new Request("http://localhost:3000/api/auth/organization/delete", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Origin: "http://localhost:3000",
        cookie: headers.get("cookie") ?? "",
      },
      body: JSON.stringify({ organizationId: workspaceId }),
    }));
    expect(deletion.status).toBe(200);
    expect((await deletion.json() as { id?: string }).id).toBe(workspaceId);
    expect((await sql!`SELECT 1 FROM workspace WHERE id = ${workspaceId}`)).toHaveLength(0);
    expect((await sql!`SELECT 1 FROM member WHERE workspace_id = ${workspaceId}`)).toHaveLength(0);
    await expectSourceRowAbsent("workspace", "id", workspaceId);
    const [identity] = await sql!<{ current_database: string }[]>`SELECT current_database()`;
    expect(ephemeralDatabaseName).not.toBeNull();
    expect(identity?.current_database).toBe(ephemeralDatabaseName!);
  });

  it("serializes the real command against invitation deletion and session writers", async () => {
    const raceSuffix = `${suffix}-race`;
    const raceUserId = `notes-auth-race-user-${raceSuffix}`;
    const raceWorkspaceId = `notes-auth-race-workspace-${raceSuffix}`;
    const raceMemberId = `notes-auth-race-member-${raceSuffix}`;
    const raceInvitationId = `notes-auth-race-invitation-${raceSuffix}`;
    const raceSessionId = `notes-auth-race-session-${raceSuffix}`;
    const raceAccountId = `notes-auth-race-account-${raceSuffix}`;
    const blocker = postgres(activeDatabaseUrl!, { max: 1 });
    const commandConnection = postgres(activeDatabaseUrl!, { max: 1 });
    const writer = postgres(activeDatabaseUrl!, { max: 1 });
    const observer = postgres(activeDatabaseUrl!, { max: 1 });
    let blockerCommitted = false;
    const waitForEdge = async (waiterPid: number, holderPid: number) => {
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        const rows = await observer.unsafe(`
          SELECT EXISTS (
            SELECT 1 FROM pg_locks waiter
            JOIN pg_locks holder ON holder.locktype = 'transactionid'
              AND holder.transactionid = waiter.transactionid
              AND holder.pid = ${holderPid} AND holder.granted
            WHERE waiter.pid = ${waiterPid} AND waiter.locktype = 'transactionid' AND NOT waiter.granted
          ) AS waiting
        `);
        if (rows[0]?.waiting) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error(`AUTH_DELETE_RACE_EDGE_TIMEOUT waiter=${waiterPid} holder=${holderPid}`);
    };
    try {
      const racePassword = await hashPassword(password);
      const raceEmail = `race-${raceSuffix}@example.test`;
      await sql!.begin(async (tx) => {
        await tx.unsafe(`INSERT INTO "user" (id, name, email, email_verified, role, created_at, updated_at)
          VALUES ($1, 'Race Owner', $2, true, 'user', now(), now())`, [raceUserId, raceEmail]);
        await tx.unsafe(`INSERT INTO "account" (id, account_id, provider_id, user_id, password, created_at, updated_at)
          VALUES ($1, $2, 'credential', $2, $3, now(), now())`, [raceAccountId, raceUserId, racePassword]);
        await tx.unsafe(`INSERT INTO "workspace" (id, name, slug, created_at)
          VALUES ($1, 'Race Workspace', $1, now())`, [raceWorkspaceId]);
        await tx.unsafe(`INSERT INTO "member" (id, workspace_id, user_id, role, created_at)
          VALUES ($1, $2, $3, 'owner', now())`, [raceMemberId, raceWorkspaceId, raceUserId]);
        await tx.unsafe(`INSERT INTO "invitation" (id, workspace_id, email, role, status, expires_at, created_at, inviter_id)
          VALUES ($1, $2, $3, 'member', 'pending', now() + interval '1 day', now(), $4)`, [raceInvitationId, raceWorkspaceId, raceEmail, raceUserId]);
        await tx.unsafe(`INSERT INTO "session" (id, expires_at, token, created_at, updated_at, user_id, active_workspace_id)
          VALUES ($1, now() + interval '1 day', $1, now(), now(), $2, $3)`, [raceSessionId, raceUserId, raceWorkspaceId]);
      });

      const blockerPid = Number((await blocker`SELECT pg_backend_pid() AS pid`)[0]?.pid);
      const commandPid = Number((await commandConnection`SELECT pg_backend_pid() AS pid`)[0]?.pid);
      const writerPid = Number((await writer`SELECT pg_backend_pid() AS pid`)[0]?.pid);
      await blocker`BEGIN`;
      await blocker`SELECT id FROM invitation WHERE id = ${raceInvitationId} FOR UPDATE`;

      const command = import("./organization-deletion").then(({ deleteOrganizationAtomically }) =>
        deleteOrganizationAtomically(
          { organizationId: raceWorkspaceId, userId: raceUserId },
          { db: drizzle(commandConnection) as never },
        ),
      );
      void command.then(() => undefined, () => undefined);
      await waitForEdge(commandPid, blockerPid);
      const { NOTES_GLOBAL_ADVISORY_LOCK } = await import("@almirant/database");
      const lockClassId = Math.floor(NOTES_GLOBAL_ADVISORY_LOCK / 2 ** 32);
      const lockObjectId = NOTES_GLOBAL_ADVISORY_LOCK % 2 ** 32;
      expect(await observer.unsafe(`
        SELECT 1 FROM pg_locks
        WHERE pid = ${commandPid} AND locktype = 'advisory'
          AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
          AND classid = ${lockClassId} AND objid = ${lockObjectId} AND objsubid = 1
          AND mode = 'ExclusiveLock' AND granted
      `)).toHaveLength(1);

      const sessionUpdate = writer`UPDATE session SET active_workspace_id = ${raceWorkspaceId} WHERE id = ${raceSessionId}`;
      void sessionUpdate.then(() => undefined, () => undefined);
      await waitForEdge(writerPid, commandPid);

      await blocker`COMMIT`;
      blockerCommitted = true;
      const [commandOutcome, writerOutcome] = await Promise.allSettled([command, sessionUpdate]);
      expect(commandOutcome.status).toBe("fulfilled");
      expect(writerOutcome.status).toBe("rejected");
      if (writerOutcome.status === "rejected") {
        expect(writerOutcome.reason?.code).toBe("23503");
        expect(writerOutcome.reason?.code).not.toBe("40P01");
      }
      expect((await sql!`SELECT 1 FROM workspace WHERE id = ${raceWorkspaceId}`)).toHaveLength(0);
      expect((await sql!`SELECT active_workspace_id FROM session WHERE id = ${raceSessionId}`).map((row) => ({ active_workspace_id: row.active_workspace_id }))).toEqual([{ active_workspace_id: null }]);
    } finally {
      if (!blockerCommitted) try { await blocker`ROLLBACK`; } catch { /* cleanup is best effort */ }
      await sql!.unsafe(`DELETE FROM workspace WHERE id = $1`, [raceWorkspaceId]).catch(() => undefined);
      await sql!.unsafe(`DELETE FROM "user" WHERE id = $1`, [raceUserId]).catch(() => undefined);
      await blocker.end({ timeout: 5 });
      await commandConnection.end({ timeout: 5 });
      await writer.end({ timeout: 5 });
      await observer.end({ timeout: 5 });
    }
  });

  it("serializes the real command against session inserts", async () => {
    const raceSuffix = `${suffix}-insert-race`;
    const raceUserId = `notes-auth-insert-user-${raceSuffix}`;
    const raceWorkspaceId = `notes-auth-insert-workspace-${raceSuffix}`;
    const raceMemberId = `notes-auth-insert-member-${raceSuffix}`;
    const raceInvitationId = `notes-auth-insert-invitation-${raceSuffix}`;
    const raceSessionId = `notes-auth-insert-session-${raceSuffix}`;
    const raceAccountId = `notes-auth-insert-account-${raceSuffix}`;
    const insertedSessionId = `notes-auth-inserted-session-${raceSuffix}`;
    const blocker = postgres(activeDatabaseUrl!, { max: 1 });
    const commandConnection = postgres(activeDatabaseUrl!, { max: 1 });
    const writer = postgres(activeDatabaseUrl!, { max: 1 });
    const observer = postgres(activeDatabaseUrl!, { max: 1 });
    let blockerCommitted = false;
    const waitForEdge = async (waiterPid: number, holderPid: number) => {
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        const rows = await observer.unsafe(`
          SELECT EXISTS (
            SELECT 1 FROM pg_locks waiter
            JOIN pg_locks holder ON holder.locktype = 'transactionid'
              AND holder.transactionid = waiter.transactionid
              AND holder.pid = ${holderPid} AND holder.granted
            WHERE waiter.pid = ${waiterPid} AND waiter.locktype = 'transactionid' AND NOT waiter.granted
          ) AS waiting
        `);
        if (rows[0]?.waiting) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error(`AUTH_DELETE_INSERT_RACE_EDGE_TIMEOUT waiter=${waiterPid} holder=${holderPid}`);
    };
    try {
      const racePassword = await hashPassword(password);
      const raceEmail = `insert-race-${raceSuffix}@example.test`;
      await sql!.begin(async (tx) => {
        await tx.unsafe(`INSERT INTO "user" (id, name, email, email_verified, role, created_at, updated_at)
          VALUES ($1, 'Insert Race Owner', $2, true, 'user', now(), now())`, [raceUserId, raceEmail]);
        await tx.unsafe(`INSERT INTO "account" (id, account_id, provider_id, user_id, password, created_at, updated_at)
          VALUES ($1, $2, 'credential', $2, $3, now(), now())`, [raceAccountId, raceUserId, racePassword]);
        await tx.unsafe(`INSERT INTO "workspace" (id, name, slug, created_at)
          VALUES ($1, 'Insert Race Workspace', $1, now())`, [raceWorkspaceId]);
        await tx.unsafe(`INSERT INTO "member" (id, workspace_id, user_id, role, created_at)
          VALUES ($1, $2, $3, 'owner', now())`, [raceMemberId, raceWorkspaceId, raceUserId]);
        await tx.unsafe(`INSERT INTO "invitation" (id, workspace_id, email, role, status, expires_at, created_at, inviter_id)
          VALUES ($1, $2, $3, 'member', 'pending', now() + interval '1 day', now(), $4)`, [raceInvitationId, raceWorkspaceId, raceEmail, raceUserId]);
        await tx.unsafe(`INSERT INTO "session" (id, expires_at, token, created_at, updated_at, user_id, active_workspace_id)
          VALUES ($1, now() + interval '1 day', $1, now(), now(), $2, $3)`, [raceSessionId, raceUserId, raceWorkspaceId]);
      });

      const blockerPid = Number((await blocker`SELECT pg_backend_pid() AS pid`)[0]?.pid);
      const commandPid = Number((await commandConnection`SELECT pg_backend_pid() AS pid`)[0]?.pid);
      const writerPid = Number((await writer`SELECT pg_backend_pid() AS pid`)[0]?.pid);
      await blocker`BEGIN`;
      await blocker`SELECT id FROM invitation WHERE id = ${raceInvitationId} FOR UPDATE`;

      const command = import("./organization-deletion").then(({ deleteOrganizationAtomically }) =>
        deleteOrganizationAtomically(
          { organizationId: raceWorkspaceId, userId: raceUserId },
          { db: drizzle(commandConnection) as never },
        ),
      );
      void command.then(() => undefined, () => undefined);
      await waitForEdge(commandPid, blockerPid);
      const { NOTES_GLOBAL_ADVISORY_LOCK } = await import("@almirant/database");
      const lockClassId = Math.floor(NOTES_GLOBAL_ADVISORY_LOCK / 2 ** 32);
      const lockObjectId = NOTES_GLOBAL_ADVISORY_LOCK % 2 ** 32;
      expect(await observer.unsafe(`
        SELECT 1 FROM pg_locks
        WHERE pid = ${commandPid} AND locktype = 'advisory'
          AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
          AND classid = ${lockClassId} AND objid = ${lockObjectId} AND objsubid = 1
          AND mode = 'ExclusiveLock' AND granted
      `)).toHaveLength(1);

      const sessionInsert = writer`INSERT INTO "session" (id, expires_at, token, created_at, updated_at, user_id, active_workspace_id)
        VALUES (${insertedSessionId}, now() + interval '1 day', ${insertedSessionId}, now(), now(), ${raceUserId}, ${raceWorkspaceId})`;
      void sessionInsert.then(() => undefined, () => undefined);
      await waitForEdge(writerPid, commandPid);

      await blocker`COMMIT`;
      blockerCommitted = true;
      const [commandOutcome, writerOutcome] = await Promise.allSettled([command, sessionInsert]);
      expect(commandOutcome.status).toBe("fulfilled");
      expect(writerOutcome.status).toBe("rejected");
      if (writerOutcome.status === "rejected") {
        expect(writerOutcome.reason?.code).toBe("23503");
        expect(writerOutcome.reason?.code).not.toBe("40P01");
      }
      expect((await sql!`SELECT 1 FROM workspace WHERE id = ${raceWorkspaceId}`)).toHaveLength(0);
      expect((await sql!`SELECT 1 FROM session WHERE id = ${insertedSessionId}`)).toHaveLength(0);
      expect((await sql!`SELECT 1 FROM workspace WHERE id = ${workspaceId}`)).toHaveLength(0);
    } finally {
      if (!blockerCommitted) try { await blocker`ROLLBACK`; } catch { /* cleanup is best effort */ }
      await sql!.unsafe(`DELETE FROM workspace WHERE id = $1`, [raceWorkspaceId]).catch(() => undefined);
      await sql!.unsafe(`DELETE FROM "user" WHERE id = $1`, [raceUserId]).catch(() => undefined);
      await blocker.end({ timeout: 5 });
      await commandConnection.end({ timeout: 5 });
      await writer.end({ timeout: 5 });
      await observer.end({ timeout: 5 });
    }
  });
});
