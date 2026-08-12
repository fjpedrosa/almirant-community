import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { test as base } from "@playwright/test";

const AUTH_STATE_PATH = resolve(__dirname, "../.auth-state.json");

/**
 * Reads the session token from (in priority order):
 * 1. SESSION_TOKEN env variable (manual override)
 * 2. .auth-state.json written by global-setup.ts (automatic)
 */
type AuthState = {
  token?: string;
  projects?: Record<string, { token?: string }>;
};

function getSessionToken(projectName?: string): string | undefined {
  if (process.env.SESSION_TOKEN) {
    return process.env.SESSION_TOKEN;
  }

  if (existsSync(AUTH_STATE_PATH)) {
    try {
      const state = JSON.parse(readFileSync(AUTH_STATE_PATH, "utf-8")) as AuthState;
      return state.projects?.[projectName ?? ""]?.token ?? state.token;
    } catch {
      // Ignore parse errors — fall through to undefined
    }
  }

  return undefined;
}

/**
 * Auth fixture that injects the `better-auth.session_token` cookie
 * so E2E tests run as an authenticated user.
 *
 * Usage:
 *   import { test, expect } from "../fixtures/auth.fixture";
 *
 *   test("some authenticated test", async ({ page }) => {
 *     await page.goto("/boards");
 *     // ...
 *   });
 *
 * The token is resolved automatically via global-setup.ts (recommended)
 * or can be overridden with the SESSION_TOKEN env variable.
 */
export const test = base.extend({
  page: async ({ page }, runFixture, testInfo) => {
    const sessionToken = getSessionToken(testInfo.project.name);

    if (sessionToken) {
      const baseURL = process.env.BASE_URL ?? "http://localhost:3000";
      const url = new URL(baseURL);

      await page.context().addCookies([
        {
          name: "better-auth.session_token",
          value: sessionToken,
          domain: url.hostname,
          path: "/",
          httpOnly: true,
          secure: url.protocol === "https:",
          sameSite: "Lax",
        },
      ]);
    }

    await runFixture(page);
  },
});

export { expect } from "@playwright/test";
