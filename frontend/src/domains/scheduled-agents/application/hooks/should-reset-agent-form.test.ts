import { describe, expect, it } from "bun:test";
import { shouldResetAgentForm } from "./should-reset-agent-form";

// Regression guard for feedback 40c1c45c-c0f8-4502-8027-a8f9c7ef8d72
// ("Se cambia mi prompt por un texto de system prompt posiblemente").
// The previous useEffect in use-agent-form-drawer.ts reset the form on every
// dependency change while the drawer was open, so a React Query refetch that
// returned a new `config` object identity would wipe what the user was typing.
// shouldResetAgentForm must only trigger a reset on closed -> open transitions
// or when the edited config id actually changes.
describe("shouldResetAgentForm", () => {
  it("resets on closed -> open transition (new config)", () => {
    expect(
      shouldResetAgentForm({
        prevOpen: false,
        nextOpen: true,
        prevConfigId: null,
        nextConfigId: null,
      }),
    ).toBe(true);
  });

  it("resets on closed -> open transition (existing config)", () => {
    expect(
      shouldResetAgentForm({
        prevOpen: false,
        nextOpen: true,
        prevConfigId: null,
        nextConfigId: "config-a",
      }),
    ).toBe(true);
  });

  it("resets when the edited configId changes while the drawer stays open", () => {
    expect(
      shouldResetAgentForm({
        prevOpen: true,
        nextOpen: true,
        prevConfigId: "config-a",
        nextConfigId: "config-b",
      }),
    ).toBe(true);
  });

  it("does NOT reset when the drawer stays open with the same configId (background refetch)", () => {
    expect(
      shouldResetAgentForm({
        prevOpen: true,
        nextOpen: true,
        prevConfigId: "config-a",
        nextConfigId: "config-a",
      }),
    ).toBe(false);
  });

  it("does NOT reset when the drawer is closed", () => {
    expect(
      shouldResetAgentForm({
        prevOpen: true,
        nextOpen: false,
        prevConfigId: "config-a",
        nextConfigId: "config-a",
      }),
    ).toBe(false);
  });
});
