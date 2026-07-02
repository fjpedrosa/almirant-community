/**
 * Regression tests for the privilege-escalation guard ported from enterprise
 * (commit 1ebb59614, feedback d8ad3864-0e61-405c-b832-8baf2fd1235e):
 * a plain `member` could call the Better-Auth organization endpoints
 * (update-member-role / remove-member / invite-member) and promote
 * themselves — or anyone else — to admin/owner. Only owners and admins may
 * manage workspace members.
 *
 * HARDENING (Finding 1): the guard originally resolved the caller's role in
 * their ACTIVE workspace (session.activeOrganizationId), but these endpoints
 * accept a body `organizationId` that overrides the active workspace. The
 * caller's role must be resolved in the TARGET workspace of the request, just
 * like Better-Auth's own authoritative check — otherwise an owner in workspace
 * A but a mere member of workspace B could pass the guard for a request
 * targeting B. See resolveTargetOrganizationId + the cross-workspace test.
 *
 * Note on naming: the Better-Auth plugin keeps its `organization*` names
 * (paths like `/organization/update-member-role`) even though the product
 * model is "workspace" — see better-auth-organization-schema.ts.
 */
import { describe, expect, it, mock } from 'bun:test';
import { APIError } from 'better-auth/api';
import {
  assertCanManageOrganizationMembers,
  resolveTargetOrganizationId,
} from './organization-member-management-guard';

describe('resolveTargetOrganizationId', () => {
  it('prefers the request body organizationId (the target workspace) over the active one', () => {
    expect(
      resolveTargetOrganizationId(
        { organizationId: 'workspace-B' },
        { activeOrganizationId: 'workspace-A' },
      ),
    ).toBe('workspace-B');
  });

  it('falls back to the active workspace when the body omits organizationId', () => {
    expect(
      resolveTargetOrganizationId(
        {},
        { activeOrganizationId: 'workspace-A' },
      ),
    ).toBe('workspace-A');
  });

  it('returns null when neither is present', () => {
    expect(
      resolveTargetOrganizationId(undefined, { activeOrganizationId: null }),
    ).toBeNull();
  });
});

describe('assertCanManageOrganizationMembers', () => {
  it('rejects member callers for sensitive organization member endpoints', async () => {
    const findMemberRole = mock(async () => 'member');

    let thrownError: unknown = null;

    try {
      await assertCanManageOrganizationMembers({
        findMemberRole,
        path: '/organization/update-member-role',
        userId: 'user-1',
        organizationId: 'workspace-1',
      });
    } catch (error) {
      thrownError = error;
    }

    expect(findMemberRole).toHaveBeenCalledWith({
      userId: 'user-1',
      organizationId: 'workspace-1',
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
          userId: 'user-1',
          organizationId: 'workspace-1',
        }),
      ).resolves.toBeUndefined();
    },
  );

  it('resolves the caller role in the TARGET workspace, not the active one (cross-workspace)', async () => {
    // Caller is an admin in their active workspace A but only a member of the
    // target workspace B named in the request body. The guard must key off the
    // target workspace and reject.
    const roleByWorkspace: Record<string, string> = {
      'workspace-A': 'admin',
      'workspace-B': 'member',
    };
    const findMemberRole = mock(
      async ({ organizationId }: { organizationId: string; userId: string }) =>
        roleByWorkspace[organizationId] ?? null,
    );

    await expect(
      assertCanManageOrganizationMembers({
        findMemberRole,
        path: '/organization/update-member-role',
        userId: 'user-1',
        organizationId: 'workspace-B',
      }),
    ).rejects.toBeInstanceOf(APIError);

    expect(findMemberRole).toHaveBeenCalledWith({
      userId: 'user-1',
      organizationId: 'workspace-B',
    });
  });

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
        userId: 'user-1',
        organizationId: 'workspace-1',
      }),
    ).rejects.toBeInstanceOf(APIError);
  });

  it('ignores non-sensitive paths without looking up the caller role', async () => {
    const findMemberRole = mock(async () => 'member');

    await expect(
      assertCanManageOrganizationMembers({
        findMemberRole,
        path: '/organization/get-full-organization',
        userId: 'user-1',
        organizationId: 'workspace-1',
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
        userId: null,
        organizationId: null,
      });
    } catch (error) {
      thrownError = error;
    }

    expect(thrownError).toBeInstanceOf(APIError);
    expect((thrownError as APIError | null)?.status).toBe('UNAUTHORIZED');
    expect(findMemberRole).not.toHaveBeenCalled();
  });

  it('rejects callers with no membership in the target workspace', async () => {
    const findMemberRole = mock(async () => null);

    await expect(
      assertCanManageOrganizationMembers({
        findMemberRole,
        path: '/organization/remove-member',
        userId: 'user-outsider',
        organizationId: 'workspace-1',
      }),
    ).rejects.toBeInstanceOf(APIError);
  });
});
