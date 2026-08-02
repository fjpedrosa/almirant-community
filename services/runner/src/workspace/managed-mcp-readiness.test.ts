import { describe, expect, it, mock } from "bun:test";
import type { OpenCodeMcpStatusMap } from "@almirant/remote-agent";
import { classifyError } from "../shared/types";
import {
  assertRequiredManagedMcpReadiness,
  isRecoverableManagedMcpReadinessError,
  ManagedMcpReadinessError,
  resolveRequiredManagedMcpServerNames,
} from "./managed-mcp-readiness";

const scraperProfileId = "7d8a4f0a-2b7f-4c93-bbb1-b605001476ee";
const docsProfileId = "6e9fa58b-3490-4e39-982f-444e5c697e55";

const selectedJob = {
  id: "job-managed-mcp",
  config: {
    selectedMcpServerIds: [scraperProfileId, docsProfileId],
    mcpServers: {
      scraper: {
        type: "remote",
        url: "https://scraper.example.test/mcp",
        enabled: true,
        oauth: false,
        almirantServerId: scraperProfileId,
      },
      private_docs: {
        type: "remote",
        url: "https://docs.example.test/mcp",
        enabled: true,
        oauth: false,
        almirantServerId: docsProfileId,
      },
    },
  },
};

const ordinaryJob = {
  id: "job-without-managed-mcp",
  config: {},
};

const dependencies = (input?: {
  statuses?: OpenCodeMcpStatusMap;
  statusError?: Error;
}) => {
  const getMcpStatus = mock(async (): Promise<OpenCodeMcpStatusMap> => {
    if (input?.statusError) throw input.statusError;
    return input?.statuses ?? {
      scraper: { status: "connected" },
      private_docs: { status: "connected" },
    };
  });

  return {
    getMcpStatus,
    createClient: mock(() => ({ getMcpStatus })),
  };
};

describe("managed MCP readiness preflight", () => {
  it("derives the exact managed runtime names from the immutable job snapshot", () => {
    expect(resolveRequiredManagedMcpServerNames(selectedJob)).toEqual([
      "private_docs",
      "scraper",
    ]);
    expect(resolveRequiredManagedMcpServerNames(ordinaryJob)).toEqual([]);
  });

  it("preserves the legacy ignore behavior when no managed profile was selected", () => {
    expect(
      resolveRequiredManagedMcpServerNames({
        id: "job-with-ignored-unmanaged-url",
        config: {
          selectedMcpServerIds: [],
          mcpServers: {
            legacy_unmanaged: {
              type: "remote",
              url: "https://legacy.example.test/mcp",
              enabled: true,
            },
          },
        },
      }),
    ).toEqual([]);
  });

  it("fails closed when explicitly selected ids do not match the managed snapshot", () => {
    expect(() =>
      resolveRequiredManagedMcpServerNames({
        ...selectedJob,
        config: {
          ...selectedJob.config,
          selectedMcpServerIds: [scraperProfileId],
        },
      }),
    ).toThrow("MANAGED_MCP_UNAVAILABLE: invalid_snapshot");

    expect(() =>
      resolveRequiredManagedMcpServerNames({
        id: "job-with-required-invalid-profile",
        config: {
          selectedMcpServerIds: [scraperProfileId],
          mcpServers: {
            scraper: {
              type: "remote",
              url: "https://scraper.example.test/mcp",
              enabled: true,
            },
          },
        },
      }),
    ).toThrow("MANAGED_MCP_UNAVAILABLE: invalid_snapshot");
  });

  it("accepts only managed profiles whose OpenCode initialization completed", async () => {
    const deps = dependencies();
    const signal = new AbortController().signal;

    await assertRequiredManagedMcpReadiness(
      {
        job: selectedJob,
        runtimeType: "opencode",
        baseUrl: "http://agent.internal:4096",
        signal,
      },
      deps,
    );

    expect(deps.createClient).toHaveBeenCalledWith({
      baseUrl: "http://agent.internal:4096",
      timeoutMs: 120_000,
    });
    expect(deps.getMcpStatus).toHaveBeenCalledWith({
      signal,
      timeoutMs: 120_000,
    });
  });

  it("does not contact the runtime when the job selected no managed profile", async () => {
    const deps = dependencies();

    await assertRequiredManagedMcpReadiness(
      {
        job: ordinaryJob,
        runtimeType: "opencode",
        baseUrl: "http://agent.internal:4096",
        signal: new AbortController().signal,
      },
      deps,
    );

    expect(deps.createClient).not.toHaveBeenCalled();
  });

  it("fails closed when a selected profile is absent or not connected", async () => {
    const deps = dependencies({
      statuses: {
        private_docs: { status: "connected" },
        scraper: {
          status: "failed",
          error:
            "Bearer must-never-escape at https://private.example.test/mcp",
        },
      },
    });

    let failure: unknown;
    try {
      await assertRequiredManagedMcpReadiness(
        {
          job: selectedJob,
          runtimeType: "opencode",
          baseUrl: "http://agent.internal:4096",
          signal: new AbortController().signal,
        },
        deps,
      );
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({
      code: "managed_mcp_unavailable",
      reason: "not_connected",
      serverNames: ["scraper"],
    });
    expect(classifyError(failure as Error)).toBe("recoverable_disconnect");
    expect(String(failure)).not.toContain("must-never-escape");
    expect(String(failure)).not.toContain("private.example.test");
    expect(JSON.stringify(failure)).not.toContain("must-never-escape");
    expect(JSON.stringify(failure)).not.toContain("private.example.test");
  });

  it("preserves a retryable timeout classification reported by OpenCode", async () => {
    const deps = dependencies({
      statuses: {
        private_docs: { status: "connected" },
        scraper: {
          status: "failed",
          error: "MCP connection timed out",
        },
      },
    });

    await expect(
      assertRequiredManagedMcpReadiness(
        {
          job: selectedJob,
          runtimeType: "opencode",
          baseUrl: "http://agent.internal:4096",
          signal: new AbortController().signal,
        },
        deps,
      ),
    ).rejects.toMatchObject({
      code: "managed_mcp_unavailable",
      reason: "not_connected",
      serverNames: ["scraper"],
      classification: "recoverable_timeout",
    });
  });

  it.each([
    [
      "401",
      "SSE error: Non-200 status code (401)",
      "permanent_auth",
    ],
    [
      "403",
      "SSE error: Non-200 status code (403)",
      "permanent_auth",
    ],
    [
      "404",
      "SSE error: Non-200 status code (404)",
      "permanent_config",
    ],
  ] as const)(
    "treats a persisted MCP HTTP %s failure as terminal",
    async (_statusCode, statusError, expectedClassification) => {
      const deps = dependencies({
        statuses: {
          private_docs: { status: "connected" },
          scraper: {
            status: "failed",
            error: statusError,
          },
        },
      });

      await expect(
        assertRequiredManagedMcpReadiness(
          {
            job: selectedJob,
            runtimeType: "opencode",
            baseUrl: "http://agent.internal:4096",
            signal: new AbortController().signal,
          },
          deps,
        ),
      ).rejects.toMatchObject({
        code: "managed_mcp_unavailable",
        reason: "not_connected",
        serverNames: ["scraper"],
        classification: expectedClassification,
      });
    },
  );

  it("keeps a genuinely transient persisted MCP disconnect retryable", async () => {
    const deps = dependencies({
      statuses: {
        private_docs: { status: "connected" },
        scraper: {
          status: "failed",
          error: "SSE transport disconnected: ECONNRESET",
        },
      },
    });

    await expect(
      assertRequiredManagedMcpReadiness(
        {
          job: selectedJob,
          runtimeType: "opencode",
          baseUrl: "http://agent.internal:4096",
          signal: new AbortController().signal,
        },
        deps,
      ),
    ).rejects.toMatchObject({
      code: "managed_mcp_unavailable",
      reason: "not_connected",
      serverNames: ["scraper"],
      classification: "recoverable_disconnect",
    });
  });

  it("wraps runtime API failures without leaking their body", async () => {
    const deps = dependencies({
      statusError: new Error(
        "Agent session API 401 Authorization: Bearer must-never-escape",
      ),
    });

    let failure: unknown;
    try {
      await assertRequiredManagedMcpReadiness(
        {
          job: selectedJob,
          runtimeType: "opencode",
          baseUrl: "http://agent.internal:4096",
          signal: new AbortController().signal,
        },
        deps,
      );
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({
      code: "managed_mcp_unavailable",
      reason: "runtime_request_failed",
      classification: "permanent_auth",
    });
    expect(String(failure)).not.toContain("must-never-escape");
  });

  it("preserves the pre-session cancellation reason instead of reclassifying it", async () => {
    const controller = new AbortController();
    controller.abort(new Error("pre_session_cancelled_by_backend"));
    const deps = dependencies({
      statusError: new Error("secondary runtime request failure"),
    });

    await expect(
      assertRequiredManagedMcpReadiness(
        {
          job: selectedJob,
          runtimeType: "opencode",
          baseUrl: "http://agent.internal:4096",
          signal: controller.signal,
        },
        deps,
      ),
    ).rejects.toThrow("pre_session_cancelled_by_backend");
  });

  it("does not change managed MCP behavior for runtimes without this OpenCode contract", async () => {
    const deps = dependencies();

    await assertRequiredManagedMcpReadiness(
      {
        job: selectedJob,
        runtimeType: "claude-shim",
        baseUrl: "http://agent.internal:4096",
        signal: new AbortController().signal,
      },
      deps,
    );

    expect(deps.createClient).not.toHaveBeenCalled();
  });

  it("marks only recoverable managed MCP failures as retry candidates", () => {
    expect(
      isRecoverableManagedMcpReadinessError(
        new ManagedMcpReadinessError(
          "runtime_request_failed",
          ["scraper"],
          "recoverable_timeout",
        ),
      ),
    ).toBe(true);
    expect(
      isRecoverableManagedMcpReadinessError(
        new ManagedMcpReadinessError(
          "not_connected",
          ["scraper"],
          "recoverable_disconnect",
        ),
      ),
    ).toBe(true);
    expect(
      isRecoverableManagedMcpReadinessError(
        new ManagedMcpReadinessError(
          "not_connected",
          ["scraper"],
          "permanent_auth",
        ),
      ),
    ).toBe(false);
    expect(
      isRecoverableManagedMcpReadinessError(
        new Error("unrelated recoverable_timeout text"),
      ),
    ).toBe(false);
  });
});
