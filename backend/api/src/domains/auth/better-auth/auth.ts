import { betterAuth, generateId } from "better-auth";
import {
  APIError,
  createAuthMiddleware,
  getSessionFromCtx,
} from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";
import { and, eq, desc, isNotNull } from "drizzle-orm";
import {
  db,
  schema,
  provisionDefaultBoard,
  provisionDefaultServiceAccount,
} from "@almirant/database";
import { env } from "@almirant/config";
import { getPublicInstanceConfig } from "../../instance/services/instance-config-service";
import { sendEmail } from "../../../shared/services/email-service";
import { buildInvitationEmailHtml } from "../../../shared/services/email/templates/invitation";
import {
  betterAuthOrganizationColumns,
  betterAuthOrganizationPluginSchema,
} from "./better-auth-organization-schema";
import {
  ensureInitialAdminUser,
  getAuthBootstrapStatus,
  hasPendingInvitation,
} from "./auth-bootstrap";
import {
  assertCanManageOrganizationMembers,
  findOrganizationMemberRole,
  resolveTargetOrganizationId,
} from "./organization-member-management-guard";
import { ac, roles } from "./auth-permissions";
import { getDefaultLocalFrontendOrigins } from "./dev-frontend-origins";
import {
  getInvitationAppBaseUrl,
  normalizeSiteUrl,
} from "./invitation-app-base-url";

// ──────────────────────────────────────────────
// Helpers for auto-org creation
// ──────────────────────────────────────────────

/**
 * Generate a URL-safe slug from an email address.
 * Uses the local part (before @), lowercased, non-alphanumeric replaced with hyphens.
 */
const slugFromEmail = (email: string): string =>
  (email.split("@")[0] ?? email)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/**
 * Build a workspace name from the user's display name.
 * Falls back to the email local part if no name is provided.
 */
const workspaceName = (
  name: string | null | undefined,
  email: string,
): string => {
  const displayName = name?.trim() || email.split("@")[0];
  return `${displayName}'s Workspace`;
};

/**
 * Create a personal organization for a newly registered user.
 * Idempotent: skips creation if the user already belongs to at least one org.
 *
 * Board + service-account provisioning is delegated to the shared repository
 * helpers (`provisionDefaultBoard` / `provisionDefaultServiceAccount`) instead
 * of the frontend's raw-SQL versions — same column set, no drift.
 */
/**
 * Injectable dependencies for {@link createPersonalOrganization}. Default to the
 * real `@almirant/database` bindings; overridable in tests with fakes (matches
 * the DI style of `auth-bootstrap.ts`). Runtime call sites pass nothing, so
 * production behavior is unchanged.
 */
interface CreatePersonalOrganizationDeps {
  db?: typeof db;
  provisionDefaultBoard?: typeof provisionDefaultBoard;
  provisionDefaultServiceAccount?: typeof provisionDefaultServiceAccount;
}

export const createPersonalOrganization = async (
  user: {
    id: string;
    name: string;
    email: string;
  },
  deps: CreatePersonalOrganizationDeps = {},
): Promise<string | null> => {
  const database = deps.db ?? db;
  const provisionBoard = deps.provisionDefaultBoard ?? provisionDefaultBoard;
  const provisionServiceAccount =
    deps.provisionDefaultServiceAccount ?? provisionDefaultServiceAccount;

  // Check if the user already belongs to any org (e.g. was invited before registering)
  const existingMemberships = await database
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

  await database.insert(schema.workspace).values({
    id: orgId,
    name,
    slug,
    createdAt: new Date(),
  });

  await database.insert(schema.member).values({
    id: memberId,
    workspaceId: orgId,
    userId: user.id,
    role: "owner",
    createdAt: new Date(),
  });

  // Auto-create default "Desarrollo" board for the new workspace
  try {
    await provisionBoard(orgId);
  } catch (error) {
    console.error("[auth] Failed to create default board for org", orgId, error);
  }

  // Auto-provision default "runner" service account + API key
  try {
    await provisionServiceAccount(orgId);
  } catch (error) {
    console.error(
      "[auth] Failed to provision default service account for org",
      orgId,
      error,
    );
  }

  return orgId;
};

const allowedEmails = (env.ALLOWED_EMAILS ?? "")
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

/**
 * Resolve the base URL used to build invitation accept links. The accept page
 * lives on the FRONTEND, so an explicit site URL wins; in a self-hosted install
 * the frontend shares the instance public URL, so we prefer that over the
 * frontend's localhost default.
 */
const resolveInvitationAppBaseUrl = (runtimePublicUrl: string | null): string => {
  const explicit =
    normalizeSiteUrl(process.env.NEXT_PUBLIC_SITE_URL) ??
    normalizeSiteUrl(process.env.BETTER_AUTH_URL);
  if (explicit) return explicit;

  const runtimeBase = runtimePublicUrl
    ? normalizeSiteUrl(runtimePublicUrl)
    : null;
  if (runtimeBase) return runtimeBase;

  return getInvitationAppBaseUrl(process.env);
};

/**
 * Send an organization invitation email IN-PROCESS. Replaces the frontend's
 * HTTP POST to `/internal/emails/invitations` (which no longer exists) with a
 * direct `sendEmail(...)` + `buildInvitationEmailHtml(...)` call.
 */
export const sendInvitationEmailInProcess = async (payload: {
  acceptUrl: string;
  email: string;
  organizationName: string;
  inviterName: string;
  inviterEmail: string;
  role: string;
}): Promise<void> => {
  const html = buildInvitationEmailHtml({
    acceptUrl: payload.acceptUrl,
    workspaceName: payload.organizationName,
    inviterName: payload.inviterName,
    inviterEmail: payload.inviterEmail,
    role: payload.role,
  });

  const result = await sendEmail({
    to: payload.email,
    subject: `You've been invited to ${payload.organizationName}`,
    html,
  });

  if (!result.success) {
    throw new Error(
      result.error ?? "Failed to send invitation email",
    );
  }
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
    const portSuffix = port ? `:${port}` : "";
    const host = url.hostname;

    if (host.startsWith("www.")) {
      return [origin, `${protocol}//${host.slice(4)}${portSuffix}`];
    }

    return [origin, `${protocol}//www.${host}${portSuffix}`];
  } catch {
    return [origin];
  }
};

/**
 * Union of trusted origins for Better-Auth:
 *   - dev frontend origins (localhost:3000, orbstack) in non-prod
 *   - `env.CORS_ORIGIN` (comma list — the configured frontend allowlist)
 *   - the runtime public URL from `instance_settings` (Tailscale / reverse
 *     proxy origin set via the onboarding wizard, so it works without restart)
 *   - `env.BETTER_AUTH_TRUSTED_ORIGINS` (comma list — explicit overrides)
 * Every origin is expanded with its www / apex variant.
 */
/**
 * Config-env slice consumed by {@link getTrustedOrigins}. Defaults to the real
 * `@almirant/config` `env`; injectable so the resolution can be unit-tested
 * with explicit maps and no module side effects.
 */
interface TrustedOriginsConfigEnv {
  CORS_ORIGIN: string;
  BETTER_AUTH_TRUSTED_ORIGINS?: string | null;
}

export const getTrustedOrigins = (
  runtimePublicUrl: string | null,
  configEnv: TrustedOriginsConfigEnv = env,
  processEnv: { NODE_ENV?: string } = process.env,
): string[] => {
  const fromCors = configEnv.CORS_ORIGIN.split(",")
    .map((value) => normalizeOrigin(value))
    .filter((value): value is string => Boolean(value));

  const fromEnv = (configEnv.BETTER_AUTH_TRUSTED_ORIGINS ?? "")
    .split(",")
    .map((value) => normalizeOrigin(value))
    .filter((value): value is string => Boolean(value));

  const runtimeOrigin = runtimePublicUrl
    ? normalizeOrigin(runtimePublicUrl)
    : null;

  const origins = [
    ...getDefaultLocalFrontendOrigins(processEnv),
    ...fromCors,
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
// `getPublicInstanceConfig()` reads the in-process instance-settings cache, so
// the DB is not queried on every request. The auth instance is only recreated
// when the publicUrl actually changes (typically once, during onboarding).

// Preserve the FULL narrow type (including additionalFields like `role` and
// `locale`) so `inferAdditionalFields<typeof auth>()` in the frontend
// auth-client picks them up. Using ReturnType<typeof betterAuth> directly
// erases the config generics and the client loses those fields.
type AuthInstance = ReturnType<typeof createAuthInstance>;

let cachedAuth: AuthInstance | null = null;
let cachedPublicUrl: string | null | undefined; // undefined = not yet resolved

export const createAuthInstance = (runtimePublicUrl: string | null) =>
  betterAuth({
    // Explicit issuer URL (`BETTER_AUTH_URL`) wins; otherwise use the runtime
    // publicUrl from `instance_settings` (set via the onboarding wizard) so the
    // stack doesn't need a restart after initial setup.
    baseURL: env.BETTER_AUTH_URL || runtimePublicUrl || undefined,
    trustedOrigins: getTrustedOrigins(runtimePublicUrl),
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema,
    }),
    user: {
      additionalFields: {
        role: {
          type: "string",
          defaultValue: "user",
          input: false,
        },
        locale: {
          type: "string",
          defaultValue: "en",
          input: false,
        },
      },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
    },
    ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? {
          socialProviders: {
            google: {
              clientId: env.GOOGLE_CLIENT_ID,
              clientSecret: env.GOOGLE_CLIENT_SECRET,
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
      // Only meaningful when AUTH_COOKIE_DOMAIN is set (e.g. ".almirant.ai" to
      // share the session cookie across api.* and app.* subdomains). Unset for
      // self-host ⇒ host-only cookie (no cross-subdomain sharing).
      crossSubDomainCookies: {
        enabled: Boolean(env.AUTH_COOKIE_DOMAIN),
        domain: env.AUTH_COOKIE_DOMAIN,
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        const session = ctx.context.session ?? (await getSessionFromCtx(ctx));

        // Resolve the workspace the request TARGETS (body override falling back
        // to the active workspace), matching how the Better-Auth organization
        // endpoints pick the workspace they mutate — so the caller's role is
        // authorized against the same workspace, not just whatever is active.
        const body = ctx.body as { organizationId?: string | null } | undefined;

        await assertCanManageOrganizationMembers({
          findMemberRole: (params) => findOrganizationMemberRole(db, params),
          path: ctx.path,
          userId: session?.user?.id ?? null,
          organizationId: resolveTargetOrganizationId(body, {
            activeOrganizationId:
              session?.session?.activeOrganizationId ?? null,
          }),
        });
      }),
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user: { email?: string | null }) => {
            const email = (user.email ?? "").toLowerCase();
            const pendingInvitation = await hasPendingInvitation(email);
            const bootstrapStatus = await getAuthBootstrapStatus();

            if (
              bootstrapStatus.hasUsers &&
              !bootstrapStatus.allowRegistration &&
              !pendingInvitation
            ) {
              throw new APIError("FORBIDDEN", {
                message:
                  "Registration is closed. Ask an administrator for an invitation.",
              });
            }

            if (allowedEmails.length === 0) return;
            if (!allowedEmails.includes(email)) {
              if (pendingInvitation) return; // bypass allowlist

              throw new APIError("FORBIDDEN", {
                message: `Email ${email} is not authorized. Allowed: ${allowedEmails.join(", ")}`,
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
                "[auth] Failed to ensure initial admin user",
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
                "[auth] Failed to create personal organization for user",
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
                activeOrganizationId:
                  betterAuthOrganizationColumns.sessionActiveOrganizationId,
              })
              .from(schema.session)
              .where(
                and(
                  eq(schema.session.userId, session.userId),
                  isNotNull(
                    betterAuthOrganizationColumns.sessionActiveOrganizationId,
                  ),
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
                      betterAuthOrganizationColumns.memberOrganizationId,
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
              .select({
                organizationId:
                  betterAuthOrganizationColumns.memberOrganizationId,
              })
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
        creatorRole: "owner",
        // The DB table was renamed to "workspace"; Better-Auth maps the logical
        // "organization" model / fields to the Drizzle schema keys below.
        schema: betterAuthOrganizationPluginSchema,
        sendInvitationEmail: async (data: {
          id: string;
          email: string;
          role: string;
          organization: { name: string };
          inviter: { user: { name: string; email: string } };
        }) => {
          const baseUrl = resolveInvitationAppBaseUrl(runtimePublicUrl);
          const acceptUrl = `${baseUrl}/accept-invitation/${data.id}`;

          console.log(
            `[auth] Sending invitation email to ${data.email} (accept: ${acceptUrl})`,
          );

          const inviterUser = data.inviter.user;
          await sendInvitationEmailInProcess({
            acceptUrl,
            email: data.email,
            organizationName: data.organization.name,
            inviterName: inviterUser.name,
            inviterEmail: inviterUser.email,
            role: data.role,
          });
        },
      }),
    ],
  });

/**
 * Returns the Better-Auth instance, recreating it if the runtime publicUrl
 * (from instance_settings) has changed since last call. The in-process
 * instance-settings cache limits DB queries.
 */
export const getAuth = async (): Promise<AuthInstance> => {
  const config = await getPublicInstanceConfig();
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
 * (e.g. type inference for the frontend auth-client). Created with a null
 * runtime publicUrl so module load never touches the DB / blocks startup;
 * `getAuth()` refreshes it in the background once the publicUrl resolves.
 */
export const auth = createAuthInstance(null);
