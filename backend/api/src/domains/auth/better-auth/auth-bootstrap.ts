import { db, sql } from "@almirant/database";

/**
 * Registration/bootstrap status derived from the `user` count and the
 * `system_settings` row. Mirrors the frontend `AuthBootstrapStatus` shape
 * (previously imported from `@/domains/auth/domain/types`) — defined locally
 * here because the backend is now the auth issuer.
 */
export interface AuthBootstrapStatus {
  hasUsers: boolean;
  needsInitialAdminSetup: boolean;
  allowRegistration: boolean;
}

const INITIAL_ADMIN_BOOTSTRAP_LOCK_KEY = 20_260_421;

type SqlExecutor = {
  execute(query: unknown): Promise<unknown[]>;
};

type SqlDatabase = SqlExecutor & {
  transaction<T>(callback: (tx: SqlExecutor) => Promise<T>): Promise<T>;
};

type UserCountRow = {
  userCount: number;
};

type SettingsRow = {
  id: string;
  allowNewRegistrations: boolean;
};

type UserIdRow = {
  id: string;
};

type InvitationRow = {
  id: string;
};

const executeRows = async <T>(
  executor: SqlExecutor,
  query: unknown,
): Promise<T[]> => executor.execute(query) as Promise<T[]>;

const getSystemSettings = async (
  executor: SqlExecutor = db as unknown as SqlExecutor,
): Promise<SettingsRow | null> => {
  const [settings] = await executeRows<SettingsRow>(
    executor,
    sql`
    SELECT
      id,
      allow_new_registrations AS "allowNewRegistrations"
    FROM system_settings
    LIMIT 1
  `,
  );

  return settings ?? null;
};

export const getAuthBootstrapStatus = async (
  executor: SqlExecutor = db as unknown as SqlExecutor,
): Promise<AuthBootstrapStatus> => {
  const [userCountRows, settings] = await Promise.all([
    executeRows<UserCountRow>(
      executor,
      sql`
      SELECT count(*)::int AS "userCount"
      FROM "user"
    `,
    ),
    getSystemSettings(executor),
  ]);

  const hasUsers = (userCountRows[0]?.userCount ?? 0) > 0;

  return {
    hasUsers,
    needsInitialAdminSetup: !hasUsers,
    allowRegistration: !hasUsers || (settings?.allowNewRegistrations ?? true),
  };
};

export const hasPendingInvitation = async (
  email: string,
  executor: SqlExecutor = db as unknown as SqlExecutor,
): Promise<boolean> => {
  const normalizedEmail = email.trim().toLowerCase();

  if (!normalizedEmail) {
    return false;
  }

  const rows = await executeRows<InvitationRow>(
    executor,
    sql`
    SELECT id
    FROM invitation
    WHERE lower(email) = ${normalizedEmail}
      AND status = 'pending'
    LIMIT 1
  `,
  );

  return rows.length > 0;
};

export const ensureInitialAdminUser = async (
  database: SqlDatabase = db as unknown as SqlDatabase,
): Promise<string | null> => {
  return database.transaction(async (tx) => {
    await tx.execute(sql`
      SELECT pg_advisory_xact_lock(${INITIAL_ADMIN_BOOTSTRAP_LOCK_KEY})
    `);

    const [existingAdmin] = await executeRows<UserIdRow>(
      tx,
      sql`
      SELECT id
      FROM "user"
      WHERE role = 'admin'
      LIMIT 1
    `,
    );

    if (existingAdmin) {
      return null;
    }

    const [oldestUser] = await executeRows<UserIdRow>(
      tx,
      sql`
      SELECT id
      FROM "user"
      ORDER BY created_at ASC, id ASC
      LIMIT 1
    `,
    );

    if (!oldestUser) {
      return null;
    }

    await tx.execute(sql`
      UPDATE "user"
      SET role = 'admin',
          updated_at = now()
      WHERE id = ${oldestUser.id}
    `);

    const [settings] = await executeRows<SettingsRow>(
      tx,
      sql`
      SELECT
        id,
        allow_new_registrations AS "allowNewRegistrations"
      FROM system_settings
      LIMIT 1
    `,
    );

    if (settings) {
      await tx.execute(sql`
        UPDATE system_settings
        SET allow_new_registrations = false,
            updated_by = ${oldestUser.id},
            updated_at = now()
        WHERE id = ${settings.id}::uuid
      `);
    } else {
      await tx.execute(sql`
        INSERT INTO system_settings (
          allow_new_registrations,
          updated_by,
          updated_at
        )
        VALUES (
          false,
          ${oldestUser.id},
          now()
        )
      `);
    }

    return oldestUser.id;
  });
};
