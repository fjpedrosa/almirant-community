import { describe, it, expect, mock, beforeAll } from "bun:test";
import type { AuthProviderRegistry } from "@almirant/shared";

// Mock env BEFORE importing the registry so buildDescriptors sees these values.
// The registry is built via an IIFE at module load time, so we must ensure the
// mock is registered before the dynamic import resolves.
mock.module("@almirant/config", () => ({
  env: {
    GOOGLE_CLIENT_ID: "google-client",
    GOOGLE_CLIENT_SECRET: "google-secret",
    GITHUB_CLIENT_ID: undefined,
    GITHUB_CLIENT_SECRET: undefined,
  },
  logger: { warn: mock(() => {}), debug: mock(() => {}) },
}));

describe("DefaultAuthProviderRegistry", () => {
  let defaultAuthProviderRegistry: AuthProviderRegistry;

  beforeAll(async () => {
    const mod = await import("../default-auth-provider-registry");
    defaultAuthProviderRegistry = mod.defaultAuthProviderRegistry;
  });

  it("lists only providers that are configured", () => {
    const list = defaultAuthProviderRegistry.list();
    expect(list).toHaveLength(2);
    expect(list[0]!.id).toBe("email-password");
    expect(list[0]!.type).toBe("credentials");
    expect(list[1]!.id).toBe("google");
    expect(list[1]!.type).toBe("oauth");
  });

  it("has() returns true for configured providers", () => {
    expect(defaultAuthProviderRegistry.has("email-password")).toBe(true);
    expect(defaultAuthProviderRegistry.has("google")).toBe(true);
  });

  it("has() returns false for providers that are not configured", () => {
    expect(defaultAuthProviderRegistry.has("github")).toBe(false);
    expect(defaultAuthProviderRegistry.has("saml")).toBe(false);
  });
});
