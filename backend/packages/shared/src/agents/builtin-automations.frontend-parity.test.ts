import { describe, expect, test } from "bun:test";
import { BUILTIN_AUTOMATIONS, BUILTIN_AUTOMATION_IDS } from "./builtin-automations";

// ---------------------------------------------------------------------------
// Cross-package contract test — frontend parity.
//
// WHY THIS LIVES HERE, AND WHY IT IMPORTS THE FRONTEND DIRECTLY
// -----------------------------------------------------------------------
// `frontend/` is NOT a Bun workspace member (root package.json's
// `workspaces` array only lists `backend/api`, `backend/packages/*`,
// `services/*`) and does not declare `@almirant/shared` as a dependency.
// `frontend/src/domains/work-items/domain/dod-human-action.ts` documents the
// existing precedent explicitly: "The frontend does not import the backend
// package directly to keep its build self-contained, so we maintain this
// TypeScript-level mirror." `frontend/src/domains/scheduled-agents/domain/
// types.ts`'s `BUILTIN_AUTOMATIONS` follows the same precedent and keeps its
// own local copy of the four automations' id/name/description rather than
// importing this catalog.
//
// That means the frontend copy CAN silently drift from this catalog with no
// compiler to stop it. To close that gap without forcing a cross-boundary
// runtime import in production code, this test imports the frontend file
// directly via a relative path — verified empirically to work: Bun resolves
// the frontend file's own `@/*` path-alias imports (e.g.
// `@/lib/ai-models-catalog`) against the NEAREST tsconfig.json to the
// IMPORTED file (frontend/tsconfig.json), not the importing test file's
// package, so this executes the real frontend module, not a text/regex
// approximation. If frontend's tsconfig ever stops being reachable this way
// (e.g. `@/*` alias resolution changes), this test will fail loudly with a
// module-resolution error rather than silently stop checking anything.
//
// This is a TEST-ONLY dependency. `builtin-automations.ts` itself has zero
// imports and is never imported by the frontend at runtime.
// ---------------------------------------------------------------------------

// eslint-disable-next-line import/no-relative-packages -- deliberate cross-package contract import, see comment above.
import {
  BUILTIN_AUTOMATIONS as FRONTEND_BUILTIN_AUTOMATIONS,
  type BuiltinAutomationId as FrontendBuiltinAutomationId,
} from "../../../../../frontend/src/domains/scheduled-agents/domain/types";

describe("BUILTIN_AUTOMATIONS parity with frontend/src/domains/scheduled-agents/domain/types.ts", () => {
  test("frontend module resolved and exported a non-empty catalog (canary — fails loudly if the import path breaks)", () => {
    expect(Array.isArray(FRONTEND_BUILTIN_AUTOMATIONS)).toBe(true);
    expect(FRONTEND_BUILTIN_AUTOMATIONS.length).toBeGreaterThan(0);
  });

  test("same set of ids, same order", () => {
    const frontendIds = FRONTEND_BUILTIN_AUTOMATIONS.map((automation) => automation.id);
    expect(frontendIds).toEqual([...BUILTIN_AUTOMATION_IDS]);
  });

  test("same id -> name -> description mapping on both sides", () => {
    const frontendById = new Map(
      FRONTEND_BUILTIN_AUTOMATIONS.map((automation) => [automation.id, automation]),
    );

    for (const automation of BUILTIN_AUTOMATIONS) {
      const frontendMatch = frontendById.get(automation.id as unknown as FrontendBuiltinAutomationId);
      expect(frontendMatch).toBeDefined();
      expect(frontendMatch?.name).toBe(automation.name);
      expect(frontendMatch?.description).toBe(automation.description);
    }
  });

  test("no automation exists on one side but not the other", () => {
    // No `as readonly string[]` widening here: BUILTIN_AUTOMATION_IDS and
    // FrontendBuiltinAutomationId are the same string-literal union
    // (structurally, not nominally — see the module comment above), so
    // keeping the literal type lets Set<BuiltinAutomationId> and
    // Set<FrontendBuiltinAutomationId> compare directly under toEqual.
    const catalogIds = new Set(BUILTIN_AUTOMATION_IDS);
    const frontendIds = new Set(FRONTEND_BUILTIN_AUTOMATIONS.map((automation) => automation.id));
    expect(frontendIds).toEqual(catalogIds);
  });
});
