/**
 * Regression tests for the privilege-escalation fix ported from enterprise
 * (commit 1ebb59614, feedback d8ad3864-0e61-405c-b832-8baf2fd1235e):
 * a plain `member` could call the Better-Auth organization endpoints
 * (update-member-role / remove-member / invite-member) and promote
 * themselves — or anyone else — to admin/owner. Only owners and admins may
 * manage workspace members.
 *
 * Note on naming: the Better-Auth plugin keeps its `organization*` names
 * (paths like `/organization/update-member-role`) even though the product
 * model is "workspace" — see better-auth-organization-schema.ts.
 */
import { describe, expect, it, mock } from 'bun:test';
import { APIError } from 'better-auth/api';
import { assertCanManageOrganizationMembers } from './organization-member-management-guard';

describe('assertCanManageOrganizationMembers', () => {
  it('rejects member callers for sensitive organization member endpoints', async () => {
    const findMemberRole = mock(async () => 'member');

    let thrownError: unknown = null;

    try {
      await assertCanManageOrganizationMembers({
        findMemberRole,
        path: '/organization/update-member-role',
        session: {
          userId: 'user-1',
          activeOrganizationId: 'workspace-1',
        },
      });
    } catch (error) {
      thrownError = error;
    }

    expect(findMemberRole).toHaveBeenCalledWith({
      userId: 'user-1',
      activeOrganizationId: 'workspace-1',
    });
    expect(thrownError).toBeInstanceOf(APIError);
    expect((thrownError as APIError | null)?.message).toContain(
      'Only owners and admins can manage workspace members',
    );
  });

  it.each(['owner', 'admin'])(
    'allows %s callers to manage members',
    async (role) => {
      const findMemberRole = mock(async () => role);

      await expect(
        assertCanManageOrganizationMembers({
          findMemberRole,
          path: '/organization/update-member-role',
          session: {
            userId: 'user-1',
            activeOrganizationId: 'workspace-1',
          },
        }),
      ).resolves.toBeUndefined();
    },
  );

  it.each([
    '/organization/update-member-role',
    '/organization/remove-member',
    '/organization/invite-member',
  ])('guards the sensitive path %s', async (path) => {
    const findMemberRole = mock(async () => 'member');

    await expect(
      assertCanManageOrganizationMembers({
        findMemberRole,
        path,
        session: {
          userId: 'user-1',
          activeOrganizationId: 'workspace-1',
        },
      }),
    ).rejects.toBeInstanceOf(APIError);
  });

  it('ignores non-sensitive paths without looking up the caller role', async () => {
    const findMemberRole = mock(async () => 'member');

    await expect(
      assertCanManageOrganizationMembers({
        findMemberRole,
        path: '/organization/get-full-organization',
        session: {
          userId: 'user-1',
          activeOrganizationId: 'workspace-1',
        },
      }),
    ).resolves.toBeUndefined();

    expect(findMemberRole).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated callers on sensitive paths', async () => {
    const findMemberRole = mock(async () => 'owner');

    let thrownError: unknown = null;
    try {
      await assertCanManageOrganizationMembers({
        findMemberRole,
        path: '/organization/update-member-role',
        session: {
          userId: null,
          activeOrganizationId: null,
        },
      });
    } catch (error) {
      thrownError = error;
    }

    expect(thrownError).toBeInstanceOf(APIError);
    expect((thrownError as APIError | null)?.status).toBe('UNAUTHORIZED');
    expect(findMemberRole).not.toHaveBeenCalled();
  });

  it('rejects callers with no membership in the active workspace', async () => {
    const findMemberRole = mock(async () => null);

    await expect(
      assertCanManageOrganizationMembers({
        findMemberRole,
        path: '/organization/remove-member',
        session: {
          userId: 'user-outsider',
          activeOrganizationId: 'workspace-1',
        },
      }),
    ).rejects.toBeInstanceOf(APIError);
  });
});
