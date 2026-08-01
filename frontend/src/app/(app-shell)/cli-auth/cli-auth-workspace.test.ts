import { describe, expect, it } from "bun:test";
import {
  buildCallbackUrl,
  buildCliAuthCallbackParams,
  buildCliAuthReturnPath,
  resolveCliAuthWorkspace,
} from "./cli-auth-workspace";

const workspaces = [
  { id: "ws-personal", name: "Javi Personal", slug: "javi" },
  { id: "ws-shoutrz", name: "Shoutrz", slug: "shoutrz" },
];

describe("resolveCliAuthWorkspace", () => {
  it("selects the only workspace when no hint is provided", () => {
    const result = resolveCliAuthWorkspace([workspaces[1]!], "", null);

    expect(result.status).toBe("selected");
    if (result.status === "selected") {
      expect(result.workspace.id).toBe("ws-shoutrz");
    }
  });

  it("requires selection when the user has multiple workspaces and no hint", () => {
    const result = resolveCliAuthWorkspace(workspaces, "", null);

    expect(result.status).toBe("needs_selection");
  });

  it("resolves a workspace hint by id, slug, or name case-insensitively", () => {
    for (const hint of ["ws-shoutrz", "shoutrz", "SHOUTRZ"]) {
      const result = resolveCliAuthWorkspace(workspaces, hint, null);

      expect(result.status).toBe("selected");
      if (result.status === "selected") {
        expect(result.workspace.id).toBe("ws-shoutrz");
      }
    }
  });

  it("returns an error instead of silently choosing the wrong workspace", () => {
    const result = resolveCliAuthWorkspace(workspaces, "does-not-exist", null);

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.message).toContain("does-not-exist");
    }
  });

  it("uses an explicit UI selection over the absence of a hint", () => {
    const result = resolveCliAuthWorkspace(workspaces, "", "ws-shoutrz");

    expect(result.status).toBe("selected");
    if (result.status === "selected") {
      expect(result.workspace.slug).toBe("shoutrz");
    }
  });
});

describe("CLI auth callback helpers", () => {
  it("preserves workspace hint in the sign-in return path", () => {
    const path = buildCliAuthReturnPath("http://127.0.0.1:3456/callback", "CLI Key", "shoutrz");

    expect(path).toBe(
      "/cli-auth?callback=http%3A%2F%2F127.0.0.1%3A3456%2Fcallback&name=CLI+Key&workspace=shoutrz",
    );
  });

  it("sends API key id with the name expected by the CLI and includes workspace metadata", () => {
    const params = buildCliAuthCallbackParams(
      { key: "alm_key", id: "key-123" },
      { id: "ws-shoutrz", name: "Shoutrz", slug: "shoutrz" },
    );

    expect(params).toEqual({
      apiKey: "alm_key",
      apiKeyId: "key-123",
      keyId: "key-123",
      workspaceId: "ws-shoutrz",
      workspaceName: "Shoutrz",
      workspaceSlug: "shoutrz",
    });
  });

  it("builds callback URLs without dropping existing query parameters", () => {
    const url = buildCallbackUrl("http://127.0.0.1:3456/callback?state=abc", {
      apiKey: "alm_key",
      workspaceSlug: "shoutrz",
    });

    expect(url).toBe(
      "http://127.0.0.1:3456/callback?state=abc&apiKey=alm_key&workspaceSlug=shoutrz",
    );
  });
});
