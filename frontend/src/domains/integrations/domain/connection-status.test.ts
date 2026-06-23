import { describe, expect, it } from "bun:test";
import { deriveIntegrationConnectionStatus } from "./connection-status";
import type { ProviderConnection, ProviderType } from "./types";

const buildConnection = (
  overrides: Partial<ProviderConnection> = {},
): ProviderConnection => ({
  id: "connection-1",
  provider: "anthropic",
  category: "ai",
  scope: "user",
  scopeId: "user-1",
  name: "Anthropic",
  accountIdentifier: "sk-ant-...",
  isActive: true,
  isDefault: true,
  orchestrationEnabled: false,
  priority: null,
  lastUsedAt: null,
  suspendedAt: null,
  tokenExpiresAt: null,
  lastValidatedAt: null,
  lastValidationStatus: null,
  lastValidationError: null,
  config: null,
  createdAt: "2026-03-09T00:00:00.000Z",
  updatedAt: "2026-03-09T00:00:00.000Z",
  ...overrides,
});

describe("deriveIntegrationConnectionStatus", () => {
  it("keeps renewable Anthropic OAuth connections connected even with a stale tokenExpiresAt", () => {
    const connection = buildConnection({
      tokenExpiresAt: "2026-03-08T00:00:00.000Z",
      config: { authMethod: "oauth" },
    });

    expect(deriveIntegrationConnectionStatus(connection)).toBe("connected");
  });

  it("still marks non-renewable Anthropic connections as expired", () => {
    const connection = buildConnection({
      tokenExpiresAt: "2026-03-08T00:00:00.000Z",
      config: { authMethod: "api_key" },
    });

    expect(deriveIntegrationConnectionStatus(connection)).toBe("expired");
  });

  it("returns inactive for connections with isActive=false", () => {
    const connection = buildConnection({
      isActive: false,
      config: { authMethod: "oauth" },
    });

    expect(deriveIntegrationConnectionStatus(connection)).toBe("inactive");
  });

  it("returns inactive when the last validation marked the connection invalid", () => {
    const connection = buildConnection({
      lastValidationStatus: "invalid",
      lastValidationError: "token expired",
      config: { authMethod: "oauth" },
    });

    expect(deriveIntegrationConnectionStatus(connection)).toBe("inactive");
  });

  it("keeps built-in auto-refresh providers connected even with a stale tokenExpiresAt", () => {
    const connection = buildConnection({
      provider: "github" as ProviderType,
      category: "code",
      scope: "organization",
      tokenExpiresAt: "2026-03-08T00:00:00.000Z",
    });

    expect(deriveIntegrationConnectionStatus(connection)).toBe("connected");
  });
});
