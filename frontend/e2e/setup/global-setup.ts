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

  const createSession = async (project: string) => {
    const response = await fetch(`${apiUrl}/dev/test-session?project=${encodeURIComponent(project)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) {
      throw new Error(
        `Failed to create ${project} test session: ${response.status} ${response.statusText}`
      );
    }

    return (await response.json()) as {
    success: boolean;
    data?: { token: string; userId: string; email: string; expiresAt: string; viewerToken?: string; viewerUserId?: string; viewerEmail?: string };
    error?: string;
    };
  };

  const projects = ["chromium", "mobile-chrome"] as const;
  const sessions = await Promise.all(projects.map(async (project) => [project, await createSession(project)] as const));

  for (const [project, body] of sessions) {
    if (!body.success || !body.data?.token) {
      throw new Error(
        `Failed to create ${project} test session: ${body.error ?? "unknown error"}`
      );
    }
  }

  const [, primaryBody] = sessions[0];
  const primary = primaryBody.data!;

  writeFileSync(
    AUTH_STATE_PATH,
    JSON.stringify(
      {
        token: primary.token,
        userId: primary.userId,
        email: primary.email,
        expiresAt: primary.expiresAt,
        viewerToken: primary.viewerToken,
        viewerUserId: primary.viewerUserId,
        viewerEmail: primary.viewerEmail,
        projects: Object.fromEntries(sessions.map(([project, body]) => [project, body.data])),
      },
      null,
      2
    )
  );

  console.log(
    `[e2e] Test sessions created for ${sessions.map(([project, body]) => `${project}:${body.data?.email}`).join(", ")}`
  );
}

export default globalSetup;
