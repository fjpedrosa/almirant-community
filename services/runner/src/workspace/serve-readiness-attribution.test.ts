import { describe, expect, it } from "bun:test";
import { attributeServeReadinessFailure } from "./serve-readiness-attribution";

describe("attributeServeReadinessFailure", () => {
  it("attributes a git_repo readiness failure to a missing clone credential", () => {
    const error = new Error(
      "Serve did not become ready within 360000ms at http://10.0.0.5:4096",
    );

    const result = attributeServeReadinessFailure(error, {
      workspaceKind: "git_repo",
      cloneCredential: {
        status: "unavailable",
        reason: "GitHub App installation for repository not found",
      },
    });

    expect(result).toBe(error);
    expect((result as Error).message).toBe(
      "Serve did not become ready within 360000ms at http://10.0.0.5:4096" +
        " — likely cause: the repository clone had no GitHub credential " +
        "(GitHub App installation for repository not found). Link the " +
        "repository to a GitHub App installation in Settings > Integrations, " +
        "then retry.",
    );
  });

  it("classifies the attributed failure as a permanent config error", () => {
    const error = new Error("Serve did not become ready within 360000ms at http://x");

    const result = attributeServeReadinessFailure(error, {
      workspaceKind: "git_repo",
      cloneCredential: { status: "unavailable", reason: "some reason" },
    }) as Error & { classification?: string };

    expect(result.classification).toBe("permanent_config");
  });

  it("leaves the error untouched when the credential was granted", () => {
    const error = new Error("Serve did not become ready within 360000ms at http://x");

    const result = attributeServeReadinessFailure(error, {
      workspaceKind: "git_repo",
      cloneCredential: { status: "granted" },
    });

    expect(result).toBe(error);
    expect((result as Error).message).toBe(
      "Serve did not become ready within 360000ms at http://x",
    );
    expect((result as Error & { classification?: string }).classification).toBeUndefined();
  });

  it("leaves the error untouched when no credential was needed", () => {
    const error = new Error("Serve did not become ready within 360000ms at http://x");

    const result = attributeServeReadinessFailure(error, {
      workspaceKind: "git_repo",
      cloneCredential: { status: "not_needed" },
    });

    expect((result as Error).message).toBe(
      "Serve did not become ready within 360000ms at http://x",
    );
  });

  it("leaves the error untouched when cloneCredential was never resolved", () => {
    const error = new Error("Serve did not become ready within 360000ms at http://x");

    const result = attributeServeReadinessFailure(error, {
      workspaceKind: "git_repo",
      cloneCredential: undefined,
    });

    expect((result as Error).message).toBe(
      "Serve did not become ready within 360000ms at http://x",
    );
  });

  it("leaves the error untouched for non-git_repo workspaces even without a credential", () => {
    const error = new Error("Serve did not become ready within 360000ms at http://x");

    const result = attributeServeReadinessFailure(error, {
      workspaceKind: "uploaded_files",
      cloneCredential: { status: "unavailable", reason: "n/a" },
    });

    expect((result as Error).message).toBe(
      "Serve did not become ready within 360000ms at http://x",
    );
  });

  it("leaves the error untouched when workspaceKind is null or undefined", () => {
    const error = new Error("Serve did not become ready within 360000ms at http://x");

    expect(
      (attributeServeReadinessFailure(error, {
        workspaceKind: null,
        cloneCredential: { status: "unavailable", reason: "n/a" },
      }) as Error).message,
    ).toBe("Serve did not become ready within 360000ms at http://x");

    expect(
      (attributeServeReadinessFailure(error, {
        workspaceKind: undefined,
        cloneCredential: { status: "unavailable", reason: "n/a" },
      }) as Error).message,
    ).toBe("Serve did not become ready within 360000ms at http://x");
  });

  it("wraps a non-Error throw into an Error while still attributing it", () => {
    const result = attributeServeReadinessFailure("boom", {
      workspaceKind: "git_repo",
      cloneCredential: { status: "unavailable", reason: "n/a" },
    });

    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toBe(
      "boom — likely cause: the repository clone had no GitHub credential " +
        "(n/a). Link the repository to a GitHub App installation in " +
        "Settings > Integrations, then retry.",
    );
  });

  it("preserves other properties on the mutated error (e.g. a phase_timeout code)", () => {
    const error = Object.assign(
      new Error("Serve did not become ready within 360000ms at http://x"),
      { code: "phase_timeout" as const },
    );

    const result = attributeServeReadinessFailure(error, {
      workspaceKind: "git_repo",
      cloneCredential: { status: "unavailable", reason: "n/a" },
    }) as Error & { code?: string };

    expect(result).toBe(error);
    expect(result.code).toBe("phase_timeout");
  });
});
