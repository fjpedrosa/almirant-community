import { describe, expect, it } from "bun:test";
import {
  canAccessSignUpPage,
  resolveAuthEntryPath,
  shouldRedirectSignInToSignUp,
} from "./auth-route-state";

describe("auth-route-state", () => {
  it("redirects /sign-in to /signup when the instance has no users", () => {
    expect(
      shouldRedirectSignInToSignUp({
        hasUsers: false,
        needsInitialAdminSetup: true,
        allowRegistration: true,
      })
    ).toBe(true);
  });

  it("keeps /sign-in available once the instance already has users", () => {
    expect(
      shouldRedirectSignInToSignUp({
        hasUsers: true,
        needsInitialAdminSetup: false,
        allowRegistration: false,
      })
    ).toBe(false);
  });

  it("resolves /signup as the unauthenticated entrypoint when there are no users", () => {
    expect(
      resolveAuthEntryPath({
        hasUsers: false,
        needsInitialAdminSetup: true,
        allowRegistration: true,
      })
    ).toBe("/signup");
  });

  it("resolves /sign-in as the unauthenticated entrypoint once bootstrap is complete", () => {
    expect(
      resolveAuthEntryPath({
        hasUsers: true,
        needsInitialAdminSetup: false,
        allowRegistration: false,
      })
    ).toBe("/sign-in");
  });

  it("allows /signup for the initial admin setup", () => {
    expect(
      canAccessSignUpPage(
        {
          hasUsers: false,
          needsInitialAdminSetup: true,
          allowRegistration: true,
        },
        false
      )
    ).toBe(true);
  });

  it("allows /signup for invited users even when public registration is closed", () => {
    expect(
      canAccessSignUpPage(
        {
          hasUsers: true,
          needsInitialAdminSetup: false,
          allowRegistration: false,
        },
        true
      )
    ).toBe(true);
  });

  it("blocks /signup direct access when the instance already has users and there is no invitation context", () => {
    expect(
      canAccessSignUpPage(
        {
          hasUsers: true,
          needsInitialAdminSetup: false,
          allowRegistration: false,
        },
        false
      )
    ).toBe(false);
  });
});
