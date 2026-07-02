import type {
  PermissionChecker,
  PermissionSubject,
} from "@almirant/shared";

const ADMIN_ROLES = new Set(["owner", "admin"]);

/**
 * Actions that require admin/owner privileges in the Community Edition.
 * This list captures the ad-hoc `["admin", "owner"].includes(role)` checks
 * that were previously inline in routes. Members (non-admin) are DENIED these.
 *
 * Enterprise Edition can inject a richer PermissionChecker with RBAC.
 */
const PROJECT_MANAGEMENT_ACTIONS = new Set([
  "project.edit",
  "project.transfer",
  "project.archive",
  "project.delete",
  "project.member.add",
  "project.member.remove",
  "work-item.delete",
  "workspace.invite",
  "workspace.remove-member",
  "feedback.screenshot.delete",
  "feedback.screenshot.read",
  // Extend as inline checks are migrated from other routes.
]);

/**
 * Default permission checker for the Community Edition.
 *
 * Rules:
 * - null role → denied (no valid membership)
 * - owner / admin → allowed for any action
 * - member → allowed for non-management actions only
 */
export const defaultPermissionChecker: PermissionChecker = {
  can(subject: PermissionSubject, action: string) {
    if (subject.role === null) return false;

    if (ADMIN_ROLES.has(subject.role)) return true;

    if (subject.role === "member") {
      return !PROJECT_MANAGEMENT_ACTIONS.has(action);
    }

    return false;
  },
};
