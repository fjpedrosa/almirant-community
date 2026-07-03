import { describe, expect, it } from "bun:test";

// Backend copy (relative import within this package).
import * as backend from "./auth-permissions";

/**
 * DRIFT-GUARD CONTRACT TEST — auth-permissions is intentionally DUPLICATED:
 *
 *   - backend:  backend/api/src/domains/auth/better-auth/auth-permissions.ts
 *   - frontend: frontend/src/lib/auth-permissions.ts
 *
 * DECISION (T15): keep BOTH copies (they run in different runtimes / packages),
 * but add this test so the two definitions can NEVER silently drift. If either
 * the `statements` map or any role definition changes in one file without the
 * other, this test fails.
 *
 * APPROACH USED: direct import of the frontend copy via its ABSOLUTE path.
 * Bun resolves `better-auth/plugins/access` for the frontend module from the
 * backend test process, so the real frontend module loads and we compare its
 * runtime access-control definitions against the backend's.
 *
 * TODO(shared-package): the correct long-term fix is to extract this
 * access-control definition into a shared package (e.g. `@almirant/shared`)
 * consumed by both runtimes, which would make this duplication — and this
 * contract test — unnecessary.
 */
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import * as frontend from "/Users/javi/projects/thekrokocompany/almirant/almirant-auth-to-api/frontend/src/lib/auth-permissions.ts";

// The access-control instance exposes the full statements map; each role
// exposes its granted permissions via `.statements`.
type WithStatements = { statements: Record<string, string[]> };
type Roles = Record<string, WithStatements>;

const acStatements = (mod: typeof backend): Record<string, string[]> =>
  (mod.ac as unknown as WithStatements).statements;

const roleStatements = (mod: typeof backend): Roles =>
  mod.roles as unknown as Roles;

describe("auth-permissions contract (backend <-> frontend)", () => {
  it("exposes the same top-level statements map", () => {
    expect(acStatements(backend)).toEqual(
      acStatements(frontend as unknown as typeof backend),
    );
  });

  it("defines the exact same set of role names", () => {
    expect(Object.keys(backend.roles).sort()).toEqual(
      Object.keys(frontend.roles).sort(),
    );
  });

  it("defines identical permission grants for every role", () => {
    const beRoles = roleStatements(backend);
    const feRoles = roleStatements(frontend as unknown as typeof backend);

    for (const roleName of Object.keys(beRoles)) {
      expect(feRoles[roleName]).toBeDefined();
      expect(beRoles[roleName]!.statements).toEqual(
        feRoles[roleName]!.statements,
      );
    }
  });

  it("guards against drift for each role individually", () => {
    const beRoles = roleStatements(backend);
    const feRoles = roleStatements(frontend as unknown as typeof backend);

    // Explicit per-role assertions so a failure names the drifting role.
    for (const roleName of ["owner", "admin", "member"] as const) {
      expect(beRoles[roleName], `backend missing role: ${roleName}`).toBeDefined();
      expect(
        feRoles[roleName],
        `frontend missing role: ${roleName}`,
      ).toBeDefined();
      expect(
        beRoles[roleName]!.statements,
        `role "${roleName}" drifted between backend and frontend`,
      ).toEqual(feRoles[roleName]!.statements);
    }
  });
});
