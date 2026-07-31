import { afterEach, describe, expect, it, mock } from "bun:test";
import { signupLifecycleObserver } from "@/cloud/signup-lifecycle-observer";
import {
  completeFirstWorkspaceActivation,
  notifyPublicSignupPageOpened,
  submitSignupWithLifecycle,
} from "./signup-lifecycle";

const originalObserver = { ...signupLifecycleObserver };

afterEach(() => {
  Object.assign(signupLifecycleObserver, originalObserver);
  mock.restore();
});

describe("signup lifecycle", () => {
  it("keeps the default observer synchronous and inert", async () => {
    await expect(
      submitSignupWithLifecycle(async () => ({ error: null })),
    ).resolves.toEqual({ error: null });
    expect(() => {
      notifyPublicSignupPageOpened();
      completeFirstWorkspaceActivation(() => {});
    }).not.toThrow();
  });

  it("reports only lifecycle transitions around a successful signup", async () => {
    const events: string[] = [];
    signupLifecycleObserver.onSignupSubmissionStarted = () => {
      events.push("started");
    };
    signupLifecycleObserver.onSignupSucceeded = () => {
      events.push("succeeded");
    };

    await submitSignupWithLifecycle(async () => ({ error: null }));

    expect(events).toEqual(["started", "succeeded"]);
  });

  it("reports failure without exposing the submission error", async () => {
    const onSignupFailed = mock(() => {});
    signupLifecycleObserver.onSignupFailed = onSignupFailed;

    await submitSignupWithLifecycle(async () => ({ error: { message: "private" } }));

    expect(onSignupFailed).toHaveBeenCalledWith();
  });

  it("isolates observer failures from signup and activation completion", async () => {
    signupLifecycleObserver.onSignupSubmissionStarted = () => {
      throw new Error("observer unavailable");
    };
    signupLifecycleObserver.onFirstWorkspaceActivated = () => {
      throw new Error("observer unavailable");
    };
    const navigate = mock(() => {});

    await expect(
      submitSignupWithLifecycle(async () => ({ error: null })),
    ).resolves.toEqual({ error: null });
    expect(() => completeFirstWorkspaceActivation(navigate)).not.toThrow();
    expect(navigate).toHaveBeenCalledWith();
  });
});
