import { describe, expect, test } from "bun:test";
import {
  RUNTIME_CAPABILITY_INTENT_MALFORMED,
  deriveRuntimeCapabilityIntent,
} from "./runtime-capability-intent";

const expectIntent = (
  config: unknown,
  expected: {
    authClass: string | null;
    capabilities: readonly string[];
  },
): void => {
  const result = deriveRuntimeCapabilityIntent(config);
  expect(result).toEqual({ ok: true, intent: expected });
  if (!result.ok) throw new Error(`unexpected rejection: ${result.code}`);
  expect(Object.isFrozen(result.intent)).toBe(true);
  expect(Object.isFrozen(result.intent.capabilities)).toBe(true);
};

const expectRejected = (
  config: unknown,
  code: string,
  field: string,
): void => {
  expect(deriveRuntimeCapabilityIntent(config)).toEqual({
    ok: false,
    code,
    field,
  });
};

describe("deriveRuntimeCapabilityIntent", () => {
  test("keeps unrelated read-open config capability-neutral", () => {
    expectIntent(
      {
        repoPath: ".",
        baseBranch: "main",
        futureUnrelatedMetadata: { retained: true },
        mcpServers: {},
        selectedMcpServerIds: [],
        needsBrowser: false,
        resourceProfile: { requiresBrowser: false },
        workspaceIntent: "write",
        permissionEnforced: false,
      },
      { authClass: null, capabilities: [] },
    );
  });

  test("detects every direct and selected MCP intent source", () => {
    const configs = [
      { mcpServerUrl: "https://api.example.test/mcp" },
      { mcpServers: { docs: { url: "https://docs.example.test/mcp" } } },
      { selectedMcpServerIds: ["profile-1"] },
    ];

    for (const config of configs) {
      expectIntent(config, { authClass: null, capabilities: ["mcp"] });
    }
  });

  test("detects top-level and nested browser markers", () => {
    const configs = [
      { needsBrowser: true },
      { requiresBrowser: true },
      { enableBrowser: true },
      { resourceProfile: { needsBrowser: true } },
      { resourceProfile: { requiresBrowser: true } },
      { resourceRequirements: { enableBrowser: true } },
    ];

    for (const config of configs) {
      expectIntent(config, { authClass: null, capabilities: ["browser"] });
    }
  });

  test("derives capabilities once in registry-canonical order", () => {
    expectIntent(
      {
        capabilities: ["sandbox", "permission_enforced", "extensions", "mcp"],
        mcpServerUrl: "https://api.example.test/mcp",
        needsBrowser: true,
        workspaceIntent: "read-only",
      },
      {
        authClass: null,
        capabilities: [
          "browser",
          "extensions",
          "mcp",
          "permission_enforced",
          "read_only_enforced",
          "sandbox",
        ],
      },
    );
  });

  test("maps explicit workspace and enforced read-only markers", () => {
    for (const config of [
      { workspaceIntent: "read-only" },
      {
        workspaceIntent: "read-only",
        requiresEnforcedReadOnlyRuntime: true,
      },
      { readOnlyEnforced: true },
      { requiresReadOnlyEnforcement: true },
    ]) {
      expectIntent(config, {
        authClass: null,
        capabilities: ["read_only_enforced"],
      });
    }
  });

  test("maps explicit permission-enforcement markers", () => {
    for (const config of [
      { permissionEnforced: true },
      { requiresPermissionEnforcement: true },
      { requiresEnforcedPermissions: true },
      { permissionMode: "default" },
      { capabilities: ["permission_enforced"] },
    ]) {
      expectIntent(config, {
        authClass: null,
        capabilities: ["permission_enforced"],
      });
    }
  });

  test("preserves every exact canonical auth class without aliasing", () => {
    for (const authClass of [
      "api_key",
      "provider_oauth",
      "setup_token",
      "subscription",
    ] as const) {
      expectIntent({ authClass }, { authClass, capabilities: [] });
      expectIntent({ runtimeAuthClass: authClass }, { authClass, capabilities: [] });
    }
  });

  test("fails closed for malformed MCP fields that could hide intent", () => {
    const cases = [
      [{ mcpServerUrl: { url: "https://api.example.test/mcp" } }, "mcpServerUrl"],
      [{ mcpServers: ["https://api.example.test/mcp"] }, "mcpServers"],
      [{ selectedMcpServerIds: "profile-1" }, "selectedMcpServerIds"],
      [{ selectedMcpServerIds: [""] }, "selectedMcpServerIds"],
      [{ selectedMcpServerIds: ["profile-1", "profile-1"] }, "selectedMcpServerIds"],
    ] as const;

    for (const [config, field] of cases) {
      expectRejected(config, RUNTIME_CAPABILITY_INTENT_MALFORMED, field);
    }
  });

  test("fails closed for malformed browser markers and containers", () => {
    const cases = [
      [{ needsBrowser: "true" }, "needsBrowser"],
      [{ resourceProfile: "heavy" }, "resourceProfile"],
      [{ resourceRequirements: { requiresBrowser: 1 } }, "requiresBrowser"],
    ] as const;

    for (const [config, field] of cases) {
      expectRejected(config, RUNTIME_CAPABILITY_INTENT_MALFORMED, field);
    }
  });

  test("fails closed for malformed workspace and permission intent", () => {
    const cases = [
      [{ workspaceIntent: "readonly" }, "workspaceIntent"],
      [{ requiresEnforcedReadOnlyRuntime: "true" }, "requiresEnforcedReadOnlyRuntime"],
      [{ requiresEnforcedReadOnlyRuntime: true }, "requiresEnforcedReadOnlyRuntime"],
      [{ workspaceIntent: "write", requiresEnforcedReadOnlyRuntime: true }, "requiresEnforcedReadOnlyRuntime"],
      [{ permissionEnforced: 1 }, "permissionEnforced"],
      [{ permissionMode: {} }, "permissionMode"],
    ] as const;

    for (const [config, field] of cases) {
      expectRejected(config, RUNTIME_CAPABILITY_INTENT_MALFORMED, field);
    }
  });

  test("returns typed safe codes for unsupported explicit auth and capability", () => {
    expectRejected(
      { authClass: "future_auth" },
      "RUNTIME_AUTH_CLASS_UNSUPPORTED",
      "authClass",
    );
    expectRejected(
      { capabilities: ["future_capability"] },
      "RUNTIME_CAPABILITY_UNSUPPORTED",
      "capabilities",
    );
  });

  test("fails closed for non-object config and conflicting auth intent", () => {
    expectRejected(null, RUNTIME_CAPABILITY_INTENT_MALFORMED, "config");
    expectRejected(
      { authClass: "api_key", runtimeAuthClass: "subscription" },
      RUNTIME_CAPABILITY_INTENT_MALFORMED,
      "runtimeAuthClass",
    );
  });
});
