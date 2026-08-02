import { describe, expect, it, mock } from "bun:test";
import { classifyError } from "../shared/types";
import {
  assertRequiredRuntimeCapabilities,
  resolveRequiredRuntimeCapabilities,
} from "./runtime-capability-preflight";

const browserJob = {
  id: "job-browser",
  promptTemplate: "scheduled-browser-agent",
  config: { needsBrowser: true },
};

const ordinaryJob = {
  id: "job-ordinary",
  promptTemplate: "runner-implement",
  config: {},
};

describe("runtime capability preflight", () => {
  it("maps needsBrowser to the browser runtime capability only", () => {
    expect(resolveRequiredRuntimeCapabilities(browserJob)).toEqual(["browser"]);
    expect(resolveRequiredRuntimeCapabilities(ordinaryJob)).toEqual([]);
  });

  it("executes the shared browser probe inside the ready container", async () => {
    const execInContainer = mock(async () => ({
      exitCode: 0,
      stdout: '{"capability":"browser","status":"ok"}',
      stderr: "",
    }));

    await assertRequiredRuntimeCapabilities({
      job: browserJob,
      runtimeType: "codex-shim",
      containerId: "container-1",
      workspacePath: "/workspace/repo",
      containerManager: { execInContainer },
    });

    expect(execInContainer).toHaveBeenCalledWith(
      "container-1",
      [
        "/usr/local/bin/almirant-runtime-capability-check",
        "browser",
        "--json",
        "--expected-uid=1001",
      ],
      "/workspace/repo",
    );
  });

  it("fails closed with one stable permanent error when Chromium cannot launch", async () => {
    const execInContainer = mock(async () => ({
      exitCode: 78,
      stdout: "",
      stderr: "browser executable is missing",
    }));

    let failure: unknown;
    try {
      await assertRequiredRuntimeCapabilities({
        job: browserJob,
        runtimeType: "claude-shim",
        containerId: "container-1",
        workspacePath: "/workspace/repo",
        containerManager: { execInContainer },
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({
      code: "runtime_capability_missing",
      capability: "browser",
      classification: "permanent_config",
    });
    expect(String(failure)).toContain("RUNTIME_CAPABILITY_MISSING");
    expect(classifyError(failure as Error)).toBe("permanent_config");
  });

  it("does not exec a probe for jobs without runtime capability requirements", async () => {
    const execInContainer = mock(async () => ({
      exitCode: 0,
      stdout: "",
      stderr: "",
    }));

    await assertRequiredRuntimeCapabilities({
      job: ordinaryJob,
      runtimeType: "opencode",
      containerId: "container-1",
      workspacePath: "/workspace/repo",
      containerManager: { execInContainer },
    });

    expect(execInContainer).not.toHaveBeenCalled();
  });
});
