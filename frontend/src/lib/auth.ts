import { betterAuth, generateId } from 'better-auth';
import { APIError } from 'better-auth/api';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { organization } from 'better-auth/plugins';
import { nextCookies } from 'better-auth/next-js';
import { randomBytes, createHash } from 'crypto';
import { and, eq, desc, sql, isNotNull } from 'drizzle-orm';
import { db } from './db';
import * as schema from './schema';
import {
  ensureInitialAdminUser,
  getAuthBootstrapStatus,
  hasPendingInvitation,
} from './auth-bootstrap';
import { ac, roles } from './auth-permissions';
import { getDefaultLocalFrontendOrigins } from './runtime-service-url';
import { getInvitationAppBaseUrl } from './site-url';
import { getInstancePublicConfig } from './instance-public-config';

// ──────────────────────────────────────────────
// Helpers for auto-org creation
// ──────────────────────────────────────────────

/**
 * Generate a URL-safe slug from an email address.
 * Uses the local part (before @), lowercased, non-alphanumeric replaced with hyphens.
 */
const slugFromEmail = (email: string): string =>
  email
    .split('@')[0]
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/**
 * Build a workspace name from the user's display name.
 * Falls back to the email local part if no name is provided.
 */
const workspaceName = (
  name: string | null | undefined,
  email: string,
): string => {
  const displayName = name?.trim() || email.split('@')[0];
  return `${displayName}'s Workspace`;
};

/** Default "Desarrollo" board columns (matches the built-in template). */
const DEFAULT_BOARD_COLUMNS = [
  {
    name: 'Backlog',
    color: '#94a3b8',
    order: 0,
    isDone: false,
    role: 'backlog',
  },
  {
    name: 'In Progress',
    color: '#f59e0b',
    order: 1,
    isDone: false,
    role: 'in_progress',
  },
  {
    name: 'Reviewing',
    color: '#8b5cf6',
    order: 2,
    isDone: false,
    role: 'review',
  },
  {
    name: 'Validating',
    color: '#ec4899',
    order: 3,
    isDone: false,
    role: 'validating',
  },
  {
    name: 'Release',
    color: '#a855f7',
    order: 4,
    isDone: false,
    role: 'release',
  },
  { name: 'Done', color: '#22c55e', order: 5, isDone: true, role: 'done' },
] as const;

const SA_KEY_PREFIX = 'alm_sa_';

/**
 * Provision a default "runner" service account + API key for a new workspace.
 * Idempotent: skips if a runner SA already exists for the org.
 * Uses raw SQL since the frontend schema doesn't include service-account tables.
 */
const provisionDefaultServiceAccount = async (
  organizationId: string,
): Promise<void> => {
  // Check if a runner SA already exists
  const existing = await db.execute<{ id: string }>(sql`
    SELECT id FROM service_accounts
    WHERE organization_id = ${organizationId}
      AND type = 'runner'
      AND is_active = true
    LIMIT 1
  `);

  if (existing.length > 0) return; // Already provisioned

  // Create the service account and its API key in a single transaction-like block
  const [sa] = await db.execute<{ id: string }>(sql`
    INSERT INTO service_accounts (organization_id, name, type, is_active, created_at, updated_at)
    VALUES (${organizationId}, 'Default Runner', 'runner', true, NOW(), NOW())
    RETURNING id
  `);

  if (!sa) return;

  const rawHex = randomBytes(32).toString('hex');
  const keyHash = createHash('sha256').update(rawHex).digest('hex');
  const keyPrefix = `${SA_KEY_PREFIX}${rawHex.slice(0, 8)}`;

  await db.execute(sql`
    INSERT INTO api_keys (name, key_hash, key_prefix, organization_id, service_account_id)
    VALUES (
      'Default Runner API Key',
      ${keyHash},
      ${keyPrefix},
      ${organizationId},
      ${sa.id}::uuid
    )
  `);
};

/**
 * Create a default "Desarrollo" board for a new workspace.
 * Uses raw SQL since the frontend schema doesn't include board tables.
 */
const createDefaultBoard = async (organizationId: string): Promise<void> => {
  const [board] = await db.execute<{ id: string }>(sql`
    INSERT INTO boards (organization_id, name, description, area, is_default)
    VALUES (${organizationId}, 'Desarrollo', 'Board de desarrollo', 'desarrollo', true)
    RETURNING id
  `);

  if (!board) return;

  const values = DEFAULT_BOARD_COLUMNS.map(
    (col) =>
      sql`(${board.id}::uuid, ${col.name}, ${col.color}, ${col.order}, ${col.role}::column_role, ${col.isDone})`,
  );

  await db.execute(sql`
    INSERT INTO board_columns (board_id, name, color, "order", role, is_done)
    VALUES ${sql.join(values, sql`, `)}
  `);
};

/**
 * Create a personal organization for a newly registered user.
 * Idempotent: skips creation if the user already belongs to at least one org.
 */
const createPersonalOrganization = async (user: {
  id: string;
  name: string;
  email: string;
}): Promise<string | null> => {
  // Check if the user already belongs to any org (e.g. was invited before registering)
  const existingMemberships = await db
    .select({ id: schema.member.id })
    .from(schema.member)
    .where(eq(schema.member.userId, user.id))
    .limit(1);

  if (existingMemberships.length > 0) {
    return null;
  }

  const orgId = generateId();
  const memberId = generateId();
  const slug = slugFromEmail(user.email);
  const name = workspaceName(user.name, user.email);

  await db.insert(schema.organization).values({
    id: orgId,
    name,
    slug,
    createdAt: new Date(),
  });

  await db.insert(schema.member).values({
    id: memberId,
    organizationId: orgId,
    userId: user.id,
    role: 'owner',
    createdAt: new Date(),
  });

  // Auto-create default "Desarrollo" board for the new workspace
  try {
    await createDefaultBoard(orgId);
  } catch (error) {
    console.error(
      '[auth] Failed to create default board for org',
      orgId,
      error,
    );
  }

  // Auto-provision default "runner" service account + API key
  try {
    await provisionDefaultServiceAccount(orgId);
  } catch (error) {
    console.error(
      '[auth] Failed to provision default service account for org',
      orgId,
      error,
    );
  }

  return orgId;
};

const allowedEmails = (process.env.ALLOWED_EMAILS ?? '')
  .split(',')
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

const getAppBaseUrl = (): string => getInvitationAppBaseUrl(process.env);

type InvitationEmailRequest = {
  acceptUrl: string;
  email: string;
  inviterEmail: string;
  inviterName: string;
  organizationName: string;
  role: string;
};

const getInvitationEmailEndpoint = (): string => {
  const backendUrl = process.env.BACKEND_URL?.trim();
  if (backendUrl) {
    return `${backendUrl.replace(/\/+$/, '')}/internal/emails/invitations`;
  }

  const publicApiUrl = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (publicApiUrl && !publicApiUrl.startsWith('/')) {
    return `${publicApiUrl.replace(/\/+$/, '')}/internal/emails/invitations`;
  }

  return 'http://localhost:3001/internal/emails/invitations';
};

const sendInvitationEmailViaBackend = async (
  payload: InvitationEmailRequest,
): Promise<void> => {
  const secret = process.env.INTERNAL_EMAIL_API_SECRET?.trim();
  if (!secret) {
    throw new Error('INTERNAL_EMAIL_API_SECRET is not configured');
  }

  const response = await fetch(getInvitationEmailEndpoint(), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-internal-email-secret': secret,
    },
    body: JSON.stringify(payload),
    cache: 'no-store',
  });

  if (response.ok) return;

  let message = `Invitation email request failed (${response.status})`;
  try {
    const data = (await response.json()) as { error?: string };
    if (data.error) {
      message = `Invitation email request failed (${response.status}): ${data.error}`;
    }
  } catch {
    const body = await response.text().catch(() => '');
    if (body) {
      message = `Invitation email request failed (${response.status}): ${body}`;
    }
  }

  throw new Error(message);
};

type MemberRemovedEmailRequest = {
  email: string;
  memberName: string;
  organizationName: string;
  removedAt: string;
};

const getMemberRemovedEmailEndpoint = (): string => {
  const backendUrl = process.env.BACKEND_URL?.trim();
  if (backendUrl) {
    return `${backendUrl.replace(/\/+$/, '')}/internal/emails/member-removed`;
  }

  const publicApiUrl = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (publicApiUrl && !publicApiUrl.startsWith('/')) {
    return `${publicApiUrl.replace(/\/+$/, '')}/internal/emails/member-removed`;
  }

  return 'http://localhost:3001/internal/emails/member-removed';
};

export const sendMemberRemovedEmailViaBackend = async (
  payload: MemberRemovedEmailRequest,
): Promise<void> => {
  const secret = process.env.INTERNAL_EMAIL_API_SECRET?.trim();
  if (!secret) {
    throw new Error('INTERNAL_EMAIL_API_SECRET is not configured');
  }

  const response = await fetch(getMemberRemovedEmailEndpoint(), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-internal-email-secret': secret,
    },
    body: JSON.stringify(payload),
    cache: 'no-store',
  });

  if (response.ok) return;

  let message = `Member removal email request failed (${response.status})`;
  try {
    const data = (await response.json()) as { error?: string };
    if (data.error) {
      message = `Member removal email request failed (${response.status}): ${data.error}`;
    }
  } catch {
    const body = await response.text().catch(() => '');
    if (body) {
      message = `Member removal email request failed (${response.status}): ${body}`;
    }
  }

  throw new Error(message);
};

const normalizeOrigin = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed).origin;
  } catch {
    return null;
  }
};

const withWwwVariants = (origin: string): string[] => {
  try {
    const url = new URL(origin);
    const { protocol, port } = url;
    const portSuffix = port ? `:${port}` : '';
    const host = url.hostname;

    if (host.startsWith('www.')) {
      return [origin, `${protocol}//${host.slice(4)}${portSuffix}`];
    }

    return [origin, `${protocol}//www.${host}${portSuffix}`];
  } catch {
    return [origin];
  }
};

const getTrustedOrigins = (runtimePublicUrl: string | null): string[] => {
  const fromEnv = (process.env.BETTER_AUTH_TRUSTED_ORIGINS ?? '')
    .split(',')
    .map((value) => normalizeOrigin(value))
    .filter((value): value is string => Boolean(value));

  const fallbackBase = normalizeOrigin(getAppBaseUrl());
  const runtimeOrigin = runtimePublicUrl
    ? normalizeOrigin(runtimePublicUrl)
    : null;

  const origins = [
    ...getDefaultLocalFrontendOrigins(process.env),
    ...(fallbackBase ? [fallbackBase] : []),
    ...(runtimeOrigin ? [runtimeOrigin] : []),
    ...fromEnv,
  ];

  const expanded = origins.flatMap((origin) => withWwwVariants(origin));
  return [...new Set(expanded)];
};

// ──────────────────────────────────────────────
// Lazy-init auth with runtime public URL from DB
// ──────────────────────────────────────────────
// Better-Auth's `betterAuth()` bakes `baseURL` and `trustedOrigins` at creation
// time (no function/async support). To allow the Tailscale URL configured via
// the onboarding wizard to take effect WITHOUT a process restart, we lazily
// (re)create the auth instance whenever the resolved `publicUrl` changes.
//
// `getInstancePublicConfig()` caches internally with a 30s TTL, so the DB is
// not queried on every request. The auth instance is only recreated when the
// publicUrl actually changes (typically once, during initial onboarding).

// Preserve the FULL narrow type (including additionalFields like `role` and
// `locale`) so `inferAdditionalFields<typeof auth>()` in auth-client.ts picks
// them up. Using ReturnType<typeof betterAuth> directly erases the config
// generics and the client loses those fields.
type AuthInstance = ReturnType<typeof createAuthInstance>;

let cachedAuth: AuthInstance | null = null;
let cachedPublicUrl: string | null | undefined; // undefined = not yet resolved

const createAuthInstance = (runtimePublicUrl: string | null) =>
  betterAuth({
    // Prefer runtime publicUrl from DB (set via onboarding wizard / Tailscale config)
    // so the stack doesn't need a restart after initial setup. Falls back to env.
    baseURL:
      runtimePublicUrl ||
      process.env.BETTER_AUTH_URL ||
      (process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : undefined),
    trustedOrigins: getTrustedOrigins(runtimePublicUrl),
    secret: process.env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema,
    }),
    user: {
      additionalFields: {
        role: {
          type: 'string',
          defaultValue: 'user',
          input: false,
        },
        locale: {
          type: 'string',
          defaultValue: 'en',
          input: false,
        },
      },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
    },
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? {
          socialProviders: {
            google: {
              clientId: process.env.GOOGLE_CLIENT_ID,
              clientSecret: process.env.GOOGLE_CLIENT_SECRET,
              overrideUserInfoOnSignIn: true,
            },
          },
        }
      : {}),
    advanced: {
      cookies: {
        session_token: {
          attributes: {
            httpOnly: false,
          },
        },
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user: { email?: string | null }) => {
            const email = (user.email ?? '').toLowerCase();
            const pendingInvitation = await hasPendingInvitation(email);
            const bootstrapStatus = await getAuthBootstrapStatus();

            if (
              bootstrapStatus.hasUsers &&
              !bootstrapStatus.allowRegistration &&
              !pendingInvitation
            ) {
              throw new APIError('FORBIDDEN', {
                message:
                  'Registration is closed. Ask an administrator for an invitation.',
              });
            }

            if (allowedEmails.length === 0) return;
            if (!allowedEmails.includes(email)) {
              if (pendingInvitation) return; // bypass allowlist

              throw new APIError('FORBIDDEN', {
                message: `Email ${email} is not authorized. Allowed: ${allowedEmails.join(', ')}`,
              });
            }
          },
          after: async (user: { id: string; name: string; email: string }) => {
            try {
              const promotedUserId = await ensureInitialAdminUser();

              if (promotedUserId === user.id) {
                console.log(
                  `[auth] Promoted first registered user ${user.email} to global admin`,
                );
              }
            } catch (error) {
              console.error(
                '[auth] Failed to ensure initial admin user',
                error,
              );
            }

            try {
              await createPersonalOrganization({
                id: user.id,
                name: user.name,
                email: user.email,
              });
            } catch (error) {
              // Log but don't block registration -- the org can be created later
              console.error(
                '[auth] Failed to create personal organization for user',
                user.id,
                error,
              );
            }
          },
        },
      },
      session: {
        create: {
          before: async (session: {
            activeOrganizationId?: string | null;
            userId: string;
          }) => {
            // If the session already has an active org, nothing to do
            if (session.activeOrganizationId) return;

            // 1. Try to inherit activeOrganizationId from the user's most recent session
            const [previousSession] = await db
              .select({
                activeOrganizationId: schema.session.activeOrganizationId,
              })
              .from(schema.session)
              .where(
                and(
                  eq(schema.session.userId, session.userId),
                  isNotNull(schema.session.activeOrganizationId),
                ),
              )
              .orderBy(desc(schema.session.updatedAt))
              .limit(1);

            if (previousSession?.activeOrganizationId) {
              // Verify the user is still a member of that org
              const [stillMember] = await db
                .select({ id: schema.member.id })
                .from(schema.member)
                .where(
                  and(
                    eq(schema.member.userId, session.userId),
                    eq(
                      schema.member.organizationId,
                      previousSession.activeOrganizationId,
                    ),
                  ),
                )
                .limit(1);

              if (stillMember) {
                return {
                  data: {
                    ...session,
                    activeOrganizationId:
                      previousSession.activeOrganizationId,
                  },
                };
              }
            }

            // 2. Fallback: pick the oldest membership (deterministic)
            const [firstMembership] = await db
              .select({ organizationId: schema.member.organizationId })
              .from(schema.member)
              .where(eq(schema.member.userId, session.userId))
              .orderBy(schema.member.createdAt)
              .limit(1);

            if (firstMembership) {
              return {
                data: {
                  ...session,
                  activeOrganizationId: firstMembership.organizationId,
                },
              };
            }
          },
        },
      },
    },
    plugins: [
      organization({
        ac,
        roles: {
          owner: roles.owner,
          admin: roles.admin,
          member: roles.member,
        },
        allowUserToCreateOrganization: true,
        creatorRole: 'owner',
        sendInvitationEmail: async (data: {
          id: string;
          email: string;
          role: string;
          organization: { name: string };
          inviter: { user: { name: string; email: string } };
        }) => {
          const baseUrl = getAppBaseUrl();
          const acceptUrl = `${baseUrl}/accept-invitation/${data.id}`;
          const endpoint = getInvitationEmailEndpoint();

          console.log(
            `[auth] Sending invitation email to ${data.email} via ${endpoint}`,
          );

          const inviterUser = data.inviter.user;
          await sendInvitationEmailViaBackend({
            acceptUrl,
            email: data.email,
            organizationName: data.organization.name,
            inviterName: inviterUser.name,
            inviterEmail: inviterUser.email,
            role: data.role,
          });
        },
      }),
      nextCookies(),
    ],
  });

/**
 * Returns the Better-Auth instance, recreating it if the runtime publicUrl
 * (from instance_settings) has changed since last call.
 * The 30s cache in getInstancePublicConfig limits DB queries.
 */
export const getAuth = async (): Promise<AuthInstance> => {
  const config = await getInstancePublicConfig();
  const publicUrl = config.publicUrl ?? null;

  if (cachedAuth && cachedPublicUrl === publicUrl) {
    return cachedAuth;
  }

  cachedPublicUrl = publicUrl;
  cachedAuth = createAuthInstance(publicUrl);
  return cachedAuth;
};

/**
 * Eagerly created auth instance for call sites that need a synchronous export
 * (e.g. `toNextJsHandler`). Updated in the background by `getAuth()` calls.
 * Consumers that can await should prefer `getAuth()` for the freshest config.
 */
export const auth = createAuthInstance(null);
