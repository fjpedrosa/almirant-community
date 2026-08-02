import { describe, expect, it } from "bun:test";
import {
  resolveDurableTerminalHandoff,
  resolveJobTerminalPresentation,
  resolveJobTerminalIntent,
} from "./job-cancellation";

describe("resolveJobTerminalIntent", () => {
  it("detecta una cancelación normal aunque shutdownRequested sea false", () => {
    expect(
      resolveJobTerminalIntent({
        status: "cancelled",
        shutdownRequested: false,
      }),
    ).toEqual({ status: "cancelled", shutdownRequested: false });
  });

  it("conserva la intención explícita de shutdown", () => {
    expect(
      resolveJobTerminalIntent({
        status: "cancelled",
        shutdownRequested: true,
      }),
    ).toEqual({ status: "cancelled", shutdownRequested: true });
  });

  it("conserva un intent failed y sus detalles sin convertirlo en cancelled", () => {
    expect(
      resolveJobTerminalIntent({
        status: "failed",
        shutdownRequested: false,
        errorType: "interaction-timeout",
        errorMessage: "Interaction timed out",
      }),
    ).toEqual({
      status: "failed",
      shutdownRequested: false,
      errorType: "interaction-timeout",
      errorMessage: "Interaction timed out",
    });
  });

  it("no confunde un job activo con una cancelación", () => {
    expect(
      resolveJobTerminalIntent({
        status: "running",
        shutdownRequested: false,
      }),
    ).toBeNull();
  });
});

describe("resolveDurableTerminalHandoff", () => {
  it("conserva un claim durable hasta completar el handoff de una cancelación normal", () => {
    expect(
      resolveDurableTerminalHandoff(
        { status: "cancelled", shutdownRequested: false },
        "claim-attempt-1",
      ),
    ).toEqual({
      expectedClaimAttemptId: "claim-attempt-1",
      status: "cancelled",
      reason: "cancelled",
      shutdownRequested: false,
    });
  });

  it("conserva failed hasta el handoff durable y no inventa una cancelación", () => {
    expect(
      resolveDurableTerminalHandoff(
        {
          status: "failed",
          shutdownRequested: false,
          errorType: "interaction-timeout",
          errorMessage: "Interaction timed out",
        },
        "claim-attempt-2",
      ),
    ).toEqual({
      expectedClaimAttemptId: "claim-attempt-2",
      status: "failed",
      reason: "interaction-timeout",
      shutdownRequested: false,
      errorType: "interaction-timeout",
      errorMessage: "Interaction timed out",
    });
  });

  it("no vuelve a terminalizar un job legacy sin receipt", () => {
    expect(
      resolveDurableTerminalHandoff(
        { status: "cancelled", shutdownRequested: false },
        undefined,
      ),
    ).toBeNull();
  });
});

describe("resolveJobTerminalPresentation", () => {
  it("emite job.failed —y nunca job.cancelled— para un pending failed", () => {
    expect(
      resolveJobTerminalPresentation({
        status: "failed",
        shutdownRequested: false,
        errorType: "interaction-timeout",
        errorMessage: "Interaction timed out",
      }),
    ).toEqual({
      status: "failed",
      summary: "failed",
      logCode: "job.failed",
      logMessage: "Job failed by backend terminal intent",
      event: {
        kind: "job.failed",
        errorMessage: "Interaction timed out",
      },
    });
  });

  it("mantiene job.cancelled para una cancelación real", () => {
    expect(
      resolveJobTerminalPresentation({
        status: "cancelled",
        shutdownRequested: false,
      }),
    ).toEqual({
      status: "cancelled",
      summary: "cancelled",
      logCode: "job.cancelled",
      logMessage: "Job cancelled by user",
      event: {
        kind: "job.cancelled",
        reason: "Job cancelled by user.",
      },
    });
  });
});
