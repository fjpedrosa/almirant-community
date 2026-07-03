import { describe, expect, it } from "bun:test";
import { schema } from "@almirant/database";
import {
  BETTER_AUTH_ORGANIZATION_FIELD_NAMES,
  betterAuthOrganizationColumns,
  betterAuthOrganizationPluginSchema,
} from "./better-auth-organization-schema";

describe("betterAuthOrganizationPluginSchema", () => {
  it("keeps Better Auth logical fields aligned with the physical workspace columns", () => {
    expect(betterAuthOrganizationPluginSchema.organization.modelName).toBe(
      "workspace",
    );

    expect(betterAuthOrganizationPluginSchema.member.fields.organizationId).toBe(
      BETTER_AUTH_ORGANIZATION_FIELD_NAMES.memberOrganizationId,
    );
    expect(
      betterAuthOrganizationPluginSchema.invitation.fields.organizationId,
    ).toBe(BETTER_AUTH_ORGANIZATION_FIELD_NAMES.invitationOrganizationId);
    expect(
      betterAuthOrganizationPluginSchema.session.fields.activeOrganizationId,
    ).toBe(
      BETTER_AUTH_ORGANIZATION_FIELD_NAMES.sessionActiveOrganizationId,
    );

    expect(betterAuthOrganizationColumns.memberOrganizationId).toBe(
      schema.member.workspaceId,
    );
    expect(betterAuthOrganizationColumns.invitationOrganizationId).toBe(
      schema.invitation.workspaceId,
    );
    expect(betterAuthOrganizationColumns.sessionActiveOrganizationId).toBe(
      schema.session.activeWorkspaceId,
    );
  });
});
