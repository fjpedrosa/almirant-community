import { describe, expect, it } from "bun:test";
import { SessionState } from "./state";
import { SessionStateMachine } from "./state-machine";

const wait = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

describe("SessionStateMachine", () => {
  it("transitions from PENDING -> STARTING -> ACTIVE", () => {
    const machine = new SessionStateMachine();

    machine.start();
    expect(machine.getState()).toBe(SessionState.STARTING);

    machine.markStarted();
    expect(machine.getState()).toBe(SessionState.ACTIVE);
  });

  it("enters STAGNANT after inactivity and resumes on output", async () => {
    const machine = new SessionStateMachine({
      startupTimeoutMs: 100,
      stagnationTimeoutMs: 10,
      maxDurationMs: 200,
    });

    machine.start();
    machine.markStarted();

    await wait(20);
    expect(machine.getState()).toBe(SessionState.STAGNANT);

    machine.onOutputReceived();
    expect(machine.getState()).toBe(SessionState.ACTIVE);
  });

  it("fails on startup timeout", async () => {
    const machine = new SessionStateMachine({
      startupTimeoutMs: 10,
      stagnationTimeoutMs: 100,
      maxDurationMs: 200,
    });

    machine.start();
    await wait(20);

    expect(machine.getState()).toBe(SessionState.FAILED);
  });

  it("fails on max duration timeout", async () => {
    const machine = new SessionStateMachine({
      startupTimeoutMs: 100,
      stagnationTimeoutMs: 100,
      maxDurationMs: 20,
    });

    machine.start();
    machine.markStarted();

    await wait(30);
    expect(machine.getState()).toBe(SessionState.FAILED);
  });

  it("throws on invalid transitions", () => {
    const machine = new SessionStateMachine();

    expect(() => machine.markDone()).toThrow(
      "Invalid SessionState transition: PENDING -> COMPLETED"
    );
  });
});
