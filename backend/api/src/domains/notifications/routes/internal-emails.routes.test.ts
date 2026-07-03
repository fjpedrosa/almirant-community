import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from "bun:test";

/**
 * Characterization tests for the internal (server-to-server) email route.
 *
 * The route is mounted PUBLIC (outside the `/api` session-auth group) and is
 * guarded solely by the `x-internal-email-secret` header compared against
 * `env.INTERNAL_EMAIL_API_SECRET`. These tests assert the CURRENT behavior:
 *
 *   - missing / incorrect secret  -> 401 and `sendEmail` is NOT called
 *   - correct secret              -> 200 and `sendEmail` is called once with the
 *                                    member-removed template
 *   - reachable with no session   -> route is PUBLIC (no auth middleware)
 *
 * NOTE ON STATUS CODE: the task brief referenced 403, but the route as written
 * returns 401 ("Unauthorized") on a bad secret. These are characterization
 * tests, so we assert the ACTUAL current behavior (401) and do not touch the
 * route.
 *
 * mock.module is PROCESS-GLOBAL and mock.restore() does not clear it, so we
 * capture the REAL modules first and restore them in afterAll to avoid leaking
 * the mocks into sibling test files during a full-suite run.
 */

const SECRET = "test-internal-email-secret";

// Captured real modules (restored in afterAll).
let realConfig: typeof import("@almirant/config");
let realEmail: typeof import("../../../shared/services/email-service");

// Mock that captures every sendEmail invocation.
const sendEmailMock = mock(async () => ({ success: true as const }));

let app: import("elysia").Elysia;
let expectedTemplate: { subject: string; html: string };

const BODY = {
  email: "member@example.com",
  memberName: "Alice Member",
  organizationName: "Acme Workspace",
  removedAt: "2026-01-15T10:00:00.000Z",
};

const makeRequest = (headers: Record<string, string>): Request =>
  new Request("http://localhost/internal/emails/member-removed", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(BODY),
  });

const parseResponse = async <T = unknown>(
  res: Response,
): Promise<{ status: number; body: T }> => {
  const body = (await res.json()) as T;
  return { status: res.status, body };
};

beforeAll(async () => {
  // Capture reals BEFORE registering mocks.
  realConfig = await import("@almirant/config");
  realEmail = await import("../../../shared/services/email-service");

  // Register mocks BEFORE importing the route (the route binds `env` and
  // `sendEmail` at module load).
  mock.module("@almirant/config", () => ({
    ...realConfig,
    env: { ...realConfig.env, INTERNAL_EMAIL_API_SECRET: SECRET },
  }));
  mock.module("../../../shared/services/email-service", () => ({
    ...realEmail,
    sendEmail: sendEmailMock,
  }));

  const { Elysia } = await import("elysia");
  const { internalEmailsRoutes } = await import("./internal-emails.routes");
  // Mount the route plugin ALONE — no auth middleware. Reachability here proves
  // the route is PUBLIC.
  app = new Elysia().use(internalEmailsRoutes) as unknown as typeof app;

  // Compute the expected template with the REAL builder (the route uses it
  // un-mocked). `organizationName` maps to `workspaceName`.
  const { buildEmailMemberRemoved } = await import(
    "../../../shared/services/email/templates"
  );
  expectedTemplate = buildEmailMemberRemoved({
    memberName: BODY.memberName,
    workspaceName: BODY.organizationName,
    removedAt: BODY.removedAt,
  });
});

afterAll(() => {
  // Restore reals so the process-global mock registry does not leak.
  mock.module("@almirant/config", () => realConfig);
  mock.module("../../../shared/services/email-service", () => realEmail);
});

beforeEach(() => {
  sendEmailMock.mockClear();
});

describe("internal-emails.routes - POST /internal/emails/member-removed - auth", () => {
  it("returns 401 and does NOT send email when the secret header is missing", async () => {
    const res = await app.handle(makeRequest({}));
    const { status, body } = await parseResponse<{
      success: boolean;
      error: string;
    }>(res);

    expect(status).toBe(401);
    expect(body.success).toBe(false);
    expect(body.error).toBe("Unauthorized");
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("returns 401 and does NOT send email when the secret is incorrect", async () => {
    const res = await app.handle(
      makeRequest({ "x-internal-email-secret": "wrong-secret" }),
    );
    const { status, body } = await parseResponse<{
      success: boolean;
      error: string;
    }>(res);

    expect(status).toBe(401);
    expect(body.success).toBe(false);
    expect(body.error).toBe("Unauthorized");
    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});

describe("internal-emails.routes - POST /internal/emails/member-removed - success", () => {
  it("returns 200 and sends the member-removed template exactly once with the correct secret", async () => {
    const res = await app.handle(
      makeRequest({ "x-internal-email-secret": SECRET }),
    );
    const { status, body } = await parseResponse<{ success: boolean }>(res);

    expect(status).toBe(200);
    expect(body.success).toBe(true);

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock).toHaveBeenCalledWith({
      to: BODY.email,
      subject: expectedTemplate.subject,
      html: expectedTemplate.html,
    });
  });

  it("is PUBLIC: reachable with no session / Authorization header", async () => {
    // The request carries only the internal secret header — no Bearer token,
    // no session cookie — yet succeeds, confirming the route sits outside the
    // session-auth group.
    const res = await app.handle(
      makeRequest({ "x-internal-email-secret": SECRET }),
    );

    expect(res.status).toBe(200);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
  });
});
