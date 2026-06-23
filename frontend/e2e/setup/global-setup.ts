import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const AUTH_STATE_PATH = resolve(__dirname, "../.auth-state.json");

/**
 * Playwright global setup: calls the dev-only backend endpoint
 * to create a test session, then saves the token to .auth-state.json.
 *
 * Requires the backend API to be running on port 3001.
 */
async function globalSetup() {
  const apiUrl =
    process.env.API_URL ?? "http://localhost:3001";

  const response = await fetch(`${apiUrl}/dev/test-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to create test session: ${response.status} ${response.statusText}`
    );
  }

  const body = (await response.json()) as {
    success: boolean;
    data?: { token: string; userId: string; email: string; expiresAt: string };
    error?: string;
  };

  if (!body.success || !body.data?.token) {
    throw new Error(
      `Failed to create test session: ${body.error ?? "unknown error"}`
    );
  }

  writeFileSync(
    AUTH_STATE_PATH,
    JSON.stringify(
      {
        token: body.data.token,
        userId: body.data.userId,
        email: body.data.email,
        expiresAt: body.data.expiresAt,
      },
      null,
      2
    )
  );

  console.log(
    `[e2e] Test session created for ${body.data.email} (expires ${body.data.expiresAt})`
  );
}

export default globalSetup;
