import { createAccessControl } from "better-auth/plugins/access";

/**
 * Almirant permission statements.
 *
 * Combines Better-Auth's built-in organization resources (organization, member,
 * invitation, team, ac) with Almirant-specific resources (project,
 * workItem, board) so that a single AccessControl instance governs everything.
 */
const statements = {
  // --- Better-Auth organization built-ins ---
  organization: ["update", "delete"],
  member: ["create", "update", "delete"],
  invitation: ["create", "cancel"],
  team: ["create", "update", "delete"],
  ac: ["create", "read", "update", "delete"],

  // --- Almirant resources ---
  project: ["create", "read", "update", "delete"],
  workItem: ["create", "read", "update", "delete", "move", "assign"],
  board: ["create", "read", "update", "delete"],
} as const;

export type Statements = typeof statements;

/**
 * Central access-control instance used by the organization plugin.
 */
export const ac = createAccessControl(statements);

/**
 * Owner -- full permissions on every resource, including org deletion.
 */
const owner = ac.newRole({
  organization: ["update", "delete"],
  member: ["create", "update", "delete"],
  invitation: ["create", "cancel"],
  team: ["create", "update", "delete"],
  ac: ["create", "read", "update", "delete"],
  project: ["create", "read", "update", "delete"],
  workItem: ["create", "read", "update", "delete", "move", "assign"],
  board: ["create", "read", "update", "delete"],
});

/**
 * Admin -- all permissions except deleting the organization itself.
 */
const admin = ac.newRole({
  organization: ["update"],
  member: ["create", "update", "delete"],
  invitation: ["create", "cancel"],
  team: ["create", "update", "delete"],
  ac: ["create", "read", "update", "delete"],
  project: ["create", "read", "update", "delete"],
  workItem: ["create", "read", "update", "delete", "move", "assign"],
  board: ["create", "read", "update", "delete"],
});

/**
 * Member -- day-to-day contributor.  Can read/create/update projects, work
 * items, and boards; can move and be assigned work items.  Cannot delete any
 * entity and has no member/invitation/team/ac management rights.
 */
const member = ac.newRole({
  organization: [],
  member: [],
  invitation: [],
  team: [],
  ac: ["read"],
  project: ["create", "read", "update"],
  workItem: ["create", "read", "update", "move", "assign"],
  board: ["read"],
});

/**
 * Roles map consumed by the organization plugin's `roles` option.
 */
export const roles = { owner, admin, member } as const;
