import { beforeEach, describe, expect, it, mock } from "bun:test";
import { createLoggerMock } from "../../test/mocks";

// Mirrors the exact shape of the production leak (issue #237): a
// DrizzleQueryError embeds the raw SQL, column/table names, and bound
// params — including a credential hash — directly in `.message`.
class FakeDrizzleQueryError extends Error {
  constructor() {
    super(
      'Failed query: select "api_keys"."id", "api_keys"."key_hash" from "api_keys" ' +
        'where ("api_keys"."key_hash" = $1 and "api_keys"."is_active" = $2) limit $3 ' +
        "params: ab12cd34ef56a1b2c3d4e5f6,true,1",
    );
    this.name = "DrizzleQueryError";
  }
}

const loggerErrorSpy = mock((..._args: unknown[]) => {});
const loggerMocks = createLoggerMock();
mock.module("@almirant/config", () => ({
  ...loggerMocks,
  logger: {
    ...loggerMocks.logger,
    error: loggerErrorSpy,
  },
}));

describe("internalErrorResponse", () => {
  beforeEach(() => {
    loggerErrorSpy.mockClear();
  });

  it("never puts the caught error's raw message in the returned body", async () => {
    // Dynamic import, deliberately AFTER the mock.module("@almirant/config", ...)
    // call above, matching the project's established test convention (see
    // ../../test/mocks.ts header comment): a static top-level import would be
    // hoisted ahead of that mock registration.
    const { internalErrorResponse } = await import("./response");

    const body = internalErrorResponse(
      new FakeDrizzleQueryError(),
      { route: "/workers/scheduled-configs" },
      "Failed to get scheduled configs",
    );

    expect(body.success).toBe(false);
    expect(body.error).toBe("Failed to get scheduled configs");
    expect(body.error).not.toContain("Failed query");
    expect(body.error).not.toContain("select");
    expect(body.error).not.toContain("api_keys");
    expect(body.error).not.toContain("key_hash");
  });

  it("defaults the fallback to a generic message when the caller doesn't provide one", async () => {
    const { internalErrorResponse } = await import("./response");

    const body = internalErrorResponse(new FakeDrizzleQueryError(), { route: "/x" });

    expect(body.error).toBe("Internal server error");
  });

  it("logs the caught error's full detail server-side, including the log context", async () => {
    const { internalErrorResponse } = await import("./response");
    const error = new FakeDrizzleQueryError();

    internalErrorResponse(error, { route: "/workers/scheduled-configs", scheduledConfigId: "cfg-1" }, "Failed to get scheduled configs");

    expect(loggerErrorSpy).toHaveBeenCalled();
    const [logPayload, logMessage] = loggerErrorSpy.mock.calls[0] as [
      Record<string, unknown>,
      string,
    ];
    expect(logPayload.route).toBe("/workers/scheduled-configs");
    expect(logPayload.scheduledConfigId).toBe("cfg-1");
    expect(logPayload.err).toBe(error);
    expect((logPayload.err as Error).message).toContain("Failed query");
    expect((logPayload.err as Error).message).toContain("api_keys");
    expect((logPayload.err as Error).message).toContain("key_hash");
    expect(logMessage).toBe("Failed to get scheduled configs");
  });
});
