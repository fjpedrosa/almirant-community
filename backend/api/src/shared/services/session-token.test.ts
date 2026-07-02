import { describe, expect, it } from "bun:test";
import {
  AUTOMATION_BOT_USER_ID,
  generateSessionToken,
  resolveSessionActorUserId,
  verifySessionToken,
  VALID_SESSION_TOKEN_PERMISSIONS,
} from "./session-token";

const SIGNING_SECRET = "test-secret-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";

const validParams = {
  projectId: "proj-1",
  workspaceId: "org-1",
  permissions: ["mcp:read", "mcp:write"] as string[],
  signingSecret: SIGNING_SECRET,
};

describe("generateSessionToken — permission whitelist", () => {
  it("accepts valid permissions", () => {
    const token = generateSessionToken(validParams);
    expect(token).toStartWith("st_");
  });

  it("accepts a subset of valid permissions", () => {
    const token = generateSessionToken({ ...validParams, permissions: ["mcp:read"] });
    expect(token).toStartWith("st_");
  });

  it("accepts mcp:internal and mcp:debug permissions", () => {
    const token = generateSessionToken({
      ...validParams,
      permissions: ["mcp:read", "mcp:write", "mcp:internal", "mcp:debug"],
    });
    expect(token).toStartWith("st_");
  });

  it("throws on an unknown permission", () => {
    expect(() =>
      generateSessionToken({ ...validParams, permissions: ["admin:everything"] })
    ).toThrow("invalid permission");
  });

  it("throws on mixed valid + invalid permissions", () => {
    expect(() =>
      generateSessionToken({ ...validParams, permissions: ["mcp:read", "mcp:superadmin"] })
    ).toThrow("invalid permission");
  });
});

describe("verifySessionToken — permission whitelist", () => {
  it("returns payload for a valid token", () => {
    const token = generateSessionToken(validParams);
    const payload = verifySessionToken(token, SIGNING_SECRET);
    expect(payload).not.toBeNull();
    expect(payload?.permissions).toEqual(["mcp:read", "mcp:write"]);
  });

  it("supports workspace-scoped tokens without a projectId", () => {
    const token = generateSessionToken({
      workspaceId: "org-1",
      permissions: ["mcp:read", "mcp:write"],
      signingSecret: SIGNING_SECRET,
    });

    const payload = verifySessionToken(token, SIGNING_SECRET);
    expect(payload).not.toBeNull();
    expect(payload?.workspaceId).toBe("org-1");
    expect(payload?.projectId).toBeUndefined();
  });

  it("preserves the optional actor userId", () => {
    const token = generateSessionToken({
      ...validParams,
      userId: "user-test-1",
    });
    const payload = verifySessionToken(token, SIGNING_SECRET);
    expect(payload?.userId).toBe("user-test-1");
  });

  it("preserves the optional agent jobId so INV-4 can match ai_sessions.agent_job_id", () => {
    const token = generateSessionToken({
      ...validParams,
      jobId: "80b8f8ec-4eb9-43e6-a325-9bdf58e5c2a5",
    });
    const payload = verifySessionToken(token, SIGNING_SECRET);
    expect(payload?.jobId).toBe("80b8f8ec-4eb9-43e6-a325-9bdf58e5c2a5");
  });

  it("omits jobId from the payload when not provided", () => {
    const token = generateSessionToken(validParams);
    const payload = verifySessionToken(token, SIGNING_SECRET);
    expect(payload?.jobId).toBeUndefined();
  });

  it("returns null for a token with invalid permissions (defense in depth)", async () => {
    // Craft a token that bypasses generateSessionToken (e.g. pre-deploy legacy token).
    // We sign it directly with jwt to simulate an old token that contained arbitrary perms.
    const jwt = await import("jsonwebtoken");
    const raw = jwt.sign(
      {
        projectId: "proj-1",
        workspaceId: "org-1",
        permissions: ["admin:everything"],
        sessionType: "agent",
        jti: "test-jti",
      },
      SIGNING_SECRET,
      { algorithm: "HS256", expiresIn: 3600, issuer: "almirant-api", subject: "session:org-1:proj-1" }
    );
    const prefixed = `st_${raw}`;
    const result = verifySessionToken(prefixed, SIGNING_SECRET);
    expect(result).toBeNull();
  });

  it("exports the expected set of valid permissions", () => {
    expect(VALID_SESSION_TOKEN_PERMISSIONS).toEqual(["mcp:read", "mcp:write", "mcp:internal", "mcp:debug"]);
  });
});

describe("resolveSessionActorUserId", () => {
  it("prefers the human creator when present", () => {
    expect(
      resolveSessionActorUserId({
        createdByUserId: "user-123",
        jobType: "scheduled",
      }),
    ).toBe("user-123");
  });

  it("falls back to the automation bot for unattended scheduled jobs", () => {
    expect(
      resolveSessionActorUserId({
        createdByUserId: null,
        jobType: "scheduled",
      }),
    ).toBe(AUTOMATION_BOT_USER_ID);
  });

  it("returns undefined for non-scheduled jobs without creator", () => {
    expect(
      resolveSessionActorUserId({
        createdByUserId: null,
        jobType: "implementation",
      }),
    ).toBeUndefined();
  });
});
