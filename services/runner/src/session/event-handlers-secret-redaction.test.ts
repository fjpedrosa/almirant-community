import { describe, expect, it } from "bun:test";
import {
  createJobSafeConsole,
  createJobSecretRedactor,
} from "../security/job-secret-redactor";
import { handleSessionError } from "./event-handlers";

describe("session event handler external logging", () => {
  it("writes runtime errors through the job-safe console boundary", async () => {
    const secret = "mcp-session-token-event-handler";
    const redactor = createJobSecretRedactor();
    redactor.register("mcp_session_token", secret);
    const observed: unknown[][] = [];
    const originalConsoleError = console.error;
    console.error = (...args: unknown[]) => {
      observed.push(args);
    };

    try {
      await handleSessionError(
        { errorMessage: undefined } as never,
        {
          jobId: "job-1",
          eventLogger: {
            error: () => {},
            warn: () => {},
          },
          safeConsole: createJobSafeConsole(redactor, console),
          abortController: new AbortController(),
        } as never,
        {
          error: {
            message: `runtime failed with ${Buffer.from(secret).toString("base64")}`,
          },
        },
        { event: "session.error", data: "" },
      );
    } finally {
      console.error = originalConsoleError;
    }

    const serialized = JSON.stringify(observed);
    expect(observed).toHaveLength(1);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain(
      Buffer.from(secret).toString("base64"),
    );
    expect(serialized).toContain("[REDACTED:JOB_SECRET]");
  });
});
