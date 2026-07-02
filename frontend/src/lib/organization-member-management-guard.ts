import { APIError } from 'better-auth/api';
import { and, eq } from 'drizzle-orm';
import { betterAuthOrganizationColumns } from './better-auth-organization-schema';
import type { db } from './db';
import * as schema from './schema';

/**
 * Better-Auth organization-plugin endpoints that mutate workspace membership.
 * Only owners and admins may call them; without this guard any `member` could
 * escalate themselves (or anyone else) to admin/owner via
 * `/organization/update-member-role`.
 *
 * The paths keep the plugin's `organization*` naming even though the product
 * model is "workspace" — see better-auth-organization-schema.ts for the
 * model/field mapping.
 */
export const SENSITIVE_ORGANIZATION_MEMBER_PATHS = new Set([
  '/organization/update-member-role',
  '/organization/remove-member',
  '/organization/invite-member',
]);

type OrganizationMemberRoleLookup = (params: {
  organizationId: string;
  userId: string;
}) => Promise<string | null>;

type OrganizationMemberManagementAccessParams = {
  findMemberRole: OrganizationMemberRoleLookup;
  path: string;
  userId: string | null;
  /**
   * The TARGET workspace of the request — already resolved via
   * `resolveTargetOrganizationId` (body override, falling back to the active
   * workspace). The caller's role must be checked here, not in whatever
   * workspace happens to be active on the session.
   */
  organizationId: string | null;
};

export const isSensitiveOrganizationMemberPath = (path: string): boolean =>
  SENSITIVE_ORGANIZATION_MEMBER_PATHS.has(path);

/**
 * Resolve the workspace a member-management request actually targets. The
 * Better-Auth organization endpoints accept a body `organizationId` that
 * overrides the session's active workspace (and the plugin itself checks the
 * caller's role against that target). We mirror that resolution so the guard
 * authorizes against the same workspace the plugin will mutate.
 */
export const resolveTargetOrganizationId = (
  body: { organizationId?: string | null } | null | undefined,
  session: { activeOrganizationId: string | null },
): string | null => body?.organizationId ?? session.activeOrganizationId ?? null;

export const findOrganizationMemberRole = async (
  database: typeof db,
  params: {
    organizationId: string;
    userId: string;
  },
): Promise<string | null> => {
  const [membership] = await database
    .select({ role: schema.member.role })
    .from(schema.member)
    .where(
      and(
        eq(schema.member.userId, params.userId),
        eq(
          betterAuthOrganizationColumns.memberOrganizationId,
          params.organizationId,
        ),
      ),
    )
    .limit(1);

  return membership?.role ?? null;
};

export const assertCanManageOrganizationMembers = async ({
  findMemberRole,
  path,
  userId,
  organizationId,
}: OrganizationMemberManagementAccessParams): Promise<void> => {
  if (!isSensitiveOrganizationMemberPath(path)) {
    return;
  }

  if (!userId || !organizationId) {
    throw new APIError('UNAUTHORIZED', {
      message: 'Not authenticated',
    });
  }

  const callerRole = await findMemberRole({
    userId,
    organizationId,
  });

  if (callerRole === 'owner' || callerRole === 'admin') {
    return;
  }

  throw new APIError('FORBIDDEN', {
    message: 'Only owners and admins can manage workspace members',
  });
};
