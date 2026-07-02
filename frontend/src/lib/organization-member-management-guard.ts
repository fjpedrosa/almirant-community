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
  activeOrganizationId: string;
  userId: string;
}) => Promise<string | null>;

type OrganizationMemberManagementAccessParams = {
  findMemberRole: OrganizationMemberRoleLookup;
  path: string;
  session: {
    activeOrganizationId: string | null;
    userId: string | null;
  };
};

export const isSensitiveOrganizationMemberPath = (path: string): boolean =>
  SENSITIVE_ORGANIZATION_MEMBER_PATHS.has(path);

export const findOrganizationMemberRole = async (
  database: typeof db,
  params: {
    activeOrganizationId: string;
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
          params.activeOrganizationId,
        ),
      ),
    )
    .limit(1);

  return membership?.role ?? null;
};

export const assertCanManageOrganizationMembers = async ({
  findMemberRole,
  path,
  session,
}: OrganizationMemberManagementAccessParams): Promise<void> => {
  if (!isSensitiveOrganizationMemberPath(path)) {
    return;
  }

  if (!session.userId || !session.activeOrganizationId) {
    throw new APIError('UNAUTHORIZED', {
      message: 'Not authenticated',
    });
  }

  const callerRole = await findMemberRole({
    userId: session.userId,
    activeOrganizationId: session.activeOrganizationId,
  });

  if (callerRole === 'owner' || callerRole === 'admin') {
    return;
  }

  throw new APIError('FORBIDDEN', {
    message: 'Only owners and admins can manage workspace members',
  });
};
