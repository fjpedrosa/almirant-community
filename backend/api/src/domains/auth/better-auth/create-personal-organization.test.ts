import { describe, expect, it, mock } from "bun:test";
import { schema } from "@almirant/database";
import { createPersonalOrganization } from "./auth.ts";

// Fakes injected through the DI seam — the real DB / provisioning helpers are
// never touched. We capture every `insert(...).values(...)` payload so we can
// assert the exact schema writes the signup provisioning performs.

interface CapturedInsert {
  table: unknown;
  values: Record<string, unknown>;
}

const createFakeDb = (existingMemberships: unknown[]) => {
  const inserts: CapturedInsert[] = [];

  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => existingMemberships,
        }),
      }),
    }),
    insert: (table: unknown) => ({
      values: async (values: Record<string, unknown>) => {
        inserts.push({ table, values });
      },
    }),
  };

  return { db, inserts };
};

describe("createPersonalOrganization", () => {
  it("provisions a workspace, owner membership, board and service account for a fresh user", async () => {
    const { db, inserts } = createFakeDb([]); // no existing memberships
    const provisionDefaultBoard = mock(async () => {});
    const provisionDefaultServiceAccount = mock(async () => {});

    const orgId = await createPersonalOrganization(
      { id: "user-1", name: "Jane Doe", email: "jane.doe@example.com" },
      {
        db: db as never,
        provisionDefaultBoard: provisionDefaultBoard as never,
        provisionDefaultServiceAccount: provisionDefaultServiceAccount as never,
      },
    );

    expect(orgId).toBeTruthy();

    // exactly two inserts: one workspace, one member
    expect(inserts).toHaveLength(2);

    const workspaceInsert = inserts[0]!;
    expect(workspaceInsert.table).toBe(schema.workspace);
    expect(workspaceInsert.values.id).toBe(orgId);
    // name derived from the display name
    expect(workspaceInsert.values.name).toBe("Jane Doe's Workspace");
    // slug derived from the email local-part
    expect(workspaceInsert.values.slug).toBe("jane-doe");
    expect(workspaceInsert.values.createdAt).toBeInstanceOf(Date);

    const memberInsert = inserts[1]!;
    expect(memberInsert.table).toBe(schema.member);
    expect(memberInsert.values.role).toBe("owner");
    expect(memberInsert.values.userId).toBe("user-1");
    // membership is wired to the workspace we just created
    expect(memberInsert.values.workspaceId).toBe(orgId);

    // exactly one call each, with the new org id
    expect(provisionDefaultBoard).toHaveBeenCalledTimes(1);
    expect(provisionDefaultBoard).toHaveBeenCalledWith(orgId);
    expect(provisionDefaultServiceAccount).toHaveBeenCalledTimes(1);
    expect(provisionDefaultServiceAccount).toHaveBeenCalledWith(orgId);
  });

  it("falls back to the email local-part for the workspace name when no display name", async () => {
    const { db, inserts } = createFakeDb([]);
    const provisionDefaultBoard = mock(async () => {});
    const provisionDefaultServiceAccount = mock(async () => {});

    await createPersonalOrganization(
      { id: "user-2", name: "   ", email: "solo@example.com" },
      {
        db: db as never,
        provisionDefaultBoard: provisionDefaultBoard as never,
        provisionDefaultServiceAccount: provisionDefaultServiceAccount as never,
      },
    );

    expect(inserts[0]!.values.name).toBe("solo's Workspace");
    expect(inserts[0]!.values.slug).toBe("solo");
  });

  it("is idempotent: skips creation entirely when the user already has a membership", async () => {
    const { db, inserts } = createFakeDb([{ id: "existing-member" }]);
    const provisionDefaultBoard = mock(async () => {});
    const provisionDefaultServiceAccount = mock(async () => {});

    const result = await createPersonalOrganization(
      { id: "invited-user", name: "Invited", email: "invited@example.com" },
      {
        db: db as never,
        provisionDefaultBoard: provisionDefaultBoard as never,
        provisionDefaultServiceAccount: provisionDefaultServiceAccount as never,
      },
    );

    expect(result).toBeNull();
    expect(inserts).toHaveLength(0);
    expect(provisionDefaultBoard).not.toHaveBeenCalled();
    expect(provisionDefaultServiceAccount).not.toHaveBeenCalled();
  });
});
