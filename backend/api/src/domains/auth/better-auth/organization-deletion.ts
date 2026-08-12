import { APIError } from "better-auth/api";
import { and, eq, sql } from "drizzle-orm";
import {
  db,
  NOTES_GLOBAL_ADVISORY_LOCK,
  schema,
  type Database,
} from "@almirant/database";
import { roles } from "./auth-permissions";
import { betterAuthOrganizationColumns } from "./better-auth-organization-schema";

type OrganizationDeletionInput = {
  organizationId: string;
  userId: string;
};

type OrganizationDeletionDeps = {
  db?: Database;
  failAfterDelete?: boolean;
};

/**
 * Deletes a workspace through the product-owned transaction boundary.
 * Better-Auth's organization route deletes members/invitations before the
 * organization and cannot roll those writes back when Notes guards reject a
 * page cascade, so the auth hook delegates here instead.
 */
export const deleteOrganizationAtomically = async (
  input: OrganizationDeletionInput,
  deps: OrganizationDeletionDeps = {},
) => {
  const database = deps.db ?? db;
  return database.transaction(async (transaction) => {
    // Keep auth deletion in the same total order as every Notes writer/raw DML.
    await transaction.execute(
      sql`SELECT pg_advisory_xact_lock(${NOTES_GLOBAL_ADVISORY_LOCK}::bigint)`,
    );

    const [membership] = await transaction
      .select({ id: schema.member.id, role: schema.member.role })
      .from(schema.member)
      .where(
        and(
          eq(schema.member.workspaceId, input.organizationId),
          eq(schema.member.userId, input.userId),
        ),
      )
      .limit(1)
      .for("update");

    if (!membership) {
      throw new APIError("BAD_REQUEST", {
        message: "User is not a member of the organization",
      });
    }

    const membershipRoles = membership.role.split(",");
    const canDelete = membershipRoles.some((roleName) => {
      const role = roles[roleName as keyof typeof roles];
      return role?.authorize({ organization: ["delete"] }).success === true;
    });
    if (!canDelete) {
      throw new APIError("FORBIDDEN", {
        message: "You are not allowed to delete this organization",
      });
    }

    const [organization] = await transaction
      .select()
      .from(schema.workspace)
      .where(eq(schema.workspace.id, input.organizationId))
      .limit(1)
      .for("update");

    if (!organization) {
      throw new APIError("BAD_REQUEST", {
        message: "Organization not found",
      });
    }

    // Better-Auth stores the active organization on every session row. Clear
    // all references before the parent cascade so no session points at a
    // deleted workspace even when no FK exists on this compatibility column.
    await transaction
      .update(schema.session)
      .set({ activeWorkspaceId: null })
      .where(eq(betterAuthOrganizationColumns.sessionActiveOrganizationId, input.organizationId));

    const deleted = await transaction
      .delete(schema.workspace)
      .where(eq(schema.workspace.id, input.organizationId))
      .returning();

    if (!deleted[0]) {
      throw new APIError("BAD_REQUEST", { message: "Organization not found" });
    }
    if (deps.failAfterDelete) throw new Error("ORGANIZATION_DELETE_INJECTED_FAILURE");

    return deleted[0];
  });
};
