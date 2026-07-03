import { schema } from "@almirant/database";

const BETTER_AUTH_ORGANIZATION_MODEL_NAME =
  "workspace" as const satisfies keyof typeof schema;

export const BETTER_AUTH_ORGANIZATION_FIELD_NAMES = {
  memberOrganizationId: "workspaceId",
  invitationOrganizationId: "workspaceId",
  sessionActiveOrganizationId: "activeWorkspaceId",
} as const satisfies {
  memberOrganizationId: keyof typeof schema.member;
  invitationOrganizationId: keyof typeof schema.invitation;
  sessionActiveOrganizationId: keyof typeof schema.session;
};

export const betterAuthOrganizationColumns = {
  memberOrganizationId:
    schema.member[BETTER_AUTH_ORGANIZATION_FIELD_NAMES.memberOrganizationId],
  invitationOrganizationId:
    schema.invitation[
      BETTER_AUTH_ORGANIZATION_FIELD_NAMES.invitationOrganizationId
    ],
  sessionActiveOrganizationId:
    schema.session[
      BETTER_AUTH_ORGANIZATION_FIELD_NAMES.sessionActiveOrganizationId
    ],
} as const;

export const betterAuthOrganizationPluginSchema = {
  organization: {
    modelName: BETTER_AUTH_ORGANIZATION_MODEL_NAME,
  },
  member: {
    fields: {
      organizationId: BETTER_AUTH_ORGANIZATION_FIELD_NAMES.memberOrganizationId,
    },
  },
  invitation: {
    fields: {
      organizationId:
        BETTER_AUTH_ORGANIZATION_FIELD_NAMES.invitationOrganizationId,
    },
  },
  session: {
    fields: {
      activeOrganizationId:
        BETTER_AUTH_ORGANIZATION_FIELD_NAMES.sessionActiveOrganizationId,
    },
  },
} as const;
